-- One thumbs up (1) or thumbs down (-1) per listener per track.
CREATE TABLE IF NOT EXISTS ratings (
  track  TEXT NOT NULL,
  client TEXT NOT NULL,
  value  INTEGER NOT NULL CHECK (value IN (-1, 1)),
  PRIMARY KEY (track, client)
);
