"""Parsing helpers for scraped Universus card fields. No database needed."""
import re
from datetime import date
from functools import lru_cache

# '(Kick)' at the end of a token is its detail; '...: 3' or '...: X' at the end is its rating.
_PAREN_RE = re.compile(r"^(?P<body>[^()]*?)\s*(?:\((?P<detail>.*)\))?$")
_ERRATA_RE = re.compile(r"\s*\[\s*errata\s*\]", re.IGNORECASE)   # 'Throw[ERRATA]' is just Throw
# a rating glued to the keyword: 'Breaker1', 'Desperation4', 'BruteBreaker1'
_GLUED_VALUE_RE = re.compile(r"^(?P<base>.*\D)\s*(?P<num>\d{1,3})$")
_VALUE_RE = re.compile(r"^(?P<head>.+?)\s*:\s*(?P<value>-?\d+|X)$")


def split_top_level(s, sep=" - "):
    """Split on `sep`, ignoring separators inside parentheses."""
    parts, buf, depth, i = [], [], 0, 0
    while i < len(s):
        ch = s[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if depth == 0 and s.startswith(sep, i):
            parts.append("".join(buf))
            buf = []
            i += len(sep)
            continue
        buf.append(ch)
        i += 1
    parts.append("".join(buf))
    return [p.strip() for p in parts if p.strip()]


def parse_keywords(s):
    """Split a keyword line into raw tokens (no keyword list needed).
    Items are (head, value, detail): value is an int, 'X' (a variable rating) or None.
    'Fury - Kick - Powerful: 3' -> [('Fury', None, None), ('Kick', None, None), ('Powerful', 3, None)]
    'Chun Li: Multiple: 2'      -> [('Chun Li: Multiple', 2, None)]
    'AlgolCombo(Kick)'          -> [('AlgolCombo', None, 'Kick')]
    The head may still carry a qualifier ('BrutePowerful'); resolve_keywords splits it off.
    Raises ValueError on junk."""
    if not s:
        return []
    out = []
    for token in split_top_level(s):
        token = _ERRATA_RE.sub("", token).strip()
        if not token:
            continue
        m = _PAREN_RE.match(token)
        if not m:
            raise ValueError(f"Cannot parse keyword token: {token!r} (in {s!r})")
        body = m["body"].strip()
        detail = (m["detail"] or "").strip() or None
        v = _VALUE_RE.match(body)
        if v:
            head = v["head"].strip()
            value = "X" if v["value"] == "X" else int(v["value"])
        else:
            head, value = body, None
        if not head or "::" in head or head.startswith(":") or head.endswith(":"):
            raise ValueError(f"Cannot parse keyword token: {token!r} (in {s!r})")
        out.append((head, value, detail))
    return out


def parse_symbols(s):
    """'all;evil;void' -> [('all', False), ('evil', False), ('void', False)]
    'at_earth' -> [('earth', True)]   (at_ prefix = attuned)"""
    if not s:
        return []
    out = []
    for token in s.split(";"):
        token = token.strip()
        if not token:
            continue
        if token.startswith("at_"):
            out.append((token[3:], True))
        else:
            out.append((token, False))
    return out


def count_symbols(s):
    """Like parse_symbols, but repeated symbols are counted:
    'infinity;infinity;infinity' -> [('infinity', False, 3)]
    'at_earth;at_earth;earth'    -> [('earth', True, 2), ('earth', False, 1)]
    Order of first appearance is kept."""
    counts = {}
    for symbol, attuned in parse_symbols(s):
        counts[(symbol, attuned)] = counts.get((symbol, attuned), 0) + 1
    return [(symbol, attuned, n) for (symbol, attuned), n in counts.items()]


def parse_formats(s):
    """'Hero Too - Retro - Legacy' -> ['Hero Too', 'Retro', 'Legacy']"""
    return split_top_level(s) if s else []


CHAR_TRAIT = "Char. Trait"


def load_keywords(path):
    """Read db/data/keywords.csv -> {'powerful': ('Powerful', True), ...}.
    Lines starting with # are comments; the first other line is the header."""
    import csv
    with open(path, newline="", encoding="utf-8") as f:
        lines = [ln for ln in f if ln.strip() and not ln.lstrip().startswith("#")]
    known = {}
    for row in csv.DictReader(lines):
        name = (row.get("name") or "").strip()
        if not name:
            continue
        flag = (row.get("has_value") or "").strip().lower()
        if flag not in ("true", "false"):
            raise ValueError(f"keywords.csv: has_value for {name!r} must be true or false")
        known[name.lower()] = (name, flag == "true")
    return known


def _alias_key(name):
    return re.sub(r"\s+", " ", name.strip()).lower()


def load_aliases(path):
    """Read db/data/aliases.csv (columns: alias, canonical) -> {'chun li': 'Chun-Li', ...}."""
    import csv
    with open(path, newline="", encoding="utf-8") as f:
        lines = [ln for ln in f if ln.strip() and not ln.lstrip().startswith("#")]
    aliases = {}
    for row in csv.DictReader(lines):
        alias = (row.get("alias") or "").strip()
        canonical = (row.get("canonical") or "").strip()
        if alias and canonical:
            aliases[_alias_key(alias)] = canonical
    return aliases


def canonical_name(name, aliases, applied=None):
    """Rewrite one name to its canonical spelling. `applied` (a Counter) counts rewrites."""
    name = name.strip()
    canonical = (aliases or {}).get(_alias_key(name))
    if canonical is None or canonical == name:
        return name
    if applied is not None:
        applied[f"{name} -> {canonical}"] += 1
    return canonical


def canonical_requirement(requirement, aliases, applied=None):
    """A requirement may list alternatives: 'Benimaru/Goro/Kyo' means any of them satisfies it.
    Each alternative gets its canonical spelling; the result is joined with '/'."""
    parts = [p.strip() for p in requirement.split("/") if p.strip()]
    return "/".join(canonical_name(p, aliases, applied) for p in parts)


def find_spelling_variants(names):
    """Groups of names that differ only in case, spacing or punctuation, e.g.
    ['Chun Li', 'Chun-Li']. Names may be '/'-separated lists. Returns a list of sorted lists."""
    groups = {}
    for entry in names:
        for name in entry.split("/"):
            name = name.strip()
            if name:
                groups.setdefault(re.sub(r"[^a-z0-9]", "", name.lower()), set()).add(name)
    return [sorted(g) for g in groups.values() if len(g) > 1]


def _split_qualified(head, known):
    """'BrutePowerful' -> ('Brute', 'Powerful'); 'Ranged-Stun' -> ('Ranged', 'Stun').
    Looks for a known keyword (exact capitalisation) at the end of `head` with something in
    front of it. Returns (qualifier, canonical keyword name) or None."""
    best = None
    for canon, _ in known.values():
        if canon == CHAR_TRAIT or len(head) <= len(canon) or not head.endswith(canon):
            continue
        prefix = head[: -len(canon)].rstrip(" -:")
        if prefix and (best is None or len(canon) > len(best[1])):
            best = (prefix, canon)
    return best


def resolve_keywords(parsed, known, aliases=None, applied=None):
    """Turn parse_keywords() output into (rows, problems).

    rows are (keyword_name, value, detail, requirement):
      - A keyword may carry a requirement: who or what it applies under (a character name or
        trait, or a game state such as Deadlock or Desperation). It is written in front of the
        keyword, joined ('BrutePowerful'), spaced ('Charlie Only'), hyphenated ('Ranged-Stun')
        or with a colon ('Chun Li: Multiple: 2').
      - A rating of X (variable) is stored as value None with detail 'X'.
      - A token that matches no keyword and carries no rating/detail is a character trait:
        ('Char. Trait', None, token, None).
    A requirement may list alternatives ('Benimaru/Goro/Kyo': any of them will do). With
    `aliases` (see load_aliases), spelling variants of names are rewritten to one canonical
    spelling, in requirements and in trait names.
    Anything suspicious (rating on an unrated keyword, unknown keyword with a rating/detail,
    exact duplicates) is reported in `problems` instead."""
    rows, problems, seen = [], [], set()
    trait = known.get(CHAR_TRAIT.lower())
    for head, value, detail in parsed:
        requirement = None
        name = head
        if value is None and ":" not in head:
            g = _GLUED_VALUE_RE.match(head)
            if g:
                base = g["base"].strip()
                if known.get(base.lower()) or _split_qualified(base, known):
                    name, value = base, int(g["num"])
        if ":" in name:
            requirement, name = (p.strip() for p in name.rsplit(":", 1))
            if not requirement or not name:
                problems.append(f"Cannot read keyword {head!r}")
                continue

        entry = known.get(name.lower())
        if entry is None and requirement is None:
            split = _split_qualified(name, known)
            if split:
                requirement, canon = split
                entry = known[canon.lower()]

        if requirement:
            requirement = canonical_requirement(requirement, aliases, applied)

        if entry is not None:
            canon, has_value = entry
            if value is not None and not has_value:
                problems.append(f"{canon!r} has a rating ({value}) but has_value is false in keywords.csv")
                continue
            if value == "X":
                if detail is not None:
                    problems.append(f"{canon!r} has both a rating of X and the detail {detail!r}")
                    continue
                value, detail = None, "X"
            row = (canon, value, detail, requirement)
        else:
            if value is not None or detail is not None or requirement is not None:
                problems.append(f"Unknown keyword {head!r} with a rating, detail or requirement; add it to keywords.csv")
                continue
            if trait is None:
                problems.append(f"{head!r} looks like a character trait but {CHAR_TRAIT!r} is missing from keywords.csv")
                continue
            row = (trait[0], None, canonical_name(head, aliases, applied), None)

        key = (row[0].lower(), (row[3] or "").lower(), (row[2] or "").lower())
        if key in seen:
            problems.append(f"Duplicate keyword entry {row[0]!r} (requirement {row[3]!r}, detail {row[2]!r})")
            continue
        seen.add(key)
        rows.append(row)
    return rows, problems


def normalize_date(s):
    """'2010-12-00' -> '2010-12-01'; '2010-00-00' -> '2010-01-01'; '0000-00-00' or junk -> None."""
    if not s:
        return None
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", str(s).strip())
    if not m:
        return None
    year, month, day = (int(g) for g in m.groups())
    if year == 0:
        return None
    try:
        return date(year, month or 1, day or 1).isoformat()
    except ValueError:
        return None


ZONES = ("high", "mid", "low")


def normalize_zone(v):
    """'Mid' -> 'mid'. Anything that is not high/mid/low (None, '', an icon path) -> None."""
    z = str(v).strip().lower() if v is not None else ""
    return z if z in ZONES else None


# ---- ability types in rules text ---------------------------------------------

def _header_end(line):
    """Index of the first ':' that is not inside [brackets], or -1."""
    depth = 0
    for i, ch in enumerate(line):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth = max(0, depth - 1)
        elif ch == ":" and depth == 0:
            return i
    return -1


@lru_cache(maxsize=8)
def _ability_regex(tokens):
    alt = "|".join(re.escape(t) for t in sorted(tokens, key=len, reverse=True))
    return re.compile(
        r"^(?:\{[^}]*\}\s*)*"                      # leading symbols such as {7X}
        r"(?:(?P<qualifier>[A-Z][\w'.\u2019-]*(?:\s+[A-Z][\w'.\u2019-]*)*?)\s+)?"
        r"(?P<type>" + alt + r")\b(?P<rest>.*)$"
    )


def extract_ability_types(rules_text, ability_tokens):
    """Which ability types does this rules text contain?

    `ability_tokens` maps every way a type is written to its lowercase name, e.g.
    {'Enhance': 'enhance', 'E': 'enhance', 'Response': 'response', 'R': 'response', ...}
    (see load_ability_types). The scrape often abbreviates a type to its first letter.

    A line is an ability when the text before its first ':' (outside [brackets]) looks like
    '[Words ]<Type>[ costs or limits]', e.g. 'Enhance Mill 1', 'E Commit 1 foundation',
    'Monster Blitz Lose 2 health', 'Combo E'. Words in front of the type are ignored here:
    they are requirements, and requirements never give the card keywords or traits.

    Returns (types, unrecognized):
      types        - sorted unique lowercase type names, e.g. ['blitz', 'response']
      unrecognized - short headers that look like abilities but start with no known type
                     (e.g. 'Mystery Move'), so you can decide whether to add a type."""
    regex = _ability_regex(tuple(ability_tokens))
    found, unrecognized = set(), []
    for line in re.split(r"\n+", rules_text or ""):
        line = line.strip()
        end = _header_end(line)
        if end < 0:
            continue
        header = line[:end].strip()
        m = regex.match(header)
        if m:
            found.add(ability_tokens[m["type"]])
        elif header and len(header) <= 50:
            unrecognized.append(header)
    return sorted(found), unrecognized


def load_names(path):
    """Read a one-column CSV with header 'name' (# comments allowed) -> list of names."""
    names = []
    with open(path, encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if not ln or ln.startswith("#") or ln.lower() == "name":
                continue
            names.append(ln)
    return names


def load_ability_types(path):
    """Read db/data/ability_types.csv (columns: name, abbreviation) ->
    {'Blitz': 'blitz', 'B': 'blitz', 'Enhance': 'enhance', 'E': 'enhance', ...}"""
    import csv
    with open(path, newline="", encoding="utf-8") as f:
        lines = [ln for ln in f if ln.strip() and not ln.lstrip().startswith("#")]
    tokens = {}
    for row in csv.DictReader(lines):
        name = (row.get("name") or "").strip()
        if not name:
            continue
        tokens[name] = name.lower()
        abbreviation = (row.get("abbreviation") or "").strip()
        if abbreviation:
            tokens[abbreviation] = name.lower()
    return tokens
