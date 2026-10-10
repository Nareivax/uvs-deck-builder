# Mobile app (not created yet)

This folder is a placeholder. The phone app is step 5-6 of the plan, after the API and the web
deck builder exist.

When you get there:

1. Create the Expo app here, following Expo's current monorepo guide. React Native pins its own
   React version, so it may need a different `react` than `apps/web`; that is the usual monorepo
   catch and the guide covers it.
2. Add `@universus/shared` as a dependency to reuse the types, the keyword/ability filter parser
   and the deck text parser/writer.
3. Read cards and decks through a small data layer (an interface with `searchCards`, `getDeck`,
   `saveDeck`, ...) so screens don't care whether data comes from the API or the local SQLite
   copy. Build the API-backed version first, then add the local one.
4. Offline: local SQLite catalog (initial snapshot bundled in the app, then changes since the
   last sync) and a queue of unsent deck changes. Postgres-only features need local equivalents:
   arrays -> JSON text or a join table, `citext` -> `COLLATE NOCASE`, `tsvector` -> FTS5.
