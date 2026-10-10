"""Parsing helpers for scraped Universus card fields. No database needed."""
import re
from functools import lru_cache

_KEYWORD_RE = re.compile(
    r"""^\s*
        (?P<name>[^:()]+?)                  # Powerful, Combo, E Rank, ...
        \s*(?::\s*(?P<value>-?\d+))?        # optional rating:  ': 3'
        \s*(?:\((?P<detail>.*)\))?          # optional detail:  '(Kick)'
        \s*$""",
    re.VERBOSE,
)


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
    """'Fury - Kick - Powerful: 3' -> [('Fury', None, None), ('Kick', None, None),
    ('Powerful', 3, None)]. Items are (name, value, detail). Raises on junk."""
    if not s:
        return []
    out = []
    for token in split_top_level(s):
        m = _KEYWORD_RE.match(token)
        if not m:
            raise ValueError(f"Cannot parse keyword token: {token!r} (in {s!r})")
        value = int(m["value"]) if m["value"] is not None else None
        detail = (m["detail"] or "").strip() or None
        if 'Deadlock' in m["name"]:
            detail = 'Deadlock'
        out.append((m["name"].replace('Deadlock', '').strip(), value, detail))
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


def resolve_keywords(parsed, known):
    """Turn parse_keywords() output into (rows, problems).

    rows are (canonical_keyword_name, value, detail). A token that is not in the
    keyword list is treated as a character trait: ('Char. Trait', None, token).
    Anything suspicious (rating on an unrated keyword, unknown token with a
    rating/detail, exact duplicates) is reported in `problems` instead."""
    rows, problems, seen = [], [], set()
    trait = known.get(CHAR_TRAIT.lower())
    for name, value, detail in parsed:
        entry = known.get(name.lower())
        if entry:
            canon, has_value = entry
            if value is not None and not has_value:
                problems.append(f"{canon!r} has a rating ({value}) but has_value is false in keywords.csv")
                continue
            row = (canon, value, detail)
        else:
            if value is not None or detail is not None:
                problems.append(f"Unknown keyword {name!r} with a rating or detail; add it to keywords.csv")
                continue
            if trait is None:
                problems.append(f"{name!r} looks like a character trait but {CHAR_TRAIT!r} is missing from keywords.csv")
                continue
            row = (trait[0], None, name)
        key = (row[0].lower(), (row[2] or "").lower())
        if key in seen:
            problems.append(f"Duplicate keyword entry {row[0]!r} ({row[2]!r})")
            continue
        seen.add(key)
        rows.append(row)
    return rows, problems


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
def _ability_regex(types):
    alt = "|".join(re.escape(t) for t in sorted(types, key=len, reverse=True))
    return re.compile(
        r"^(?:(?P<qualifier>[A-Z][\w'.\u2019-]*(?:\s+[A-Z][\w'.\u2019-]*)*?)\s+)?"
        r"(?P<type>" + alt + r")\b(?P<rest>.*)$"
    )


def extract_ability_types(rules_text, ability_types):
    """Which ability types does this rules text contain?

    A line is an ability when the text before its first ':' (outside [brackets]) looks like
    '[Words ]<Type>[ costs or limits]'. Words in front of the type ('Monster Blitz',
    'First Form') are ignored here: they are requirements, and requirements never give the
    card keywords or traits. Searching for them is left to full-text search.

    Returns (types, unrecognized):
      types        - sorted unique lowercase type names, e.g. ['blitz', 'response']
      unrecognized - short headers that look like abilities but start with no known type
                     (e.g. 'Mystery Move'), so you can decide whether to add a type."""
    regex = _ability_regex(tuple(ability_types))
    found, unrecognized = set(), []
    for line in re.split(r"\n+", rules_text or ""):
        line = line.strip()
        end = _header_end(line)
        if end < 0:
            continue
        header = line[:end].strip()
        m = regex.match(header)
        if m:
            found.add(m["type"].lower())
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
    return load_names(path)
