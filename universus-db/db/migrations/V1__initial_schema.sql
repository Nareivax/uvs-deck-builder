-- Universus deck builder: PostgreSQL schema
-- Cards are stored per printing, matching the scraped data (one row per
-- set + collector number). Rating values and extra text live on
-- card_keywords. Decks use UUIDs and soft deletes so they can sync offline.
-- Requires PostgreSQL 13+ (gen_random_uuid() is built in).

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------
-- Sets
-- ---------------------------------------------------------------
CREATE TABLE sets (
    id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id     integer NOT NULL UNIQUE,    -- scraper "extension_id"
    code          text    NOT NULL UNIQUE,    -- scraper "ext_code", e.g. 'sf62x'
    name          text    NOT NULL,           -- scraper "extension"
    set_number    integer,
    block         text,                       -- e.g. 'Street Fighter - Block 7'
    release_date  date
);

-- ---------------------------------------------------------------
-- Raw scraped payloads (re-run the import from these without re-scraping)
-- ---------------------------------------------------------------
CREATE TABLE card_scrape_raw (
    source_id   integer PRIMARY KEY,          -- scraper "id"
    payload     jsonb NOT NULL,
    scraped_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Symbols (e.g. 'all', 'earth', 'evil'); "attuned" is a flag on the card link
-- ---------------------------------------------------------------
CREATE TABLE symbols (
    code  text PRIMARY KEY
);

-- ---------------------------------------------------------------
-- Cards (one row per printing)
-- ---------------------------------------------------------------
CREATE TABLE cards (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_id       integer NOT NULL UNIQUE,          -- scraper "id"
    set_id          integer NOT NULL REFERENCES sets(id),
    number          text    NOT NULL,                 -- scraper "number_str", e.g. '027'
    name            text    NOT NULL,
    card_type       text    NOT NULL,                 -- scraper "type_slug": attack, action, ...
    rarity          text,
    rules_text      text,
    ability_types   text[] NOT NULL DEFAULT '{}',   -- derived from rules_text by the importer, e.g. {blitz,response}
    difficulty      smallint,
    control         smallint,
    block_modifier  smallint,
    block_zone      text CHECK (block_zone  IN ('high', 'mid', 'low')),
    attack_zone     text CHECK (attack_zone IN ('high', 'mid', 'low')),
    attack_speed    smallint,
    attack_damage   smallint,
    hand_size       smallint,                         -- characters only
    vitality        smallint,                         -- characters only
    image_mini_url  text,
    source_url      text,
    search          tsvector GENERATED ALWAYS AS (
                        to_tsvector('english',
                            coalesce(name, '') || ' ' || coalesce(rules_text, ''))
                    ) STORED,
    updated_at      timestamptz NOT NULL DEFAULT now(),   -- phones fetch changes by this
    UNIQUE (set_id, number)
);
CREATE INDEX cards_name_idx   ON cards (name);
CREATE INDEX cards_type_idx   ON cards (card_type);
CREATE INDEX cards_search_idx ON cards USING gin (search);
CREATE INDEX cards_ability_types_idx ON cards USING gin (ability_types);

CREATE TABLE card_symbols (
    card_id  integer NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    symbol   text    NOT NULL REFERENCES symbols(code),
    attuned  boolean NOT NULL DEFAULT false,
    quantity smallint NOT NULL DEFAULT 1 CHECK (quantity > 0),   -- times the symbol is printed on the card (A Moment of Rest)
    PRIMARY KEY (card_id, symbol, attuned)
);
CREATE INDEX card_symbols_symbol_idx ON card_symbols (symbol);

-- ---------------------------------------------------------------
-- Keywords (many-to-many, with optional rating value and detail text)
-- The keyword list is maintained in db/data/keywords.csv and loaded by the
-- importer. Character traits (Brawler, Hunter, ...) are stored as the keyword
-- 'Char. Trait' with the trait name in `detail`.
-- ---------------------------------------------------------------
CREATE TABLE keywords (
    id         smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       citext NOT NULL UNIQUE,
    has_value  boolean NOT NULL DEFAULT false,   -- takes a numeric rating, e.g. Powerful: 3
    rules_text text
);

CREATE TABLE card_keywords (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    card_id      integer  NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    keyword_id   smallint NOT NULL REFERENCES keywords(id),
    value        smallint,                       -- NULL for keywords without a rating
    detail       citext,                         -- optional extra text, e.g. Combo(Kick), or 'X' for a variable rating,
                                                 -- or the trait name for Char. Trait
    requirement  citext,                         -- who or what the keyword applies under: a character name or trait,
                                                 -- or a game state such as Deadlock or Desperation
    CONSTRAINT card_keywords_detail_not_blank
        CHECK (detail IS NULL OR length(btrim(detail::text)) > 0),
    CONSTRAINT card_keywords_requirement_not_blank
        CHECK (requirement IS NULL OR length(btrim(requirement::text)) > 0)
);
-- A card may list the same keyword several times with different requirements or details
-- (two Char. Trait rows, Combo(Kick) and Combo(Punch), or the same keyword for two characters)
-- but never an exact duplicate. This index also serves lookups by card_id.
CREATE UNIQUE INDEX card_keywords_unique_idx
    ON card_keywords (card_id, keyword_id,
                      (coalesce(requirement::text, '')), (coalesce(detail::text, '')));
CREATE INDEX card_keywords_kw_idx             ON card_keywords (keyword_id, value);
CREATE INDEX card_keywords_kw_detail_idx      ON card_keywords (keyword_id, detail);
CREATE INDEX card_keywords_kw_requirement_idx ON card_keywords (keyword_id, requirement);

-- ---------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------
CREATE TABLE users (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username    citext NOT NULL UNIQUE,
    email       citext NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- Formats (verify values against the official rules)
-- ---------------------------------------------------------------
CREATE TABLE formats (
    id               smallint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             text NOT NULL UNIQUE,
    -- Rules columns are nullable so the importer can create a format by name
    -- before you have filled in its official deck-building rules.
    character_slots  smallint,
    min_main_size    smallint CHECK (min_main_size >= 0),
    max_main_size    smallint,
    max_copies       smallint,
    CHECK (max_main_size IS NULL OR max_main_size >= min_main_size)
);

-- Which formats each printing is legal in (from the scraped "formats" list)
CREATE TABLE card_formats (
    card_id    integer  NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    format_id  smallint NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
    PRIMARY KEY (card_id, format_id)
);
CREATE INDEX card_formats_format_idx ON card_formats (format_id);

CREATE TABLE format_card_limits (
    format_id   smallint NOT NULL REFERENCES formats(id) ON DELETE CASCADE,
    card_id     integer  NOT NULL REFERENCES cards(id),
    max_copies  smallint NOT NULL CHECK (max_copies >= 0),   -- 0 = banned
    PRIMARY KEY (format_id, card_id)
);

-- ---------------------------------------------------------------
-- Decks (sync-ready)
-- ---------------------------------------------------------------
CREATE TYPE deck_visibility AS ENUM ('private', 'unlisted', 'public');
CREATE TYPE deck_zone       AS ENUM ('character', 'main', 'sideboard');

-- Global counter used as a "what changed since I last synced?" cursor
CREATE SEQUENCE decks_sync_seq;

CREATE TABLE decks (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),  -- clients may supply their own
    user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    format_id       smallint NOT NULL REFERENCES formats(id),
    name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    description     text,
    visibility      deck_visibility NOT NULL DEFAULT 'private',
    forked_from_id  uuid REFERENCES decks(id) ON DELETE SET NULL,
    is_legal        boolean,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    deleted_at      timestamptz,                                  -- soft delete (tombstone)
    revision        integer NOT NULL DEFAULT 1,                   -- bumps on every save; conflict detection
    sync_seq        bigint  NOT NULL DEFAULT nextval('decks_sync_seq')  -- bumps on every save; pull cursor
);
CREATE INDEX decks_user_sync_idx ON decks (user_id, sync_seq);
CREATE INDEX decks_format_idx    ON decks (format_id) WHERE deleted_at IS NULL;
CREATE INDEX decks_public_idx    ON decks (updated_at DESC)
    WHERE visibility = 'public' AND deleted_at IS NULL;

CREATE TABLE deck_cards (
    deck_id      uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    card_id      integer NOT NULL REFERENCES cards(id),
    zone         deck_zone NOT NULL DEFAULT 'main',
    quantity     smallint NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (deck_id, zone, card_id)
);
CREATE INDEX deck_cards_card_idx ON deck_cards (card_id);

CREATE TABLE deck_tags (
    deck_id  uuid NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    tag      citext NOT NULL,
    PRIMARY KEY (deck_id, tag)
);
CREATE INDEX deck_tags_tag_idx ON deck_tags (tag);

-- Every UPDATE on a deck bumps updated_at, revision and sync_seq.
-- IMPORTANT: the API must update the decks row whenever it changes a
-- deck's cards (the push query below does this), so sync sees the change.
CREATE FUNCTION decks_bump() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    NEW.revision   := OLD.revision + 1;
    NEW.sync_seq   := nextval('decks_sync_seq');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER decks_bump_trg
    BEFORE UPDATE ON decks
    FOR EACH ROW EXECUTE FUNCTION decks_bump();

-- Keep card.updated_at fresh for the phone's card-catalog sync
CREATE FUNCTION cards_touch() RETURNS trigger AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cards_touch_trg
    BEFORE UPDATE ON cards
    FOR EACH ROW EXECUTE FUNCTION cards_touch();

