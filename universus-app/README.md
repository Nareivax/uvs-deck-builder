# Universus deck builder (apps)

A TypeScript monorepo for the web app, the API and (later) the mobile app. The card database
lives in the separate `universus-db` repository.

```
apps/api         Fastify + node-postgres: read-only card endpoints (step 2)
apps/web         React + Vite: card browser, the base for the deck builder (step 3)
apps/mobile      placeholder, see its README
packages/shared  types, keyword/ability filter parsing, deck text parser/writer
```

## Requirements
- Node 22.18 or newer (24 recommended; see `.nvmrc`). Tests use Node's built-in test runner
  with TypeScript type stripping, so there is no extra test tooling.
- The database from `universus-db` running (`docker compose up -d` there), with cards imported.

## Quick start
```
cp .env.example .env     # check DATABASE_URL against your database's .env
npm install
npm run dev:api          # http://localhost:3001  (try /health and /meta)
npm run dev:web          # http://localhost:5173  (proxies /api to the API)
npm test                 # shared + API logic tests
npm run typecheck
```

## API
All read-only for now.

| Endpoint | Purpose |
|---|---|
| `GET /health` | database check |
| `GET /meta` | keywords, formats, sets, ability types, card types (for filter menus) |
| `GET /cards` | search (below) -> `{ items, total, page, pageSize }` |
| `GET /cards/:id` | one card with keywords, symbols and formats |

`GET /cards` parameters (all optional, combined with AND):

| Parameter | Example | Meaning |
|---|---|---|
| `name` | `name=tomura` | part of the card name (case-insensitive) |
| `text` | `text=draw cards` | rules text only; words or a quoted phrase |
| `type` | `type=attack&type=foundation` | card type(s), any of |
| `set` | `set=sf62x` | set code(s), any of |
| `format` | `format=Standard` | legal in this format |
| `keyword` | `keyword=powerful:gte:2` | repeat for several (AND). Forms: `name`, `name:2`, `name:gte:2` (eq, gt, gte, lt, lte), `name:detail:kick`, `name:detail_contains:ki`, `name:requirement:kyo` |
| `stat` | `stat=difficulty:lte:3` | numeric stats: difficulty, control, block_modifier, attack_speed, attack_damage, hand_size, vitality. Forms: `stat:3`, `stat:gte:3` (eq, gt, gte, lt, lte); repeat for several (AND) |
| `keyword_any` | `keyword_any=throw&keyword_any=slam` | same forms as `keyword`, but a card needs only one of them (OR). Can be combined with `keyword` |
| `symbol`, `symbol_any` | `symbol=earth&symbol_any=at_fire` | resource symbols; `earth` is the plain symbol, `at_earth` the attuned one. `symbol` needs all of them, `symbol_any` at least one |
| `ability` | `ability=blitz&ability=response` | ability type(s); also `ability=blitz,response` |
| `ability_match` | `ability_match=any` | `all` (default) or `any` for the ability list |
| `page`, `page_size` | `page=2&page_size=30` | paging (page_size max 200) |

For Only, the name in front of it is the requirement: `keyword=only:requirement:kyo` finds "Kyo Only" cards.

A keyword's requirement (a character name, trait or game state such as Deadlock) is filtered with
`keyword=breaker:requirement:kyo`. A requirement written as a list, like `Benimaru/Goro/Kyo`, matches a
filter for any one of its names.

Character traits are the keyword `Char. Trait` with the trait in `detail`:
`keyword=char. trait:detail:brawler`. Keyword filters read only the card's keyword line; words in
rules text never count as keywords or traits. Bad input returns HTTP 400 with `{ "error": "..." }`.

## Changing filters and /meta
See `docs/changing-filters-and-meta.md` for how a filter travels from the database to the UI, a checklist
for adding one, and how to change the shape of `/meta` or swap a control.

## What has and hasn't been checked
- Tested here: the filter parsers, the deck text parser/writer and the SQL builder (as text, not
  against a database). Shared and the SQL builder also type-check cleanly.
- Not run here: the server, database calls and the React app. They were only syntax-checked,
  because dependencies could not be installed in the environment they were written in. Expect to
  fix small things on first run; the version numbers in the `package.json` files are conservative
  and can be bumped.
- The API assumes the card database as built up to the `cards.ability_types` column (tables
  `cards`, `sets`, `keywords`, `card_keywords`, `card_symbols`, `formats`, `card_formats`). If a
  column name differs, the error shows up on the first request to that endpoint.

## Next steps
1. Run it against your data and fix whatever the first run turns up.
2. Accounts and deck endpoints (save, load, delete with the revision check).
3. Deck builder screen in the web app, with copy/paste import and export from `packages/shared`.
4. Mobile app online-first, then the offline layer.
