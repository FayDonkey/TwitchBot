const sqlite3 = require("sqlite3").verbose();

// Connect to the database (it will create the database file if it doesn't exist)
const db = new sqlite3.Database("./userDB.db");

db.serialize(() => {
  // Create a table for storing user check-in data
  db.run(`CREATE TABLE IF NOT EXISTS checkins (
    username TEXT PRIMARY KEY,
    streak INTEGER,
    lastCheckin TEXT,
    animal TEXT,
    transform_start DATETIME,
    transform_end DATETIME
  )`);
});

db.close();
