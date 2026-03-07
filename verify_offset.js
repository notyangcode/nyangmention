const axios = require('axios');

async function testTwitchUptimeParser(uptimeStr) {
    console.log(`Testing with: "${uptimeStr}"`);
    let totalSeconds = 0;
    const hoursMatch = uptimeStr.match(/(\d+)\s*hour/);
    const minutesMatch = uptimeStr.match(/(\d+)\s*minute/);
    const secondsMatch = uptimeStr.match(/(\d+)\s*second/);

    if (hoursMatch) totalSeconds += parseInt(hoursMatch[1]) * 3600;
    if (minutesMatch) totalSeconds += parseInt(minutesMatch[1]) * 60;
    if (secondsMatch) totalSeconds += parseInt(secondsMatch[1]);

    console.log(`Parsed seconds: ${totalSeconds}`);
    return totalSeconds;
}

function formatOffset(seconds) {
    if (seconds === null || seconds === undefined) return '-';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

async function run() {
    console.log('--- Twitch Parser Test ---');
    await testTwitchUptimeParser('1 hour, 30 minutes, 15 seconds');
    await testTwitchUptimeParser('45 minutes');
    await testTwitchUptimeParser('2 hours, 5 seconds');

    console.log('\n--- Format Offset Test ---');
    console.log(`5415s -> ${formatOffset(5415)} (Expected 01:30:15)`);
    console.log(`3601s -> ${formatOffset(3601)} (Expected 01:00:01)`);
    console.log(`45s   -> ${formatOffset(45)}   (Expected 00:00:45)`);
}

run();
