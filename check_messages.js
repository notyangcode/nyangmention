const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'monitor.db');
const db = new sqlite3.Database(dbPath);

console.log('--- Recent Messages ---');
db.all('SELECT * FROM chats ORDER BY id DESC LIMIT 5', (err, rows) => {
    if (err) console.error(err);
    else console.log(rows);
    db.close();
});
