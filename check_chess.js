const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('monitor.db');

db.all("SELECT * FROM chats WHERE streamer_name = 'Chess'", (err, rows) => {
    if (err) console.error(err);
    else console.log(rows);
    db.close();
});
