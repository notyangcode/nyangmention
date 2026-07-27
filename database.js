const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'monitor.db');
const db = new sqlite3.Database(dbPath);

// Initialize database tables
db.serialize(() => {
    // Chats table
    db.run(`CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        streamer_name TEXT NOT NULL,
        platform TEXT NOT NULL,
        user_name TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp TEXT,
        sentiment TEXT,
        keyword TEXT,
        channel_id TEXT,
        stream_offset INTEGER,
        repeat_count INTEGER DEFAULT 1
    )`);

    // Migração: Adicionar colunas se não existirem
    db.all("PRAGMA table_info(chats)", (err, rows) => {
        const hasSentiment = rows.some(r => r.name === 'sentiment');
        if (!hasSentiment) {
            db.run("ALTER TABLE chats ADD COLUMN sentiment TEXT");
        }
        const hasKeyword = rows.some(r => r.name === 'keyword');
        if (!hasKeyword) {
            db.run("ALTER TABLE chats ADD COLUMN keyword TEXT");
        }
        const hasChannelId = rows.some(r => r.name === 'channel_id');
        if (!hasChannelId) {
            db.run("ALTER TABLE chats ADD COLUMN channel_id TEXT");
        }
        const hasStreamOffset = rows.some(r => r.name === 'stream_offset');
        if (!hasStreamOffset) {
            db.run("ALTER TABLE chats ADD COLUMN stream_offset INTEGER");
        }
        const hasRepeatCount = rows.some(r => r.name === 'repeat_count');
        if (!hasRepeatCount) {
            db.run("ALTER TABLE chats ADD COLUMN repeat_count INTEGER DEFAULT 1");
        }
    });

    // Keywords table
    db.run(`CREATE TABLE IF NOT EXISTS keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword TEXT NOT NULL UNIQUE
    )`);

    // Streamers table
    db.run(`CREATE TABLE IF NOT EXISTS streamers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        channel_id TEXT NOT NULL UNIQUE,
        is_active INTEGER DEFAULT 1
    )`);

    // Settings table (Novo na Fase 3)
    db.run(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )`);
});

const dbManager = {
    // Settings
    getSetting: (key) => {
        return new Promise((resolve, reject) => {
            db.get('SELECT value FROM settings WHERE key = ?', [key], (err, row) => {
                if (err) reject(err);
                else resolve(row ? row.value : null);
            });
        });
    },
    setSetting: (key, value) => {
        return new Promise((resolve, reject) => {
            db.run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    // Keywords
    addKeyword: (keyword) => {
        return new Promise((resolve, reject) => {
            db.run('INSERT OR IGNORE INTO keywords (keyword) VALUES (?)', [keyword.toLowerCase()], function (err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
    },
    getKeywords: () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM keywords', (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(r => r.keyword));
            });
        });
    },
    deleteKeyword: (id) => {
        return new Promise((resolve, reject) => {
            db.run('DELETE FROM keywords WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    // Streamers
    addStreamer: (name, platform, channel_id) => {
        return new Promise((resolve, reject) => {
            const cleanChannel = channel_id ? channel_id.trim().toLowerCase() : '';
            db.run('INSERT OR REPLACE INTO streamers (name, platform, channel_id, is_active) VALUES (?, ?, ?, 1)',
                [name, platform, cleanChannel], function (err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                });
        });
    },
    getStreamers: () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM streamers', (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },
    deleteStreamer: (id) => {
        return new Promise((resolve, reject) => {
            db.run('DELETE FROM streamers WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    // Chats
    insertMessage: (streamerName, platform, userName, message, timestamp, keyword = null, channelId = null, streamOffset = null, repeatCount = 1) => {
        return new Promise((resolve, reject) => {
            const query = `INSERT INTO chats (streamer_name, platform, user_name, message, timestamp, sentiment, keyword, channel_id, stream_offset, repeat_count) 
                           VALUES (?, ?, ?, ?, ?, 'neutral', ?, ?, ?, ?)`;
            db.run(query, [streamerName, platform, userName, message, timestamp, keyword, channelId, streamOffset, repeatCount], function (err) {
                if (err) reject(err);
                else resolve(this.lastID);
            });
        });
    },
    updateMessageCount: (id, count) => {
        return new Promise((resolve, reject) => {
            db.run('UPDATE chats SET repeat_count = ? WHERE id = ?', [count, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },
    findRecentMessage: (streamerName, message, windowSeconds = 300) => {
        return new Promise((resolve, reject) => {
            const windowTime = new Date(Date.now() - (windowSeconds * 1000)).toISOString();
            const query = `SELECT * FROM chats 
                           WHERE streamer_name = ? AND message = ? AND timestamp >= ? 
                           ORDER BY id DESC LIMIT 1`;
            db.get(query, [streamerName, message, windowTime], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
    },
    getMessagesPaged: (page = 1, limit = 15) => {
        const offset = (page - 1) * limit;
        return new Promise((resolve, reject) => {
            db.all('SELECT * FROM chats ORDER BY id DESC LIMIT ? OFFSET ?', [limit, offset], (err, rows) => {
                if (err) reject(err);
                else {
                    db.get('SELECT COUNT(*) as total FROM chats', (err, countResult) => {
                        if (err) reject(err);
                        else resolve({ messages: rows, total: countResult.total, page, limit });
                    });
                }
            });
        });
    },
    getMessages: (offset, limit, filters = {}) => {
        const { streamer, platform, startDate, endDate } = filters;
        let query = 'SELECT * FROM chats';
        const params = [];
        const conditions = [];

        if (streamer) {
            conditions.push('streamer_name = ?');
            params.push(streamer);
        }
        if (platform) {
            conditions.push('platform = ?');
            params.push(platform);
        }
        if (startDate) {
            conditions.push('timestamp >= ?');
            params.push(startDate);
        }
        if (endDate) {
            conditions.push('timestamp <= ?');
            params.push(endDate);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        return new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },

    getMessageCount: (filters = {}) => {
        const { streamer, platform, startDate, endDate } = filters;
        let query = 'SELECT COUNT(*) as count FROM chats';
        const params = [];
        const conditions = [];

        if (streamer) {
            conditions.push('streamer_name = ?');
            params.push(streamer);
        }
        if (platform) {
            conditions.push('platform = ?');
            params.push(platform);
        }
        if (startDate) {
            conditions.push('timestamp >= ?');
            params.push(startDate);
        }
        if (endDate) {
            conditions.push('timestamp <= ?');
            params.push(endDate);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        return new Promise((resolve, reject) => {
            db.get(query, params, (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });
    },
    getAllMessages: (filters = {}) => {
        const { streamer, platform, startDate, endDate } = filters;
        let query = 'SELECT * FROM chats';
        const params = [];
        const conditions = [];

        if (streamer) {
            conditions.push('streamer_name = ?');
            params.push(streamer);
        }
        if (platform) {
            conditions.push('platform = ?');
            params.push(platform);
        }
        if (startDate) {
            conditions.push('timestamp >= ?');
            params.push(startDate);
        }
        if (endDate) {
            conditions.push('timestamp <= ?');
            params.push(endDate);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY id DESC';

        return new Promise((resolve, reject) => {
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    },
    deleteMessage: (id) => {
        return new Promise((resolve, reject) => {
            db.run('DELETE FROM chats WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },
    clearAllMessages: () => {
        return new Promise((resolve, reject) => {
            db.run('DELETE FROM chats', (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }
};

module.exports = dbManager;
