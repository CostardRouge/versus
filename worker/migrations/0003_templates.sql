-- Official templates and the Popular section (docs/published-boards.md#official-templates): which template a
-- board was made from, how alive it is, and its first three labels, so the public lists need no board to wake.
ALTER TABLE boards ADD COLUMN template TEXT NOT NULL DEFAULT '';
ALTER TABLE boards ADD COLUMN recent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE boards ADD COLUMN top TEXT NOT NULL DEFAULT '[]';

-- One board per template and language.
CREATE UNIQUE INDEX boards_template ON boards (template, lang) WHERE template != '';
