const axios = require('axios');

const videoId = process.argv[2] || '1YU0nCd_qtM';
const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

axios.get(videoUrl, {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'pt-BR,pt;q=0.9'
    }
}).then(res => {
    const html = res.data;

    // Buscar TODAS as ocorrências de liveChatReplayContinuationData com contexto
    const idx = html.indexOf('liveChatReplayContinuationData');
    if (idx === -1) {
        console.log('liveChatReplayContinuationData NAO encontrado no HTML');
    } else {
        console.log('Contexto ao redor de liveChatReplayContinuationData:');
        console.log(html.substring(idx - 20, idx + 300));
    }

    console.log('\n---\n');

    // Buscar reloadContinuationData com contexto
    const idx2 = html.indexOf('reloadContinuationData');
    if (idx2 !== -1) {
        console.log('Contexto ao redor de reloadContinuationData:');
        console.log(html.substring(idx2 - 20, idx2 + 300));
    }

}).catch(err => console.error('Erro:', err.message));
