const tmi = require('tmi.js');
const { LiveChat } = require('youtube-chat');
const db = require('./database');
const axios = require('axios');

let twitchClients = {};
let youtubeClients = {};
let isMonitoring = false;
let io = null;
let streamStartTimes = {}; // { platform_channelId: Date }

const monitor = {
    isMonitoring, // Expor para testes
    setIo(socketio) {
        io = socketio;
    },
    setIsMonitoring(val) {
        isMonitoring = val;
    },

    async start() {
        isMonitoring = true;
        if (io) io.emit('monitor_status', true);
        console.log('Monitor: Verificando streamers para iniciar...');

        const streamers = await db.getStreamers();

        for (const streamer of streamers) {
            if (streamer.platform.toLowerCase() === 'twitch') {
                this.startTwitch(streamer);
            } else if (streamer.platform.toLowerCase() === 'youtube') {
                this.startYoutube(streamer);
            }
        }

        // Iniciar loop de verificação para YouTube e Twitch (a cada 2 minutos)
        if (!this.retryInterval) {
            this.retryInterval = setInterval(() => this.checkMissingStartTimes(), 120000);
        }
    },

    stop() {
        isMonitoring = false;
        if (io) io.emit('monitor_status', false);
        console.log('Monitoring stopped...');

        if (this.retryInterval) {
            clearInterval(this.retryInterval);
            this.retryInterval = null;
        }

        // Stop Twitch clients
        for (const channelId in twitchClients) {
            twitchClients[channelId].disconnect();
        }
        twitchClients = {};

        // Stop YouTube clients
        for (const channelId in youtubeClients) {
            if (youtubeClients[channelId]) {
                youtubeClients[channelId].stop();
            }
        }
        youtubeClients = {};
        streamStartTimes = {};
    },

    async checkMissingStartTimes() {
        if (!isMonitoring) return;

        try {
            const streamers = await db.getStreamers();

            for (const streamer of streamers) {
                const platform = streamer.platform.toLowerCase();
                const key = `${platform}_${streamer.channel_id.toLowerCase()}`;

                // YouTube retry logic
                if (platform === 'youtube' && !youtubeClients[streamer.channel_id]) {
                    this.startYoutube(streamer);
                }

                // Generic start time retry logic
                if (!streamStartTimes[key]) {
                    if (platform === 'twitch') {
                        const startTime = await this.getTwitchStartTime(streamer.channel_id);
                        if (startTime) streamStartTimes[key] = startTime;
                    } else if (platform === 'youtube' && youtubeClients[streamer.channel_id]) {
                        // Attempt to get from active YT client if possible (already handled in YT's 'start' event, but here for safety)
                    }
                }
            }
        } catch (err) {
            console.error('[Retry Loop Error]:', err.message);
        }
    },

    startTwitch(streamer) {
        if (twitchClients[streamer.channel_id]) return;

        const rawChannel = streamer.channel_id.toLowerCase();
        const channel = rawChannel.startsWith('#') ? rawChannel : `#${rawChannel}`;

        console.log(`[Twitch] Tentando conectar ao canal: ${channel}`);

        const client = new tmi.Client({
            channels: [channel]
        });

        client.on('message', (ch, tags, message, self) => {
            if (self) return;

            // Logar recebimento de qualquer mensagem para debug (pode ser removido depois)
            // console.log(`[Twitch Debug] Mensagem em ${ch} de ${tags.username}: ${message}`);

            const displayUser = tags['display-name'] || tags.username || 'Sistema';
            const messageTs = tags['tmi-sent-ts'] ? new Date(parseInt(tags['tmi-sent-ts'])) : new Date();
            this.processMessage(streamer, displayUser, message, messageTs);
        });

        client.on('connected', async (address, port) => {
            console.log(`[Twitch] Conectado e monitorando: ${channel} (${address}:${port})`);
            // Buscar uptime para definir streamStartTime
            const startTime = await this.getTwitchStartTime(streamer.channel_id);
            if (startTime) {
                const key = `twitch_${streamer.channel_id.toLowerCase()}`;
                streamStartTimes[key] = startTime;
            }
        });

        client.on('join', (ch, username, self) => {
            if (self) console.log(`[Twitch] Entrou no canal: ${ch}`);
        });

        client.connect().catch(err => {
            console.error(`[Twitch] Erro ao conectar em ${channel}:`, err.message);
        });

        // Garantir que o status do monitor seja emitido quando o cliente Twitch conectar com sucesso
        client.on('connected', () => {
            if (io) io.emit('monitor_status', isMonitoring);
        });

        twitchClients[streamer.channel_id] = client;
    },

    async fetchLiveId(streamer) {
        const channelId = streamer.channel_id;
        const streamerName = streamer.name;

        // 1. Tentar URL direta de live do canal configurado
        let liveId = await this.scrapeLivePage(channelId);
        if (liveId) return liveId;

        // 2. Fallback: Se não encontrou, pesquisar pelo nome do streamer + "live"
        // Isso ajuda se ele estiver em um canal secundário ou o ID principal falhar
        console.log(`[YouTube] Tentando busca de fallback para ${streamerName}...`);
        liveId = await this.searchLiveFallback(streamerName, channelId);

        return liveId;
    },

    async scrapeLivePage(channelId) {
        try {
            const baseUrl = channelId.startsWith('UC')
                ? `https://www.youtube.com/channel/${channelId}/live`
                : `https://www.youtube.com/${channelId}/live`;

            const response = await axios.get(baseUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
                timeout: 10000
            });

            const match = response.data.match(/"videoId":"([^"]+)"/);
            if (match && match[1]) {
                if (response.data.includes('liveChatRenderer')) {
                    return match[1];
                }
            }
            return null;
        } catch (err) {
            return null;
        }
    },

    async searchLiveFallback(streamerName, originalChannelId) {
        try {
            // "sp=EgJAAQ%253D%253D" é o filtro para "Live Now" no YouTube search
            const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(streamerName + ' live')}&sp=EgJAAQ%253D%253D`;
            const response = await axios.get(searchUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
                timeout: 10000
            });

            // Procurar pelo primeiro videoId que apareça
            // No HTML de resultados, o videoId e o channelId (owner) costumam aparecer próximos
            // Regex para pegar blocos de vídeo (simplificado)
            const videoBlocks = response.data.match(/"videoId":"[^"]+","channelId":"[^"]+"/g);

            if (videoBlocks) {
                for (const block of videoBlocks) {
                    const vMatch = block.match(/"videoId":"([^"]+)"/);
                    const cMatch = block.match(/"channelId":"([^"]+)"/);

                    if (vMatch && cMatch) {
                        const vId = vMatch[1];
                        const cId = cMatch[1];

                        // Validar se o canal é o original ou um secundário conhecido (se tivéssemos lista)
                        // Por enquanto, se bater o nome ou for o original, aceitamos
                        if (cId === originalChannelId) {
                            console.log(`[YouTube] Encontrado via busca no canal original: ${vId}`);
                            return vId;
                        }

                        // Sacy específico: se o nome do streamer estiver no título ou canal da busca (heurística)
                        // Aqui poderíamos adicionar uma lista de "IDs Conhecidos" por streamer
                        if (streamerName.toLowerCase() === 'sacy' && (cId === 'UCuhVlANZXUATGv1dRmwcUzA' || cId === 'UCF4rlw_pDM5AUxwXzseP2vQ')) {
                            console.log(`[YouTube] ID secundário detectado para Sacy: ${cId}. Conectando ao vídeo ${vId}`);
                            return vId;
                        }
                    }
                }
            }
            return null;
        } catch (err) {
            console.error(`[YouTube Search Fallback Error] ${streamerName}:`, err.message);
            return null;
        }
    },

    async getTwitchStartTime(channelId) {
        try {
            // DecAPI uptime em formato legível, vamos tentar outro parâmetro se disponível ou apenas parsear
            // Nota: DecAPI não tem um parâmetro direto para timestamp, mas podemos estimar pelo uptime.
            const response = await axios.get(`https://decapi.me/twitch/uptime/${channelId}`);
            const uptimeStr = response.data;

            if (uptimeStr.includes('offline')) return null;

            // Parse simple "X hours, Y minutes, Z seconds"
            let totalSeconds = 0;
            const hoursMatch = uptimeStr.match(/(\d+)\s*hour/);
            const minutesMatch = uptimeStr.match(/(\d+)\s*minute/);
            const secondsMatch = uptimeStr.match(/(\d+)\s*second/);

            if (hoursMatch) totalSeconds += parseInt(hoursMatch[1]) * 3600;
            if (minutesMatch) totalSeconds += parseInt(minutesMatch[1]) * 60;
            if (secondsMatch) totalSeconds += parseInt(secondsMatch[1]);

            if (totalSeconds > 0) {
                return new Date(Date.now() - (totalSeconds * 1000));
            }
            return null;
        } catch (err) {
            console.error(`[Twitch Uptime Error] ${channelId}:`, err.message);
            return null;
        }
    },

    async getYoutubeStartTimeFromPage(videoId) {
        try {
            const url = `https://www.youtube.com/watch?v=${videoId}`;
            const response = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' },
                timeout: 10000
            });
            const match = response.data.match(/"startTimestamp":"([^"]+)"/);
            if (match && match[1]) {
                return new Date(match[1]);
            }
            return null;
        } catch (err) {
            return null;
        }
    },

    async startYoutube(streamer) {
        if (youtubeClients[streamer.channel_id]) return;

        try {
            let channelId = streamer.channel_id;
            let options = {};

            // Heurística para determinar se é Channel ID, Handle ou Video ID
            if (channelId.length === 11 && !channelId.startsWith('UC')) {
                // Provavelmente um Video ID direto
                options.liveId = channelId;
                console.log(`[YouTube] Iniciando via Video ID direto: ${channelId} para ${streamer.name}`);
            } else {
                // Tenta descobrir o liveId via scraping (nossa descoberta robusta)
                const liveId = await this.fetchLiveId(streamer);

                if (liveId) {
                    options.liveId = liveId;
                    console.log(`[YouTube] Live autodectada para ${streamer.name}: ${liveId}`);
                } else {
                    // Fallback para o modo padrão da biblioteca
                    options.channelId = channelId;
                    if (!channelId.startsWith('UC') && !channelId.startsWith('@')) {
                        console.warn(`[YouTube] Aviso: '${channelId}' não parece ser um Channel ID (UC...). Se for um handle, tente adicionar '@' na frente.`);
                    }
                }
            }

            const liveChat = new LiveChat(options);

            liveChat.on('chat', (chatItem) => {
                const author = chatItem.author.name || 'Usuário YouTube';
                const message = chatItem.message.map(m => m.text).join('');
                const messageTs = chatItem.timestamp || new Date();
                this.processMessage(streamer, author, message, messageTs);
            });

            liveChat.on('error', (err) => {
                const errorMsg = err.message || JSON.stringify(err);

                if (errorMsg.includes('Live Stream was not found')) {
                    // Silencioso no console geral, documentado no loop
                } else if (errorMsg.includes('404')) {
                    console.error(`[YouTube 404] Canal ou Vídeo não encontrado para ${streamer.name} (ID: ${channelId}).`);
                } else {
                    console.error(`[YouTube Error] ${streamer.name}:`, errorMsg);
                }

                this.stopYoutube(streamer.channel_id);
            });

            liveChat.on('start', async (liveId) => {
                console.log(`[YouTube] Monitorando live ${liveId} for ${streamer.name}`);
                const startTime = await this.getYoutubeStartTimeFromPage(liveId);
                if (startTime) {
                    const key = `youtube_${streamer.channel_id.toLowerCase()}`;
                    streamStartTimes[key] = startTime;
                }
            });

            liveChat.start();
            youtubeClients[streamer.channel_id] = liveChat;
        } catch (err) {
            console.error(`[YouTube] Falha ao iniciar para ${streamer.name}:`, err.message);
        }
    },

    stopYoutube(channelId) {
        if (youtubeClients[channelId]) {
            try {
                youtubeClients[channelId].stop();
            } catch (err) { }
            delete youtubeClients[channelId];
            delete streamStartTimes[`youtube_${channelId}`];
        }
    },

    stopStreamer(channelId, platform) {
        if (platform.toLowerCase() === 'twitch') {
            if (twitchClients[channelId]) {
                twitchClients[channelId].disconnect();
                delete twitchClients[channelId];
                delete streamStartTimes[`twitch_${channelId}`];
                console.log(`[Twitch] Monitoramento parado para: ${channelId}`);
            }
        } else if (platform.toLowerCase() === 'youtube') {
            this.stopYoutube(channelId);
        }
    },

    async processMessage(streamer, userName, message, messageTs = new Date()) {
        if (!this.getStatus()) return;

        try {
            const keywords = await db.getKeywords();
            const lowerMessage = message.toLowerCase();
            const matchedKeyword = keywords.find(kw => lowerMessage.includes(kw.toLowerCase()));

            if (matchedKeyword) {
                console.log(`[Match Found] Streamer: ${streamer.name} | Keyword: ${matchedKeyword}`);

                const timestamp = messageTs.toISOString ? messageTs.toISOString() : new Date(messageTs).toISOString();
                const safeUserName = userName || 'Desconhecido';

                // 2. Verificar se é uma duplicata recente (últimos 5 minutos)
                const recentMessage = await db.findRecentMessage(streamer.name, message, 300);

                if (recentMessage) {
                    const newCount = (recentMessage.repeat_count || 1) + 1;
                    await db.updateMessageCount(recentMessage.id, newCount);

                    if (io) {
                        io.emit('update_match', {
                            id: recentMessage.id,
                            repeat_count: newCount
                        });
                    }
                    console.log(`[Duplicate] ${streamer.name}: [${safeUserName}] ${message} (${newCount}x)`);
                    return; // Interrompe para não salvar de novo nem enviar pro Discord
                }

                // 3. Calcular Offset (Tempo de Live)
                let streamOffset = null;
                const platformKey = `${streamer.platform.toLowerCase()}_${streamer.channel_id.toLowerCase()}`;

                if (streamStartTimes[platformKey]) {
                    const msgTime = messageTs.getTime ? messageTs.getTime() : new Date(messageTs).getTime();
                    const startTime = streamStartTimes[platformKey].getTime();
                    const diffMs = msgTime - startTime;
                    streamOffset = Math.max(0, Math.floor(diffMs / 1000));
                } else if (streamer.platform.toLowerCase() === 'twitch') {
                    // Tentar buscar imediatamente se não tiver (throttled por ser async op fora do loop principal)
                    this.getTwitchStartTime(streamer.channel_id).then(startTime => {
                        if (startTime) streamStartTimes[platformKey] = startTime;
                    }).catch(() => { });
                }

                const messageId = await db.insertMessage(
                    streamer.name,
                    streamer.platform,
                    safeUserName,
                    message,
                    timestamp,
                    matchedKeyword,
                    streamer.channel_id,
                    streamOffset,
                    1 // repeat_count inicial
                );

                // 4. Notificação Discord
                const webhookUrl = await db.getSetting('discord_webhook');
                if (webhookUrl) {
                    this.sendToDiscord(webhookUrl, {
                        streamer_name: streamer.name,
                        platform: streamer.platform,
                        user_name: safeUserName,
                        message: message,
                        keyword: matchedKeyword,
                        channel_id: streamer.channel_id
                    });
                }

                // 5. Emit via Socket
                if (io) {
                    io.emit('new_match', {
                        id: messageId,
                        streamer_name: streamer.name,
                        platform: streamer.platform,
                        user_name: safeUserName,
                        message: message,
                        timestamp: timestamp,
                        keyword: matchedKeyword,
                        channel_id: streamer.channel_id,
                        stream_offset: streamOffset,
                        repeat_count: 1
                    });
                }

                console.log(`[Saved] ${streamer.name}: [${safeUserName}] ${message}`);
            }
        } catch (err) {
            console.error('[Process Error] Falha ao processar mensagem:', err);
        }
    },

    async sendToDiscord(url, data) {
        const color = 9807270; // Neutro/Primary
        const embed = {
            title: `📢 Palavra detectada: ${data.keyword}`,
            color: color,
            fields: [
                { name: "Streamer", value: `${data.streamer_name} (${data.platform})`, inline: true },
                { name: "Usuário", value: data.user_name, inline: true },
                { name: "Mensagem", value: data.message }
            ],
            timestamp: new Date()
        };

        try {
            await axios.post(url, { embeds: [embed] });
        } catch (err) {
            console.error('[Discord] Falha ao enviar Webhook:', err.message);
        }
    },

    getStatus() {
        return isMonitoring;
    }
};

module.exports = monitor;
