# Universus database

## Start
    cp .env.example .env          # then edit the password
    docker compose up -d --build  # builds images, starts Postgres, applies migrations

## Common commands
    docker compose up migrate                 # apply new migrations only
    docker compose exec db psql -U universus -d universus
    docker compose exec -T db psql -U universus -d universus < db/seeds/dev_seed.sql
    docker compose down                       # stop, keep data
    docker compose down -v                    # stop and DESTROY local data

## Change the schema
Never edit a migration that has already been applied. Add a new file, e.g.
    db/migrations/V2__add_something.sql
then run `docker compose up migrate`.

## Images
- docker/postgres.Dockerfile : the database
- docker/migrate.Dockerfile  : Flyway with db/migrations baked in
In compose, ./db/migrations is mounted over the baked-in copy for convenience.
For CI/production, build and push the migrate image and run it against your
database with FLYWAY_URL / FLYWAY_USER / FLYWAY_PASSWORD set.

## Import scraped cards
    pip install "psycopg[binary]"
    python3 scripts/test_cardparse.py            # parser self-test, no database needed
    python3 scripts/import_cards.py cards.jsonl  # JSON array or one JSON object per line
The import is one transaction and safe to re-run; unchanged cards are skipped.
Missing formats, symbols and keywords are created automatically and listed at the end.

## Keywords and character traits
The keyword list lives in `db/data/keywords.csv` and is loaded on every import. Character
traits (Brawler, Hunter, ...) are stored as the keyword `Char. Trait` with the trait name in
`detail`. Any token on a card that is not in the keyword list is treated as a trait, and the
import summary lists every trait found so a missing keyword is easy to spot. After editing
the CSV, re-run the import with `--force`.

## Ability types and rules-text search
`cards.ability_types` lists which ability types a card has (`{blitz,response}`), worked out from the
rules text using `db/data/ability_types.csv` (Blitz, Enhance, Form, Response). Filter with array
operators: `@>` for AND, `&&` for OR. Words in front of a type ("Monster Blitz", "First Form") are
not stored separately and never give a card a keyword or trait; find them with full-text search over
`cards.search`. After editing the types list, re-run the import with `--force`.
