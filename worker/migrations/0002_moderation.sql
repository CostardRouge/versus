-- Moderation (docs/published-boards.md#moderation): the board's language, the admin's flags and how many
-- visitors reported it, so the admin page can list and filter without waking every board.
ALTER TABLE boards ADD COLUMN lang TEXT NOT NULL DEFAULT 'en';
ALTER TABLE boards ADD COLUMN reports INTEGER NOT NULL DEFAULT 0;
ALTER TABLE boards ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE boards ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;

CREATE INDEX boards_reports ON boards (reports);
