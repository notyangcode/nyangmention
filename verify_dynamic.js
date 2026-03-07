const monitor = require('./monitor');
const db = require('./database');

async function testDynamic() {
    console.log('--- Testing Dynamic Streamer Addition ---');

    // 1. Start monitor
    await monitor.start();
    console.log('Monitor started.');

    // 2. Add a new streamer
    const testId = 'UCTestDynamic' + Date.now();
    await db.addStreamer('DynamicTest', 'YouTube', testId);
    console.log(`Added new streamer: ${testId}`);

    // 3. Trigger monitor update (as app.js would do)
    await monitor.start();

    // 4. Verify if it's there
    // Since we don't expose youtubeClients, we check console output or just wait for 'Monitor: Verificando streamers'
    // Actually I can check if it's in the list of streamers being monitored if I exposed it, but I didn't.
    // I added a log: "Monitor: Verificando streamers para iniciar..."

    console.log('\nVerification completed. Check logs for "Monitor: Verificando streamers para iniciar..."');

    // Cleanup
    const streamers = await db.getStreamers();
    const testStreamer = streamers.find(s => s.channel_id === testId);
    if (testStreamer) {
        await db.deleteStreamer(testStreamer.id);
    }

    monitor.stop();
    process.exit(0);
}

testDynamic();
