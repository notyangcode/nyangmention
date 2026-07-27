const axios = require('axios');
const db = require('./database');

const TWITCH_GQL_URL = 'https://gql.twitch.tv/gql';
const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

let currentScan = {
    active: false,
    progress: 0,
    streamer: null,
    status: 'idle',
    foundCount: 0
};

const retroactive = {
    getStatus() {
        return currentScan;
    },

    async findVideos(streamer, dateStr) {
        const platform = streamer.platform.toLowerCase();
        const channelId = streamer.channel_id;
        console.log(`[Retroactive] Buscando vídeos para ${streamer.name} em ${dateStr}...`);
        if (platform === 'twitch') return await this.findTwitchVideos(channelId, dateStr);
        if (platform === 'youtube') return await this.findYoutubeVideos(channelId, dateStr);
        return [];
    },

    async findTwitchVideos(channelId, dateStr) {
        try {
            let userId = channelId;
            if (!/^\d+$/.test(channelId)) userId = await this.getTwitchUserId(channelId);
            if (!userId) return [];

            const query = [{
                operationName: 'FilterableVideoList_User',
                variables: { limit: 20, login: channelId, sort: 'TIME' },
                extensions: { persistedQuery: { version: 1, sha256Hash: '9880f08c33957865f375c3577d248b1d7d025170d18e8df589b276226c80387e' } }
            }];
            const response = await axios.post(TWITCH_GQL_URL, query, { headers: { 'Client-ID': TWITCH_CLIENT_ID } });
            const videos = response.data[0].data.user.videos.edges;
            const targetDate = new Date(dateStr);
            return videos
                .map(v => v.node)
                .filter(v => new Date(v.publishedAt).toDateString() === targetDate.toDateString())
                .map(v => ({ id: v.id, title: v.title, url: `https://twitch.tv/videos/${v.id}`, publishedAt: v.publishedAt, duration: v.lengthSeconds }));
        } catch (err) {
            console.error('[Retroactive] Erro ao buscar vídeos Twitch:', err.message);
            return [];
        }
    },

    async getTwitchUserId(login) {
        try {
            const query = [{
                operationName: 'QueryUser',
                variables: { login },
                extensions: { persistedQuery: { version: 1, sha256Hash: '861a99f1fa05739e80277bd254e287ce945761bc983f433550fe86a761e309cc' } }
            }];
            const response = await axios.post(TWITCH_GQL_URL, query, { headers: { 'Client-ID': TWITCH_CLIENT_ID } });
            return response.data[0].data.user.id;
        } catch (err) { return null; }
    },

    async findYoutubeVideos(channelId, dateStr) {
        try {
            const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(channelId)}&sp=CAI%253D`;
            const response = await axios.get(searchUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const regex = /"videoId":"([^"]+)","thumbnail":.*?,"title":{"runs":\[{"text":"([^"]+)"}\].*?"publishedTimeText":{"simpleText":"([^"]+)"}/g;
            let matches;
            const videos = [];
            while ((matches = regex.exec(response.data)) !== null) {
                videos.push({ id: matches[1], title: matches[2], url: `https://youtube.com/watch?v=${matches[1]}`, publishedAt: matches[3] });
            }
            return videos;
        } catch (err) { return []; }
    },

    async startScan(streamer, videoId, io) {
        if (currentScan.active) return { error: 'Já existe um escaneamento em curso.' };
        currentScan = { active: true, progress: 0, streamer: streamer.name, status: 'in_progress', foundCount: 0, videoId };
        io.emit('retroactive_status', currentScan);
        this.performScan(streamer, videoId, io).catch(err => {
            console.error('[Retroactive Scan Error]:', err);
            currentScan.status = 'error';
            currentScan.active = false;
            io.emit('retroactive_status', currentScan);
        });
        return { success: true };
    },

    async performScan(streamer, videoId, io) {
        const platform = streamer.platform.toLowerCase();
        if (platform === 'twitch') await this.scanTwitch(streamer, videoId, io);
        else if (platform === 'youtube') await this.scanYoutube(streamer, videoId, io);
        currentScan.active = false;
        currentScan.status = 'completed';
        currentScan.progress = 100;
        io.emit('retroactive_status', currentScan);
    },

    async scanTwitch(streamer, videoId, io) {
        let cursor = null;
        let hasNextPage = true;
        const keywords = await db.getKeywords();
        while (hasNextPage && currentScan.active) {
            try {
                const query = [{
                    operationName: 'VideoCommentsByOffsetOrCursor',
                    variables: { videoID: videoId, cursor },
                    extensions: { persistedQuery: { version: 1, sha256Hash: 'b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a' } }
                }];
                const response = await axios.post(TWITCH_GQL_URL, query, { headers: { 'Client-ID': TWITCH_CLIENT_ID } });
                const commentData = response.data[0].data.video.comments;
                const edges = commentData.edges;
                for (const edge of edges) {
                    const comment = edge.node;
                    const message = comment.message.fragments.map(f => f.text).join('');
                    const matchedKeyword = keywords.find(kw => message.toLowerCase().includes(kw.toLowerCase()));
                    if (matchedKeyword) await this.saveMatch(streamer, comment, message, matchedKeyword, videoId, io);
                }
                cursor = commentData.pageInfo.hasNextPage ? edges[edges.length - 1].cursor : null;
                hasNextPage = !!cursor;
                currentScan.progress = Math.min(99, currentScan.progress + 0.5);
                io.emit('retroactive_status', currentScan);
                await new Promise(r => setTimeout(r, 300));
            } catch (err) {
                console.error('[Twitch Scan Loop Error]:', err.message);
                break;
            }
        }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SCANNER YOUTUBE — usa masterchat (biblioteca especializada em InnerTube)
    // Não interfere em nada com o monitoramento em tempo real (monitor.js/tmi.js)
    // ─────────────────────────────────────────────────────────────────────────
    async scanYoutube(streamer, videoId, io) {
        console.log(`[Retroactive] Iniciando scan YouTube para vídeo: ${videoId}`);
        try {
            const keywords = (await db.getKeywords()).map(k => k.trim()).filter(k => k.length > 0);
            console.log(`[Retroactive] Palavras-chave: ${keywords.join(', ')}`);

            const { Masterchat } = require('masterchat');
            let mc;
            try {
                mc = await Masterchat.init(videoId);
            } catch (initErr) {
                console.error('[Retroactive] Erro ao inicializar masterchat:', initErr.message);
                currentScan.status = 'error_live_active';
                currentScan.active = false;
                io.emit('retroactive_status', currentScan);
                return;
            }

            console.log(`[Retroactive] Modo: ${mc.isLiveChat ? 'LIVE (não suportado)' : 'REPLAY'}`);

            if (mc.isLiveChat) {
                console.error('[Retroactive] A live ainda está AO VIVO. Análise retroativa não disponível.');
                currentScan.status = 'error_live_active';
                currentScan.active = false;
                io.emit('retroactive_status', currentScan);
                return;
            }

            let totalMessages = 0;
            let totalBlocks = 0;

            for await (const { actions } of mc.iterate()) {
                if (!currentScan.active) break;

                let blockMessages = 0;
                for (const action of actions) {
                    if (action.type !== 'addChatItemAction') continue;

                    const messageArr = action.message;
                    if (!messageArr || !Array.isArray(messageArr)) continue;

                    const message = messageArr.map(r => r.text || '').join('').trim();
                    if (!message) continue;

                    blockMessages++;
                    totalMessages++;

                    const author = action.authorName || 'Desconhecido';
                    const timestamp = action.timestamp ? new Date(action.timestamp).toISOString() : new Date().toISOString();
                    // masterchat não fornece videoOffsetTimeMsec na action de topo na mesma estrutura, mas é irrelevante se o VOD existe
                    const offsetSec = 0; 

                    const matchedKw = keywords.find(kw => message.toLowerCase().includes(kw.toLowerCase()));
                    if (matchedKw) {
                        console.log(`[Retroactive] MATCH! "${matchedKw}" | ${author}: ${message.substring(0, 50)}`);
                        await this.saveMatch(streamer, {
                            commenter: { displayName: author },
                            createdAt: timestamp,
                            contentOffsetSeconds: offsetSec
                        }, message, matchedKw, videoId, io);
                    }
                }

                totalBlocks++;
                if (blockMessages > 0) {
                    console.log(`[Retroactive] Bloco ${totalBlocks}: ${blockMessages} msgs | Total: ${totalMessages}`);
                }
                currentScan.progress = Math.min(99, totalBlocks * 0.5);
                io.emit('retroactive_status', currentScan);
            }

            console.log(`[Retroactive] Scan concluído: ${totalMessages} mensagens em ${totalBlocks} blocos.`);

        } catch (err) {
            console.error('[Retroactive] Erro fatal no scan YouTube:', err.message);
        }
    },

    async saveMatch(streamer, rawComment, message, keyword, videoId, io) {
        try {
            const userName = rawComment.commenter
                ? (rawComment.commenter.displayName || rawComment.commenter.login)
                : 'Desconhecido';
            const timestamp = new Date(rawComment.createdAt).toISOString();
            const offset = rawComment.contentOffsetSeconds;

            const duplicate = await db.findRecentMessage(streamer.name, message, 5);
            if (duplicate) return;

            const messageId = await db.insertMessage(
                streamer.name, streamer.platform, userName, message,
                timestamp, keyword, streamer.channel_id, offset, 1
            );

            currentScan.foundCount++;
            io.emit('new_match', {
                id: messageId,
                streamer_name: streamer.name,
                platform: streamer.platform,
                user_name: userName,
                message,
                timestamp,
                keyword,
                channel_id: streamer.channel_id,
                stream_offset: offset,
                retroactive: true
            });
        } catch (err) {
            console.error('[Retroactive] Erro ao salvar match:', err.message);
        }
    }
};

module.exports = retroactive;
