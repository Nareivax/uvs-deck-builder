#!/usr/bin/env python3
"""Import scraped cards into PostgreSQL (idempotent: safe to re-run).

Usage:
    pip install "psycopg[binary]"
    python3 scripts/import_cards.py cards.jsonl             # JSON array or one JSON object per line
    python3 scripts/import_cards.py cards.jsonl --force     # reprocess even unchanged cards
    python3 scripts/import_cards.py cards.jsonl --skip-bad  # import good cards, list the bad ones

Use --force after editing db/data/keywords.csv, ability_types.csv or aliases.csv.

Connection settings come from the environment or the .env file in the repo
root (POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB, optional POSTGRES_HOST
and POSTGRES_PORT). The compose file publishes port 5432 to localhost.

Everything runs in one transaction. Every card that has a problem is listed at the end
(one failing card does not stop the others from being checked). By default nothing is
imported if any card failed; with --skip-bad the other cards are imported.
Unchanged cards (same scraped payload as last time) are skipped so cards.updated_at only
moves when something really changed.

Keywords: the list lives in db/data/keywords.csv. A keyword may be written with a requirement
in front of it ("BrutePowerful: 3", "DeadlockStun: 2", "Chun Li: Multiple: 2"); that goes in
card_keywords.requirement. A token that is not a keyword and has no rating or detail is a
character trait: keyword 'Char. Trait' with the token as its detail. Words in the rules text
never add keywords or traits to a card.
Spelling variants of names (Chun Li / Chun-Li) are merged using db/data/aliases.csv. A requirement
like Benimaru/Goro/Kyo means any of those characters satisfies it; it is stored as written
(with canonical spellings) and filters split it on '/'.

Ability types: each card's rules text is scanned for lines starting with a type from
db/data/ability_types.csv. The types found go in cards.ability_types as lowercase text.
"""
import json
import os
import sys
from collections import Counter
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from cardparse import (CHAR_TRAIT, count_symbols, extract_ability_types, find_spelling_variants,
                       load_ability_types, load_aliases, load_keywords, normalize_date, normalize_zone, parse_formats,
                       parse_keywords, resolve_keywords)

ROOT = Path(__file__).resolve().parent.parent
KEYWORDS_FILE = ROOT / "db" / "data" / "keywords.csv"
ABILITY_TYPES_FILE = ROOT / "db" / "data" / "ability_types.csv"
ALIASES_FILE = ROOT / "db" / "data" / "aliases.csv"

CARD_COLUMNS = [
    "source_id", "set_id", "number", "name", "card_type", "rarity", "rules_text", "ability_types",
    "difficulty", "control", "block_modifier", "block_zone", "attack_zone",
    "attack_speed", "attack_damage", "hand_size", "vitality",
    "image_mini_url", "image_key", "source_url",
]
CASTS = {"ability_types": "::text[]"}


def load_env(path=ROOT / ".env"):
    if path.exists():
        for line in path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


def read_cards(path):
    text = Path(path).read_text(encoding="utf-8").strip()
    if text.startswith("["):
        return json.loads(text)
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def connect():
    return psycopg.connect(
        host=os.environ.get("POSTGRES_HOST", "localhost"),
        port=os.environ.get("POSTGRES_PORT", "5432"),
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
        dbname=os.environ["POSTGRES_DB"],
    )


def compute_set_dates(cards):
    """One release date per set: the earliest valid date among its cards. Dates like
    '2010-12-00' become the 1st of that month and '0000-00-00' becomes unknown.
    Returns ({extension_id: 'YYYY-MM-DD'}, {original text: fixed value or None})."""
    best, adjusted = {}, {}
    for raw in cards:
        original = raw.get("release_date")
        fixed = normalize_date(original)
        if original and fixed != original:
            adjusted[original] = fixed
        ext = raw.get("extension_id")
        if fixed and (ext not in best or fixed < best[ext]):
            best[ext] = fixed
    return best, adjusted


def sync_keywords(cur, known):
    """Make the keywords table match keywords.csv; return {lowercase name: id}.
    Looks first and only inserts what is missing, so ids are not used up on every run."""
    cur.execute("SELECT name::text, id, has_value FROM keywords")
    existing = {name.lower(): (kid, has_value) for name, kid, has_value in cur.fetchall()}
    for name, has_value in known.values():
        found = existing.get(name.lower())
        if found is None:
            cur.execute("INSERT INTO keywords (name, has_value) VALUES (%s, %s) RETURNING id",
                        (name, has_value))
            existing[name.lower()] = (cur.fetchone()[0], has_value)
        elif found[1] != has_value:
            cur.execute("UPDATE keywords SET has_value = %s WHERE id = %s", (has_value, found[0]))
            existing[name.lower()] = (found[0], has_value)
    return {name: kid for name, (kid, _) in existing.items()}


def get_format_id(cur, ctx, stats, name):
    """Cached lookup. Looks first and only inserts a missing format: an INSERT ... ON CONFLICT
    would use up an id on every card and exhaust the small formats id sequence."""
    if name not in ctx["formats"]:
        cur.execute("SELECT id FROM formats WHERE name = %s", (name,))
        row = cur.fetchone()
        if row is None:
            cur.execute("INSERT INTO formats (name) VALUES (%s) RETURNING id", (name,))
            row = cur.fetchone()
            stats["new_formats"].append(name)
        ctx["formats"][name] = row[0]
    return ctx["formats"][name]


