#!/usr/bin/env python3
"""
Scraper for the card listing at uvsultra.online (listing_cards.php).

Usage examples
--------------
# 1) Test the parser on HTML you saved from the browser (no network needed):
python uvs_scraper.py --from-file page1.html

# 2) Scrape everything (request format confirmed from DevTools: POST, 0-based "page"):
python uvs_scraper.py --out cards --delay 1.5

# 3) With a login cookie, read from an env var (never paste cookies into chats):
UVS_COOKIE="PHPSESSID=xxxx" python uvs_scraper.py --out cards

# 4) Also download images:
python uvs_scraper.py --out cards --images

Output: <out>.jsonl (one card per line, written as it goes), <out>.csv at the end.
Requires: pip install requests beautifulsoup4
"""
import argparse
import csv
import json
import math
import os
import re
import sys
import time
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup, Comment, NavigableString

BASE = "https://uvsultra.online/"
PER_PAGE = 50  # the site's SQL uses LIMIT <offset>, 50

# Form fields the site's search form sends with every request (captured from
# DevTools). Empty values = no filter. Override with --field key=value, e.g.
#   --field spotlightDD=aot     (only one set)   --field name=Bison
DEFAULT_FIELDS = {
    "name": "", "card_text": "", "spotlightDD": "",
    "difficulty_operand": "=", "difficulty": "",
    "keyword_text": "",
    "bm_operand": "=", "block": "",
    "as_operand": "=", "speed": "",
    "ad_operand": "=", "damage": "",
    "ac_operand": "=", "ability_count": "",
    "kc_operand": "=", "keyword_count": "",
    "v_operand": "=", "vitality": "",
    "custom_format": "",
}


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------
def _int(s):
    return int(s) if s is not None and re.fullmatch(r"[+-]?\d+", s) else None


def _zone_from_img(img):
    if img is None:
        return None
    return img.get("title") or re.sub(r".*(low|mid|high)\.png.*", r"\1", img.get("src", ""))


