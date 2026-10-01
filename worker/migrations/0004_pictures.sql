-- Pictures sent for review (docs/published-boards.md#images): how many a board has waiting, so the admin page
-- lists the boards with pictures to review without waking them.
ALTER TABLE boards ADD COLUMN pictures INTEGER NOT NULL DEFAULT 0;