def upsert_set(cur, raw, ctx):
    key = raw["extension_id"]
    if key not in ctx["sets"]:
        cur.execute(
            """INSERT INTO sets (source_id, code, name, set_number, block, release_date)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (source_id) DO UPDATE SET
                   code = EXCLUDED.code, name = EXCLUDED.name,
                   set_number = EXCLUDED.set_number, block = EXCLUDED.block,
                   release_date = EXCLUDED.release_date
               RETURNING id""",
            (key, raw["ext_code"], raw["extension"], raw.get("set_number"),
             raw.get("block"), ctx["set_dates"].get(key)),
        )
        ctx["sets"][key] = cur.fetchone()[0]
    return ctx["sets"][key]


def zone_or_none(raw, field, stats):
    value = raw.get(field)
    zone = normalize_zone(value)
    if zone is None and value not in (None, ""):
        stats["odd_zones"][f"{field}={value}"] += 1
    return zone


def import_card(cur, raw, ctx, stats):
    source_id = raw["id"]

    cur.execute("SELECT payload FROM card_scrape_raw WHERE source_id = %s", (source_id,))
    row = cur.fetchone()
    if row and row[0] == raw and not ctx["force"]:
        stats["unchanged"] += 1
        return

    # Parse and validate first, so a bad card writes nothing
    try:
        keywords, problems = resolve_keywords(parse_keywords(raw.get("keywords")), ctx["known"],
                                            ctx["aliases"], stats["aliases_applied"])
    except ValueError as e:
        keywords, problems = [], [str(e)]
    if problems:
        stats["problems"] += [f"card {source_id} ({raw.get('name')!r}): {p}" for p in problems]
        return
    symbols = count_symbols(raw.get("symbols"))
    formats = parse_formats(raw.get("formats"))
    ability_list, unrecognized = extract_ability_types(raw.get("text"), ctx["ability_types"])

    is_character = raw.get("type_slug") == "character"
    for name, _, detail, requirement in keywords:
        if name.lower() == CHAR_TRAIT.lower():
            seen = stats["traits"].setdefault(detail, {"character": 0, "other": 0})
            seen["character" if is_character else "other"] += 1
        if requirement:
            stats["requirements"][requirement] += 1
    stats["unrecognized"].update(unrecognized)
    stats["ability_counts"].update(ability_list)

    cur.execute(
        """INSERT INTO card_scrape_raw (source_id, payload) VALUES (%s, %s)
           ON CONFLICT (source_id) DO UPDATE SET payload = EXCLUDED.payload, scraped_at = now()""",
        (source_id, Jsonb(raw)),
    )

    values = {
        "source_id": source_id,
        "set_id": upsert_set(cur, raw, ctx),
        "number": raw["number_str"],
        "name": raw["name"],
        "card_type": raw["type_slug"],
        "rarity": raw.get("rarity"),
        "rules_text": raw.get("text"),
        "ability_types": ability_list,
        "difficulty": raw.get("difficulty"),
        "control": raw.get("control"),
        "block_modifier": raw.get("block_modifier"),
        "block_zone": zone_or_none(raw, "block_zone", stats),
        "attack_zone": zone_or_none(raw, "attack_zone", stats),
        "attack_speed": raw.get("attack_speed"),
        "attack_damage": raw.get("attack_damage"),
        "hand_size": raw.get("hand_size"),
        "vitality": raw.get("vitality"),
        "image_mini_url": raw.get("image_mini"),
        "image_key": f"{raw['ext_code']}/{raw['number_str']}" if raw.get("image_mini") else None,
        "source_url": raw.get("url"),
    }
    cols = ", ".join(CARD_COLUMNS)
    params = ", ".join(f"%({c})s{CASTS.get(c, '')}" for c in CARD_COLUMNS)
    updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in CARD_COLUMNS if c != "source_id")
    cur.execute(
        f"""INSERT INTO cards ({cols}) VALUES ({params})
            ON CONFLICT (source_id) DO UPDATE SET {updates}
            RETURNING id, (xmax = 0) AS inserted""",
        values,
    )
    card_id, inserted = cur.fetchone()
    stats["inserted" if inserted else "updated"] += 1

    # Replace child rows
    cur.execute("DELETE FROM card_symbols  WHERE card_id = %s", (card_id,))
    cur.execute("DELETE FROM card_keywords WHERE card_id = %s", (card_id,))
    cur.execute("DELETE FROM card_formats  WHERE card_id = %s", (card_id,))

    for code, attuned, quantity in symbols:
        cur.execute("INSERT INTO symbols (code) VALUES (%s) ON CONFLICT DO NOTHING RETURNING code", (code,))
        if cur.fetchone():
            stats["new_symbols"].append(code)
        cur.execute(
            "INSERT INTO card_symbols (card_id, symbol, attuned, quantity) VALUES (%s, %s, %s, %s)",
            (card_id, code, attuned, quantity),
        )

    for name, value, detail, requirement in keywords:
        cur.execute(
            """INSERT INTO card_keywords (card_id, keyword_id, value, detail, requirement)
               VALUES (%s, %s, %s, %s, %s)""",
            (card_id, ctx["keyword_ids"][name.lower()], value, detail, requirement),
        )

    for fname in formats:
        cur.execute("INSERT INTO card_formats (card_id, format_id) VALUES (%s, %s)",
                    (card_id, get_format_id(cur, ctx, stats, fname)))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    force = "--force" in sys.argv
    skip_bad = "--skip-bad" in sys.argv
    load_env()
    cards = read_cards(args[0])
    known = load_keywords(KEYWORDS_FILE)
    ability_types = load_ability_types(ABILITY_TYPES_FILE)
    aliases = load_aliases(ALIASES_FILE) if ALIASES_FILE.exists() else {}
    set_dates, adjusted_dates = compute_set_dates(cards)

    stats = {"inserted": 0, "updated": 0, "unchanged": 0, "problems": [], "failed": [],
             "traits": {}, "requirements": Counter(), "odd_zones": Counter(),
             "new_symbols": [], "new_formats": [],
             "ability_counts": Counter(), "unrecognized": Counter(),
             "aliases_applied": Counter()}
    with connect() as conn:                      # commits on success, rolls back on error/exit
        with conn.cursor() as cur:
            ctx = {"known": known, "force": force, "sets": {}, "formats": {},
                   "set_dates": set_dates, "ability_types": ability_types, "aliases": aliases,
                   "keyword_ids": sync_keywords(cur, known)}
            for raw in cards:
                try:
                    with conn.transaction():      # savepoint: a failing card undoes only itself
                        import_card(cur, raw, ctx, stats)
                except Exception as e:
                    ctx["sets"].clear()           # rolled-back inserts must not stay cached
                    ctx["formats"].clear()
                    reason = " ".join(str(e).split())
                    stats["failed"].append(f"card id={raw.get('id')} ({raw.get('name')!r}): {reason}")

            problems = stats["problems"] + stats["failed"]
            if problems:
                print(f"{len(problems)} card(s) could not be imported:")
                for p in problems:
                    print("  -", p)
                if not skip_bad:
                    print("Nothing was imported. Fix the problems, or re-run with --skip-bad")
                    print("to import everything else.")
                    raise SystemExit(1)          # leaving the block rolls everything back
                print("--skip-bad: importing the other cards.")

    print(f"{len(cards)} cards read: {stats['inserted']} inserted, "
          f"{stats['updated']} updated, {stats['unchanged']} unchanged")
    for label in ("new_formats", "new_symbols"):
        if stats[label]:
            print(f"{label.replace('_', ' ')} created: {', '.join(sorted(set(stats[label])))}")

    if adjusted_dates:
        shown = ", ".join(f"{o} -> {n or 'unknown'}" for o, n in sorted(adjusted_dates.items())[:8])
        more = f" (and {len(adjusted_dates) - 8} more)" if len(adjusted_dates) > 8 else ""
        print(f"Release dates adjusted: {shown}{more}")
    if stats["odd_zones"]:
        print("Zone values that are not high/mid/low were stored as empty: "
              + ", ".join(f"{k} x{n}" for k, n in stats["odd_zones"].most_common(10)))

    if stats["traits"]:
        marked = [t + (" *" if c["other"] else "") for t, c in sorted(stats["traits"].items())]
        print("Character traits found (* = also on non-character cards): " + ", ".join(marked))
        keyword_names = [c for c, _ in known.values() if c != CHAR_TRAIT and len(c) > 2]
        suspicious = [t for t in stats["traits"] if any(k in t for k in keyword_names)]
        if suspicious:
            print("  Check these: they contain a keyword name, so they may be keywords: "
                  + ", ".join(sorted(suspicious)))
        print("  If any of these is really a keyword, add it to db/data/keywords.csv and re-run with --force.")
    if stats["requirements"]:
        print("Keyword requirements found (character names, traits or game states): "
              + ", ".join(sorted(stats["requirements"])))
    if stats["aliases_applied"]:
        print("Aliases applied: " + ", ".join(f"{k} x{n}" for k, n in sorted(stats["aliases_applied"].items())))
    variants = find_spelling_variants(list(stats["requirements"]) + list(stats["traits"]))
    if variants:
        print("Possible spelling variants not covered by db/data/aliases.csv: "
              + "; ".join(" | ".join(v) for v in variants))

    if stats["ability_counts"]:
        by_type = ", ".join(f"{n} {t}" for t, n in sorted(stats["ability_counts"].items()))
        print(f"Cards with ability types (cards processed this run): {by_type}")
    if stats["unrecognized"]:
        top = ", ".join(f"{h!r} x{n}" for h, n in stats["unrecognized"].most_common(15))
        print("Unrecognised ability headers (lines like 'X: ...' with no known ability type): " + top)
        print("  If one is an ability type you want to filter by, add it to db/data/ability_types.csv")
        print("  and re-run with --force.")


if __name__ == "__main__":
    main()
