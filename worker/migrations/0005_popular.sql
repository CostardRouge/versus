-- The Popular section (worker/src/registry.ts, popularBoards): the public boards of one language, read on every
-- gallery (cached at the edge). A partial index on just those rows, so the query reads them and no other board;
-- its WHERE repeats the query's two terms word for word, which is what lets SQLite use it.
CREATE INDEX boards_popular ON boards (lang, featured, recent, voters) WHERE hidden = 0 AND (featured = 1 OR template != '');
