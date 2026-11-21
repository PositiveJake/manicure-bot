CREATE TABLE slot_selections (
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  selected INTEGER NOT NULL CHECK (selected IN (0, 1)),
  PRIMARY KEY (date, time)
);