def parse_card(div):
    c = {}

    # ext code / collector number / card type come from the hover handler
    hover = div.find(attrs={"onmouseover": True})
    m = re.search(r"preview2\('([^']*)',\s*'([^']*)',\s*'([^']*)'\)", hover["onmouseover"]) if hover else None
    if m:
        c["ext_code"], c["number_str"], c["type_slug"] = m.groups()

    m = re.search(r"card\.php\?id=(\d+)", str(div))
    c["id"] = int(m.group(1)) if m else None
    c["name"] = (div.find("h1").get_text(strip=True) if div.find("h1") else None)

    info = div.select_one(".card-important-info")
    if info:
        parts = [p.strip() for p in info.get_text("|").split("|") if p.strip()]
        c["type"] = parts[0] if parts else None
        c["rarity"] = parts[1] if len(parts) > 1 else None

    # --- cd1: set / block / formats
    cd1 = div.select_one(".cd1")
    if cd1:
        texts = [str(n).strip() for n in cd1.children
                 if isinstance(n, NavigableString) and not isinstance(n, Comment) and str(n).strip()]
        m = re.search(r"Set\s+(\d+)", texts[0]) if texts else None
        c["set_number"] = int(m.group(1)) if m else None
        c["block"] = texts[1] if len(texts) > 1 else None
        c["formats"] = texts[2] if len(texts) > 2 else None
        span = cd1.find("span", title=True)
        if span:
            c["release_date"] = span["title"]
            a = span.find("a")
            if a:
                c["extension"] = a.get_text(strip=True)
                m = re.search(r"id=(\d+)", a.get("href", ""))
                c["extension_id"] = int(m.group(1)) if m else None
            m = re.search(r"#(\S+)", span.get_text())
            c["collector_number"] = m.group(1) if m else None

    # --- cd2: keywords + rules text
    cd2 = div.select_one(".cd2")
    if cd2:
        # keywords = leading line made only of <strong> tags, ended by a <br>
        keywords = None
        first_br = cd2.find("br")
        if first_br is not None:
            lead = []
            for sib in first_br.previous_siblings:
                lead.append(sib)
            lead.reverse()
            tags = [x for x in lead if getattr(x, "name", None)]
            stray = [str(x).strip() for x in lead
                     if isinstance(x, NavigableString) and str(x).strip() not in ("", "-")]
            if tags and all(t.name == "strong" for t in tags) and not stray:
                keywords = " - ".join(t.get_text("", strip=True) for t in tags if t.get_text(strip=True))
                keywords = re.sub(r"\s*:\s*", ": ", keywords)
        # glossary tooltips (abbr title="...") are dropped; text is kept
        for br in cd2.find_all("br"):
            br.replace_with("\n")
        raw = re.sub(r"[ \t]+", " ", cd2.get_text())
        lines = [l.strip() for l in raw.split("\n")]
        text = re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()
        if keywords:
            text = text.split("\n", 1)[1].strip() if "\n" in text else ""
        c["keywords"] = keywords
        c["text"] = text

    # --- cd3: symbols + stats
    cd3 = div.select_one(".cd3")
    if cd3:
        icons = [i.get("alt") for i in cd3.find_all("img") if i.get("alt")]
        c["symbols"] = ";".join(icons)
        imgs = cd3.find_all("img", src=True)
        block_img = next((i for i in imgs if "block" in i["src"]), None)
        atk_img = next((i for i in imgs if "attack" in i["src"] and "block" not in i["src"]
                        and "/icons/at_" not in i["src"]), None)
        for br in cd3.find_all("br"):
            br.replace_with("\n")
        t = cd3.get_text()
        g = lambda pat: (re.search(pat, t).group(1) if re.search(pat, t) else None)
        c["difficulty"] = _int(g(r"Difficulty\s*:\s*(\d+)"))
        c["control"] = _int(g(r"Control\s*:\s*(\d+)"))
        c["block_modifier"] = _int(g(r"Block\s*:\s*([+-]?\d+)"))
        c["block_zone"] = _zone_from_img(block_img) if c["block_modifier"] is not None else None
        m = re.search(r"Attack\s*:\s*(\d+)\s*/\s*(\d+)", t)
        c["attack_speed"] = int(m.group(1)) if m else None
        c["attack_damage"] = int(m.group(2)) if m else None
        c["attack_zone"] = _zone_from_img(atk_img) if m else None
        c["hand_size"] = _int(g(r"Hand size\s*:\s*(\d+)"))
        c["vitality"] = _int(g(r"Vitality\s*:\s*(\d+)"))

    # --- image
    img = div.select_one("img.mini_image")
    if img:
        c["image_mini"] = urljoin(BASE, img["src"].split("?")[0])
    c["url"] = urljoin(BASE, f"showcard.php?id={c['id']}") if c.get("id") else None
    return c


def parse_listing(html):
    soup = BeautifulSoup(html, "html.parser")
    cards = []
    for div in soup.select("div.card"):
        if div.select_one("h1") and div.select_one(".card_title"):
            cards.append(parse_card(div))
    m = re.search(r"([\d,]+)\s+Results", soup.get_text())
    total = int(m.group(1).replace(",", "")) if m else None
    return cards, total


# --------------------------------------------------------------------------
# Fetching
# --------------------------------------------------------------------------
def make_session(args):
    s = requests.Session()
    s.headers["User-Agent"] = args.user_agent
    s.headers["X-Requested-With"] = "XMLHttpRequest"
    s.headers["Origin"] = BASE.rstrip("/")
    s.headers["Referer"] = BASE
    cookie = os.environ.get("UVS_COOKIE")
    if cookie:
        s.headers["Cookie"] = cookie
    return s


def fetch_page(s, args, page):
    """CONFIG: the request format must match what the site's send_form() does.
    Check DevTools > Network > listing_cards.php and adjust --method /
    --page-param / --field."""
    data = dict(DEFAULT_FIELDS)
    data.update(dict(kv.split("=", 1) for kv in args.field))
    data[args.page_param] = page + args.page_base
    url = urljoin(BASE, args.endpoint)
    for attempt in range(4):
        try:
            r = s.post(url, data=data, timeout=30) if args.method == "POST" \
                else s.get(url, params=data, timeout=30)
            r.raise_for_status()
            return r.text
        except requests.RequestException as e:
            wait = 2 ** attempt * 2
            print(f"  ! page {page}: {e} (retry in {wait}s)", file=sys.stderr)
            time.sleep(wait)
    raise RuntimeError(f"giving up on page {page}")


