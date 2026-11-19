CREATE TABLE users (
  tg_id INTEGER PRIMARY KEY,
  username TEXT,
  name TEXT,
  phone TEXT NOT NULL DEFAULT '',
  is_blocked INTEGER NOT NULL DEFAULT 0,
  awaiting_phone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_user_id INTEGER NOT NULL REFERENCES users(tg_id),
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  reminder_chats TEXT NOT NULL DEFAULT '[]',
  reminder_claim_until INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  UNIQUE (date, time)
);

CREATE INDEX idx_users_name ON users(name);
CREATE INDEX idx_bookings_user ON bookings(tg_user_id);
