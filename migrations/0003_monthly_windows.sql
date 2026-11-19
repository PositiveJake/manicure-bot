CREATE TABLE closed_slots (
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  PRIMARY KEY (date, time)
);

CREATE TABLE month_notices (
  month INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  lease_until INTEGER NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (month, owner_id)
);
