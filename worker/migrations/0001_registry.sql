-- Board registry for the admin view (see worker/src/registry.ts).
CREATE TABLE boards (
  alias TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  items INTEGER NOT NULL,
  votes INTEGER NOT NULL,
  voters INTEGER NOT NULL,
  created INTEGER NOT NULL,
  active INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX boards_active ON boards (active);