def download(s, url, dest):
    if os.path.exists(dest):
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    r = s.get(url, timeout=30)
    if r.ok:
        with open(dest, "wb") as f:
            f.write(r.content)


def write_csv(jsonl_path, csv_path):
    rows = [json.loads(l) for l in open(jsonl_path, encoding="utf-8")]
    keys = []
    for r in rows:
        for k in r:
            if k not in keys:
                keys.append(k)
    with open(csv_path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)


# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-file", nargs="+", help="parse saved HTML file(s) instead of fetching")
    ap.add_argument("--out", default="cards")
    ap.add_argument("--endpoint", default="listing_cards.php")
    ap.add_argument("--method", default="POST", choices=["POST", "GET"])
    ap.add_argument("--page-param", default="page", help="name of the page field")
    ap.add_argument("--page-base", type=int, default=0, help="value sent for the first page (0 or 1)")
    ap.add_argument("--field", action="append", default=[], help="extra form field, key=value (repeatable)")
    ap.add_argument("--start", type=int, default=0, help="first page index (0-based)")
    ap.add_argument("--max-pages", type=int, default=None)
    ap.add_argument("--delay", type=float, default=1.5, help="seconds between requests")
    ap.add_argument("--images", action="store_true", help="download mini images")
    ap.add_argument("--user-agent", default="uvs-personal-scraper/1.0 (contact: you@example.com)")
    args = ap.parse_args()

    jsonl = f"{args.out}.jsonl"
    seen = set()
    if os.path.exists(jsonl):
        seen = {json.loads(l)["id"] for l in open(jsonl, encoding="utf-8")}
        print(f"Resuming: {len(seen)} cards already in {jsonl}")

    s = make_session(args)
    out = open(jsonl, "a", encoding="utf-8")

    def handle(cards):
        new = 0
        for c in cards:
            if c["id"] in seen:
                continue
            seen.add(c["id"])
            out.write(json.dumps(c, ensure_ascii=False) + "\n")
            new += 1
            if args.images and c.get("image_mini"):
                download(s, c["image_mini"], f"{args.out}_images/{c['ext_code']}/{c['number_str']}-mini.jpg")
                download(s, c["image_mini"].replace('-mini', '-preview'), f"{args.out}_images/{c['ext_code']}/{c['number_str']}-preview.jpg")
                download(s, c["image_mini"].replace('-mini', ''), f"{args.out}_images/{c['ext_code']}/{c['number_str']}.jpg")
        out.flush()
        return new

    if args.from_file:
        for path in args.from_file:
            cards, total = parse_listing(open(path, encoding="utf-8").read())
            print(f"{path}: {len(cards)} cards (site total: {total}), {handle(cards)} new")
    else:
        prev_ids, page, total_pages = None, args.start, None
        while True:
            if args.max_pages is not None and page - args.start >= args.max_pages:
                break
            cards, total = parse_listing(fetch_page(s, args, page))
            ids = [c["id"] for c in cards]
            if not cards:
                print(f"page {page}: no cards, stopping")
                break
            if ids == prev_ids:
                print(f"page {page}: identical to previous page - the page parameter is probably "
                      f"wrong (--page-param/--page-base/--method). Stopping.")
                break
            prev_ids = ids
            if total and total_pages is None:
                total_pages = math.ceil(total / PER_PAGE)
                print(f"Site reports {total} cards = {total_pages} pages")
            new = handle(cards)
            print(f"page {page + 1}/{total_pages or '?'}: {len(cards)} cards, {new} new")
            page += 1
            if total_pages and page >= total_pages:
                break
            time.sleep(args.delay)

    out.close()
    write_csv(jsonl, f"{args.out}.csv")
    print(f"Done. {len(seen)} cards -> {jsonl}, {args.out}.csv")


if __name__ == "__main__":
    main()