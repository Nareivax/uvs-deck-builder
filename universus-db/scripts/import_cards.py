#!/usr/bin/env python3
"""Import scraped cards into PostgreSQL (idempotent: safe to re-run).

Usage:
    pip install "psycopg[binary]"
    python3 scripts/import_cards.py cards.jsonl           # JSON array or one JSON object per line
    python3 scripts/import_cards.py cards.jsonl --force   # reprocess even unchanged cards

Use --force after editing db/data/keywords.csv.

Connection settings come from the environment or the .env file in the repo
root (POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB, optional POSTGRES_HOST
and POSTGRES_PORT). The compose file publishes port 5432 to localhost.

Everything runs in one transaction: if any card has a problem, nothing is imported
and all problems are listed. Unchanged cards (same scraped payload as last time) are
skipped so cards.updated_at only moves when something really changed.

Keywords: the list lives in db/data/keywords.csv. A token on a card's keyword line that is
not in that list is stored as a character trait: keyword 'Char. Trait' with the token as its
detail. Words in the rules text never add keywords or traits to a card.

Ability types: each card's rules text is scanned for lines starting with a type from
db/data/ability_types.csv (Blitz, Enhance, Form, Response). The types found go in
cards.ability_types as lowercase text, e.g. {blitz,response}. Words in front of the type
("Monster Blitz", "First Form") are ignored. Use --force after editing the types list.
"""
import json
import os
import sys
from collections import Counter
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from cardparse import (CHAR_TRAIT, extract_ability_types, load_ability_types, load_keywords,
                       parse_formats, parse_keywords, parse_symbols, resolve_keywords)

ROOT = Path(__file__).resolve().parent.parent
KEYWORDS_FILE = ROOT / "db" / "data" / "keywords.csv"
ABILITY_TYPES_FILE = ROOT / "db" / "data" / "ability_types.csv"

