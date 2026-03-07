const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('monitor.db');

db.all("SELECT * FROM keywords", (err, rows) => {
    if (err) console.error(err);
    else console.log(rows);
    db.close();
});
