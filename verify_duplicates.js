const db = require('./database');
const monitor = require('./monitor');

async function testDuplicates() {
    console.log('--- Iniciando Teste de Duplicadas ---');

    // 1. Limpar mensagens de teste anteriores (opcional, mas bom para isolar)
    // await db.clearAllMessages(); 

    const streamer = { name: 'StreamerTeste', platform: 'Twitch', channel_id: 'test_channel' };
    const userName = 'UserTeste';
    const message = 'Esta é uma mensagem de teste com NYANG!';

    // Garantir que a keyword NYANG existe
    await db.addKeyword('NYANG');

    // Habilitar monitoramento e mockar IO
    monitor.setIsMonitoring(true);
    monitor.setIo({ emit: (event, data) => console.log(`[Socket Mock] Emitido: ${event}`, data) });

    console.log('Enviando primeira mensagem...');
    await monitor.processMessage(streamer, userName, message);

    let msg1 = await db.findRecentMessage(streamer.name, message, 10);
    console.log(`Mensagem 1 salva com ID: ${msg1.id}, Count: ${msg1.repeat_count}`);

    console.log('Enviando mensagem idêntica em seguida...');
    await monitor.processMessage(streamer, userName, message);

    let msg2 = await db.findRecentMessage(streamer.name, message, 10);
    console.log(`Mensagem após duplicata - ID: ${msg2.id}, Count: ${msg2.repeat_count}`);

    if (msg1.id === msg2.id && msg2.repeat_count === 2) {
        console.log('✅ SUCESSO: Duplicada detectada e contador incrementado!');
    } else {
        console.log('❌ FALHA: Duplicada não foi tratada corretamente.');
    }
}

// Mock isMonitoring e io para o teste
monitor.isMonitoring = true;
monitor.io = { emit: (event, data) => console.log(`[Socket Mock] Emitido: ${event}`, data) };

testDuplicates().catch(console.error);
