-- Where a card's images live, relative to wherever they are hosted:
--   <key>-mini.jpg, <key>-preview.jpg, <key>.jpg
-- image_mini_url is kept as the original source address.
ALTER TABLE cards ADD COLUMN image_key text;

UPDATE cards c
SET image_key = s.code || '/' || c.number
FROM sets s
WHERE s.id = c.set_id AND c.image_mini_url IS NOT NULL;