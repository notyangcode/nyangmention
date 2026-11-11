// Verificação de saúde das PLATAFORMAS (Twitch, YouTube, Kick) — independente dos canais cadastrados.
// Testa 1x por dia (e 30s após cada boot) se o servidor consegue se conectar a cada plataforma e avisa
// no Discord (via webhook) apenas quando o estado muda: caiu / voltou. Se continuar fora, avisa de novo na próxima verificação.
const axios = require('axios');
const WebSocket = require('ws');
const monitor = require('./monitor');

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // verifica 1x por dia
const FIRST_CHECK_DELAY_MS = 30 * 1000;    // primeira verificação 30s após o boot
const FAILS_BEFORE_ALERT = 1;              // a verificação já faz 1 nova tentativa antes de contar como falha
const RETRY_DELAY_MS = 60 * 1000;          // espera antes da nova tentativa
const REMINDER_MS = 12 * 60 * 60 * 1000;   // reenvia o aviso se continuar fora do ar
const PROBE_TIMEOUT_MS = 12000;

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Abre um WebSocket, executa onOpen e resolve quando isDone(frame) for true. Rejeita em erro/timeout.
function wsProbe(url, { headers, onOpen, isDone }) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { headers, handshakeTimeout: PROBE_TIMEOUT_MS });
        let settled = false;
        const finish = (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { ws.terminate(); } catch (_) {}
            err ? reject(err) : resolve();
        };
        const timer = setTimeout(() => finish(new Error('timeout aguardando resposta do servidor')), PROBE_TIMEOUT_MS);
        ws.on('open', () => { try { onOpen(ws); } catch (e) { finish(e); } });
        ws.on('message', (raw) => {
            try { if (isDone(raw.toString())) finish(); } catch (e) { finish(e); }
        });
        ws.on('error', (e) => finish(new Error(e.message || 'erro de conexão')));
        ws.on('close', (code) => finish(new Error(`conexão fechada antes do esperado (code ${code})`)));
    });
}

const probes = {
    // Twitch: conecta no IRC como anônimo e espera a mensagem de boas-vindas (001)
    async twitch() {
        const nick = 'justinfan' + Math.floor(10000 + Math.random() * 89999);
        await wsProbe('wss://irc-ws.chat.twitch.tv:443', {
            onOpen: (ws) => { ws.send('PASS SCHMOOPIIE'); ws.send(`NICK ${nick}`); },
            isDone: (data) => {
                if (/ NOTICE .*(Login unsuccessful|Improperly formatted auth)/i.test(data)) {
                    throw new Error('Twitch recusou o login anônimo');
                }
                return / 001 /.test(data);
            }
        });
    },

    // YouTube: a página responde normalmente (sem bloqueio/captcha)?
    async youtube() {
        const res = await axios.get('https://www.youtube.com/', {
            headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' },
            timeout: PROBE_TIMEOUT_MS,
            validateStatus: () => true
        });
        if (res.status !== 200) throw new Error(`YouTube respondeu HTTP ${res.status}`);
        const body = typeof res.data === 'string' ? res.data : '';
        if (!body.includes('ytcfg') && !body.includes('ytInitialData')) {
            throw new Error('YouTube retornou uma página inesperada (possível bloqueio/captcha)');
        }
    },

    // Kick: token anônimo + handshake no WebSocket realtime (Centrifugo)
    async kick() {
        const guestId = 'guest' + Math.random().toString(36).slice(2, 12);
        const token = await monitor.getKickConnectionToken(guestId);
        const url = await monitor.getKickRealtimeUrl(1);
        await wsProbe(url, {
            headers: {
                'User-Agent': BROWSER_UA,
                'Origin': 'https://kick.com',
                'Referer': 'https://kick.com/'
            },
            onOpen: (ws) => ws.send(JSON.stringify({ id: 1, connect: { token, name: 'js' } })),
            isDone: (data) => data.split('\n').some(line => {
                if (!line.trim()) return false;
                const f = JSON.parse(line);
                if (f.error) throw new Error(`Kick recusou a conexão: ${f.error.code} ${f.error.message}`);
                return !!f.connect;
            })
        });
    }
};

const LABELS = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick' };

const state = {};
for (const p of Object.keys(probes)) {
    state[p] = { ok: null, fails: 0, since: null, lastError: null, alerted: false, lastReminder: 0 };
}

function fmtDuration(ms) {
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} min`;
    return `${Math.floor(m / 60)}h ${m % 60}min`;
}

async function checkPlatform(name, notify) {
    const s = state[name];
    const label = LABELS[name];
    try {
        try {
            await probes[name]();
        } catch (firstErr) {
            // Evita falso alarme por falha momentânea: tenta mais uma vez após 1 minuto
            console.warn(`[Health] ${label} falhou (${firstErr.message}); tentando de novo em 60s...`);
            await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
            await probes[name]();
        }
        if (s.alerted) {
            await notify(`🟢 **${label} voltou a conectar**\nFicou fora por ${fmtDuration(Date.now() - s.since)}.`, 3066993);
            console.log(`[Health] ${label} recuperada.`);
        }
        s.ok = true; s.fails = 0; s.since = null; s.lastError = null; s.alerted = false;
    } catch (err) {
        const msg = (err && err.message) || String(err);
        s.fails += 1;
        s.lastError = msg;
        if (s.ok !== false) { s.ok = false; s.since = Date.now(); }
        console.warn(`[Health] Falha ao conectar na ${label} (${s.fails}x): ${msg}`);

        if (s.fails >= FAILS_BEFORE_ALERT && !s.alerted) {
            s.alerted = true;
            s.lastReminder = Date.now();
            await notify(`🔴 **Não foi possível conectar à ${label}**\nErro: \`${msg}\`\nVerificações seguidas com falha: ${s.fails}`, 16711680);
        } else if (s.alerted && Date.now() - s.lastReminder >= REMINDER_MS) {
            s.lastReminder = Date.now();
            await notify(`🔴 **${label} continua fora**\nHá ${fmtDuration(Date.now() - s.since)}. Último erro: \`${msg}\``, 16711680);
        }
    }
}

async function runAll(notify) {
    await Promise.all(Object.keys(probes).map(p => checkPlatform(p, notify).catch(e => {
        console.error(`[Health] Erro inesperado verificando ${p}:`, e.message);
    })));
}

let timer = null;
function start(notify) {
    if (timer) return;
    setTimeout(() => runAll(notify), FIRST_CHECK_DELAY_MS);
    timer = setInterval(() => runAll(notify), CHECK_INTERVAL_MS);
    console.log(`[Health] Verificação de plataformas ativa (1x por dia).`);
}

module.exports = { start, runAll, probes, state };
