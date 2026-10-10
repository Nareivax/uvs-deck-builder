-- Dev-only sample data. Load manually (see README); not run automatically.
-- Requires the V1 migration. The card importer also creates missing formats,
-- symbols and keywords automatically, so this file is optional.
INSERT INTO formats (name) VALUES
    ('Hero Too'),
    ('Rochester Retro'),
    ('Retro'),
    ('Standard'),
    ('Legacy')
ON CONFLICT (name) DO NOTHING;

-- Fill in rules once verified against the official documents, e.g.:
-- UPDATE formats SET character_slots = ?, min_main_size = ?, max_main_size = ?, max_copies = ?
-- WHERE name = 'Standard';
