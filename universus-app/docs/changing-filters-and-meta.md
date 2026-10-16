# Changing filters, /meta and the search UI

## How a filter travels

```
database column
   -> packages/shared   the filter's type and its parser (what the URL text means)
   -> apps/api          parseQuery.ts   query string -> validated params
                        cardQuery.ts    params -> SQL (values always as $1, $2, ...)
                        server.ts       GET /meta: what the UI is allowed to offer
   -> apps/web          api.ts + App.tsx   controls -> URL parameters
```

`/meta` does not search anything. It tells the UI which options exist (card types, formats,
keywords, stats and their ranges), so the UI draws its controls from data instead of hard-coding
them. `/cards` does the searching, from the URL parameters the controls produce.

## Checklist: add a new filter

1. **Shared:** add the filter type and a parser that throws `FilterError` on bad input
   (see `stats.ts`), export it from `index.ts`, and add tests next to it.
2. **API, `parseQuery.ts`:** read the new query parameter and call the parser.
3. **API, `cardQuery.ts`:** add the field to `CardSearchParams` and push a condition onto
   `where`. Use `add(value)` for every user-supplied value. Column names must come from a fixed
   list in the code (like `STAT_COLUMNS`), never from the URL.
4. **API, `server.ts`:** if the UI needs options for it, add them to `/meta`.
5. **Shared, `types.ts`:** add the new fields to `MetaResponse` (and any item types).
6. **Web, `App.tsx`:** add state, a control, and one line in `search()` that adds the URL
   parameter.
7. Run `npm test` and `npm run typecheck`.

Tip: change the types first (step 5), then run `npm run typecheck`. TypeScript lists every file
that now needs updating.

## Worked example: filtering by Difficulty, Control, Block modifier

The database already has the columns. This is what was added:

- `packages/shared/src/stats.ts`: the list of stats (`STATS`), a parser for `difficulty:lte:3`.
- API `cardQuery.ts`: `STAT_COLUMNS` (the allowed columns) and one `where` line per filter.
- API `/meta`: `stats: [{ key, label, min, max }]`, with the lowest and highest value in the data.
- Web: one min/max pair of boxes per entry in `meta.stats`.

To add Speed or Hand size to the same box you only edit `STATS` and `STAT_COLUMNS`: the UI is built
from `/meta`, so nothing in `App.tsx` changes. (They are already included.)

A card with no value for a stat (a character has no difficulty) never matches a filter on it.

## Changing the shape of what /meta returns

Say you want card types as `{ value, label }` instead of plain strings, so the UI can show
nicer names:

1. `types.ts`: `cardTypes: { value: string; label: string }[]`
2. `server.ts`: map the rows, e.g. `{ value: r.card_type, label: titleCase(r.card_type) }`
3. `App.tsx`: render `meta.cardTypes.map(t => <option value={t.value}>{t.label}</option>)`

After step 1, `npm run typecheck` points at steps 2 and 3. The search itself is unaffected,
because `/cards` still receives `type=attack`.

## Changing a control's form

The controls only decide which URL parameters get sent, so you can swap one for another without
touching the API. For example, the card type dropdown can become checkboxes, because
`/cards` already accepts `type` more than once (`type=attack&type=foundation`):

- state: `useState('')` becomes `useState<string[]>([])`
- control: one `<input type="checkbox">` per entry in `meta.cardTypes`, toggling that value in the
  array (see `toggleAbility` for the same pattern)
- in `search()`: `for (const t of cardTypes) params.append('type', t)`

The same idea works for keywords: the free-text box can become a picker built from
`meta.keywords` (which says whether each keyword takes a rating via `hasValue`) that writes
`powerful:gte:2`-style text into the same `keyword` parameter.
