const monitor = require('./monitor');
const db = require('./database');

async function test() {
    console.log('--- Testing processMessage ---');

    // Simular streamer
    const streamer = { name: 'Nyang', platform: 'Twitch', channel_id: 'Nyang' };

    // Simular mensagem com keyword
    console.log('\nCase 1: Message with keyword "nyang"');
    await monitor.processMessage(streamer, 'TestUser', 'Olá nyang, como vai?');

    // Simular mensagem sem keyword
    console.log('\nCase 2: Message without keyword');
    await monitor.processMessage(streamer, 'TestUser', 'Olá mundo!');

    // Simular username nulo
    console.log('\nCase 3: Message with null username');
    await monitor.processMessage(streamer, null, 'nyang detected');

    console.log('\nTest completed. Please check your monitor.db or console logs.');
    process.exit(0);
}

// Mock isMonitoring and keywords for test
monitor.start().then(() => {
    test();
});
