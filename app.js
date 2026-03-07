const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const { Parser } = require('json2csv');
const db = require('./database');
const monitor = require('./monitor');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 3005;

app.use(cors());
app.use(bodyParser.json());

// Log de requisições simplificado para diagnóstico
app.use((req, res, next) => {
    if (!req.url.startsWith('/api/status')) { // Pular status para não poluir
        console.log(`[REQ] ${req.method} ${req.url}`);
    }
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Injetar io no monitor
monitor.setIo(io);

// API Endpoints

// Settings
app.get('/api/settings', async (req, res) => {
    try {
        const webhook = await db.getSetting('discord_webhook');
        res.json({ discord_webhook: webhook });
    } catch (err) {
        console.error('[API Error] GET /api/settings:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', async (req, res) => {
    const { discord_webhook } = req.body;
    try {
        await db.setSetting('discord_webhook', discord_webhook);
        res.json({ success: true });
    } catch (err) {
        console.error('[API Error] POST /api/settings:', err);
        res.status(500).json({ error: err.message });
    }
});

// Export
app.get('/api/export', async (req, res) => {
    const filters = {
        streamer: req.query.streamer,
        platform: req.query.platform,
        startDate: req.query.startDate,
        endDate: req.query.endDate
    };

    try {
        const messages = await db.getAllMessages(filters);

        // Definir campos para o CSV (excluindo 'keyword')
        const fields = ['id', 'streamer_name', 'platform', 'channel_id', 'user_name', 'message', 'timestamp'];
        const json2csvParser = new Parser({ fields });
        const csv = json2csvParser.parse(messages);

        res.header('Content-Type', 'text/csv');
        res.attachment('nyang_mentions_history.csv');
        res.send(csv);
    } catch (err) {
        console.error('[API Error] GET /api/export:', err);
        res.status(500).json({ error: err.message });
    }
});

// Streamers
app.get('/api/streamers', async (req, res) => {
    try {
        const streamers = await db.getStreamers();
        res.json(streamers);
    } catch (err) {
        console.error('[API Error] GET /api/streamers:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/streamers', async (req, res) => {
    const { name, platform, channel_id } = req.body;
    try {
        console.log(`[API] Tentando adicionar streamer: ${name} (${platform})`);
        await db.addStreamer(name, platform, channel_id);

        // Iniciar monitoramento se o monitor global estiver ativo
        if (monitor.getStatus()) {
            await monitor.start();
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[API Error] POST /api/streamers:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/streamers/:id', async (req, res) => {
    try {
        // Buscar dados do streamer antes de deletar para parar o monitor
        const streamers = await db.getStreamers();
        const streamer = streamers.find(s => s.id == req.params.id);

        if (streamer) {
            monitor.stopStreamer(streamer.channel_id, streamer.platform);
        }

        await db.deleteStreamer(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('[API Error] DELETE /api/streamers:', err);
        res.status(500).json({ error: err.message });
    }
});

// Keywords
app.get('/api/keywords', async (req, res) => {
    try {
        const keywords = await db.getKeywords();
        // Nota: db.getKeywords retorna apenas os nomes, mas o front espera objetos com id e keyword
        // Vamos ajustar o database.js oportunamente ou o app.js aqui.
        // Por enquanto, vamos manter a compatibilidade com o front que usa k.id e k.keyword

        // Re-buscando para ter o ID
        const sqlite3 = require('sqlite3').verbose();
        const connection = new sqlite3.Database(path.resolve(__dirname, 'monitor.db'));
        connection.all('SELECT * FROM keywords', (err, rows) => {
            if (err) res.status(500).json({ error: err.message });
            else res.json(rows);
            connection.close();
        });
    } catch (err) {
        console.error('[API Error] GET /api/keywords:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/keywords', async (req, res) => {
    const { keyword } = req.body;
    try {
        await db.addKeyword(keyword);
        res.json({ success: true });
    } catch (err) {
        console.error('[API Error] POST /api/keywords:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/keywords/:id', async (req, res) => {
    try {
        await db.deleteKeyword(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('[API Error] DELETE /api/keywords:', err);
        res.status(500).json({ error: err.message });
    }
});

// Messages
app.get('/api/messages', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const offset = (page - 1) * limit;

    const filters = {
        streamer: req.query.streamer,
        platform: req.query.platform,
        startDate: req.query.startDate,
        endDate: req.query.endDate
    };

    try {
        const messages = await db.getMessages(offset, limit, filters);
        const total = await db.getMessageCount(filters);
        res.json({
            messages,
            pagination: {
                total,
                page,
                limit,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        console.error('[API Error] GET /api/messages:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/messages/:id', async (req, res) => {
    try {
        await db.deleteMessage(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('[API Error] DELETE /api/messages/:id:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/messages', async (req, res) => {
    try {
        await db.clearAllMessages();
        res.json({ success: true });
    } catch (err) {
        console.error('[API Error] DELETE /api/messages:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/status', (req, res) => {
    res.json({ monitoring: monitor.getStatus() });
});

app.post('/api/start', async (req, res) => {
    try {
        await monitor.start();
        res.json({ success: true });
    } catch (err) {
        console.error('[API Error] POST /api/start:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/stop', (req, res) => {
    try {
        monitor.stop();
        res.json({ success: true });
    } catch (err) {
        console.error('[API Error] POST /api/stop:', err);
        res.status(500).json({ error: err.message });
    }
});

// Socket.io connection
io.on('connection', (socket) => {
    socket.emit('monitor_status', monitor.getStatus());
});

app.use((err, req, res, next) => {
    console.error('[Global Error Handler]:', err);
    res.status(500).json({
        error: 'Erro interno no servidor',
        message: err.message
    });
});

server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