CARD_COLUMNS = [
    "source_id", "set_id", "number", "name", "card_type", "rarity", "rules_text", "ability_types",
    "difficulty", "control", "block_modifier", "block_zone", "attack_zone",
    "attack_speed", "attack_damage", "hand_size", "vitality",
    "image_mini_url", "source_url",
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


def sync_keywords(cur, known):
    """Make the keywords table match keywords.csv; return {lowercase name: id}."""
    for name, has_value in known.values():
        cur.execute(
            """INSERT INTO keywords (name, has_value) VALUES (%s, %s)
               ON CONFLICT (name) DO UPDATE SET has_value = EXCLUDED.has_value""",
            (name, has_value),
        )
    cur.execute("SELECT name::text, id FROM keywords")
    return {name.lower(): kid for name, kid in cur.fetchall()}


def upsert_set(cur, raw, cache):
    key = raw["extension_id"]
    if key not in cache:
        cur.execute(
            """INSERT INTO sets (source_id, code, name, set_number, block, release_date)
               VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (source_id) DO UPDATE SET
                   code = EXCLUDED.code, name = EXCLUDED.name,
                   set_number = EXCLUDED.set_number, block = EXCLUDED.block,
                   release_date = EXCLUDED.release_date
               RETURNING id""",
            (key, raw["ext_code"], raw["extension"], raw.get("set_number"),
             raw.get("block"), raw.get("release_date")),
        )
        cache[key] = cur.fetchone()[0]
    return cache[key]


def import_card(cur, raw, ctx, stats):
    source_id = raw["id"]

    cur.execute("SELECT payload FROM card_scrape_raw WHERE source_id = %s", (source_id,))
    row = cur.fetchone()
    if row and row[0] == raw and not ctx["force"]:
        stats["unchanged"] += 1
        return

    # Parse and validate first, so a bad card writes nothing
    try:
        keywords, problems = resolve_keywords(parse_keywords(raw.get("keywords")), ctx["known"])
    except ValueError as e:
        keywords, problems = [], [str(e)]
    if problems:
        stats["problems"] += [f"card {source_id} ({raw.get('name')!r}): {p}" for p in problems]
        return
    symbols = parse_symbols(raw.get("symbols"))
    formats = parse_formats(raw.get("formats"))
    ability_list, unrecognized = extract_ability_types(raw.get("text"), ctx["ability_types"])
    stats["unrecognized"].update(unrecognized)
    stats["ability_counts"].update(ability_list)

    is_character = raw.get("type_slug") == "character"
    for name, _, detail in keywords:
        if name.lower() == CHAR_TRAIT.lower():
            seen = stats["traits"].setdefault(detail, {"character": 0, "other": 0})
            seen["character" if is_character else "other"] += 1

    cur.execute(
        """INSERT INTO card_scrape_raw (source_id, payload) VALUES (%s, %s)
           ON CONFLICT (source_id) DO UPDATE SET payload = EXCLUDED.payload, scraped_at = now()""",
        (source_id, Jsonb(raw)),
    )

    values = {
        "source_id": source_id,
        "set_id": upsert_set(cur, raw, ctx["sets"]),
        "number": raw["number_str"],
        "name": raw["name"],
        "card_type": raw["type_slug"],
        "rarity": raw.get("rarity"),
        "rules_text": raw.get("text"),
        "ability_types": ability_list,
        "difficulty": raw.get("difficulty"),
        "control": raw.get("control"),
        "block_modifier": raw.get("block_modifier"),
        "block_zone": raw.get("block_zone"),
        "attack_zone": raw.get("attack_zone"),
        "attack_speed": raw.get("attack_speed"),
        "attack_damage": raw.get("attack_damage"),
        "hand_size": raw.get("hand_size"),
        "vitality": raw.get("vitality"),
        "image_mini_url": raw.get("image_mini"),
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

    for code, attuned in symbols:
        cur.execute("INSERT INTO symbols (code) VALUES (%s) ON CONFLICT DO NOTHING RETURNING code", (code,))
        if cur.fetchone():
            stats["new_symbols"].append(code)
        cur.execute("INSERT INTO card_symbols (card_id, symbol, attuned) VALUES (%s, %s, %s)",
                    (card_id, code, attuned))

    for name, value, detail in keywords:
        cur.execute(
            "INSERT INTO card_keywords (card_id, keyword_id, value, detail) VALUES (%s, %s, %s, %s)",
            (card_id, ctx["keyword_ids"][name.lower()], value, detail),
        )

    for fname in formats:
        cur.execute("INSERT INTO formats (name) VALUES (%s) ON CONFLICT (name) DO NOTHING RETURNING id", (fname,))
        row = cur.fetchone()
        if row:
            stats["new_formats"].append(fname)
        else:
            cur.execute("SELECT id FROM formats WHERE name = %s", (fname,))
            row = cur.fetchone()
        cur.execute("INSERT INTO card_formats (card_id, format_id) VALUES (%s, %s)", (card_id, row[0]))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1:
        sys.exit(__doc__)
    force = "--force" in sys.argv
    load_env()
    cards = read_cards(args[0])
    known = load_keywords(KEYWORDS_FILE)
    ability_types = load_ability_types(ABILITY_TYPES_FILE)

    stats = {"inserted": 0, "updated": 0, "unchanged": 0, "problems": [], "traits": {},
             "new_symbols": [], "new_formats": [],
             "ability_counts": Counter(), "unrecognized": Counter()}
    with connect() as conn:                      # commits on success, rolls back on error/exit
        with conn.cursor() as cur:
            ctx = {"known": known, "force": force, "sets": {}, "ability_types": ability_types,
                   "keyword_ids": sync_keywords(cur, known)}
            for raw in cards:
                try:
                    import_card(cur, raw, ctx, stats)
                except Exception as e:
                    raise SystemExit(f"Failed on card id={raw.get('id')} ({raw.get('name')!r}): {e}")
            if stats["problems"]:
                print(f"{len(stats['problems'])} problem(s); nothing was imported:")
                for p in stats["problems"]:
                    print("  -", p)
                raise SystemExit(1)

    print(f"{len(cards)} cards read: {stats['inserted']} inserted, "
          f"{stats['updated']} updated, {stats['unchanged']} unchanged")
    for label in ("new_formats", "new_symbols"):
        if stats[label]:
            print(f"{label.replace('_', ' ')} created: {', '.join(sorted(set(stats[label])))}")
    if stats["traits"]:
        marked = [t + (" *" if c["other"] else "") for t, c in sorted(stats["traits"].items())]
        print("Character traits found (* = also on non-character cards): " + ", ".join(marked))
        print("  If any of these is really a keyword, add it to db/data/keywords.csv and re-run with --force.")

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
