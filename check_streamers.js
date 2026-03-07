const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'monitor.db');
const db = new sqlite3.Database(dbPath);

console.log('--- Current Streamers ---');
db.all('SELECT * FROM streamers', (err, rows) => {
    if (err) console.error(err);
    else console.log(rows);
    db.close();
});
