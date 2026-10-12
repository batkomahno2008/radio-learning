-- db.js applies this file at each start, so keep each statement idempotent.
-- Keep the SQL simple: the API tests run it on pg-mem.

-- One thumbs up (1) or thumbs down (-1) per listener per track.
CREATE TABLE IF NOT EXISTS ratings (
  track  TEXT NOT NULL,
  client TEXT NOT NULL,
  value  INTEGER NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (track, client)
);
