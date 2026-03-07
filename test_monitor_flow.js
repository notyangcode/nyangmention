// Simulates monitor.js behavior to detect why stream_offset is always null for Twitch
// Run from nyangmentions dir: node /tmp/test_monitor_flow.js

const tmi = require('tmi.js');
const axios = require('axios');

const streamStartTimes = {};

const streamer = {
    name: 'Sacy',
    platform: 'Twitch',
    channel_id: 'Sacy'
};

// Exactly as in monitor.js startTwitch()
const rawChannel = streamer.channel_id.toLowerCase();
const channel = rawChannel.startsWith('#') ? rawChannel : `#${rawChannel}`;

console.log(`Starting with channel: ${channel}`);
console.log(`channel_id: "${streamer.channel_id}"`);
console.log(`Expected key: "twitch_${streamer.channel_id}"`);

const client = new tmi.Client({ channels: [channel] });

// Listener 1 - exactly as in monitor.js
client.on('connected', async (address, port) => {
    console.log(`\n[connected-L1] address=${address}, port=${port}`);
    console.log(`[connected-L1] Calling getTwitchStartTime for: ${streamer.channel_id}`);

    try {
        const response = await axios.get(`https://decapi.me/twitch/uptime/${streamer.channel_id}`);
        const uptimeStr = response.data;
        console.log(`[connected-L1] DecAPI response: "${uptimeStr}"`);

        if (uptimeStr.includes('offline')) {
            console.log('[connected-L1] Stream is offline! Not populating startTime.');
            return;
        }

        let totalSeconds = 0;
        const hoursMatch = uptimeStr.match(/(\d+)\s*hour/);
        const minutesMatch = uptimeStr.match(/(\d+)\s*minute/);
        const secondsMatch = uptimeStr.match(/(\d+)\s*second/);

        if (hoursMatch) totalSeconds += parseInt(hoursMatch[1]) * 3600;
        if (minutesMatch) totalSeconds += parseInt(minutesMatch[1]) * 60;
        if (secondsMatch) totalSeconds += parseInt(secondsMatch[1]);

        console.log(`[connected-L1] totalSeconds: ${totalSeconds}`);

        if (totalSeconds > 0) {
            const key = `twitch_${streamer.channel_id}`;
            const startTime = new Date(Date.now() - (totalSeconds * 1000));
            streamStartTimes[key] = startTime;
            console.log(`[connected-L1] ✅ Set streamStartTimes["${key}"] = ${startTime}`);
        } else {
            console.log('[connected-L1] ❌ totalSeconds is 0! Not populating startTime.');
        }
    } catch (err) {
        console.error(`[connected-L1] ❌ DecAPI error: ${err.message}`);
    }
});

// Listener 2 - exactly as in monitor.js
client.on('connected', () => {
    console.log('[connected-L2] Emitting monitor_status');
});

client.on('message', (ch, tags, message, self) => {
    if (self) return;

    // Exactly as in monitor.js processMessage
    const platformKey = `${streamer.platform.toLowerCase()}_${streamer.channel_id}`;
    const hasStartTime = !!streamStartTimes[platformKey];

    let streamOffset = null;
    if (streamStartTimes[platformKey]) {
        const messageTs = tags['tmi-sent-ts'] ? new Date(parseInt(tags['tmi-sent-ts'])) : new Date();
        const diffMs = messageTs.getTime() - streamStartTimes[platformKey].getTime();
        streamOffset = Math.max(0, Math.floor(diffMs / 1000));
    }

    console.log(`\n[message] from ${tags.username}: "${message.substring(0, 50)}"`);
    console.log(`  platform key: "${platformKey}"`);
    console.log(`  hasStartTime: ${hasStartTime}`);
    console.log(`  streamOffset: ${streamOffset}`);
    console.log(`  all keys in streamStartTimes: ${JSON.stringify(Object.keys(streamStartTimes))}`);

    // Exit after first match
    client.disconnect().then(() => process.exit(0)).catch(() => process.exit(0));
});

client.connect().catch(console.error);

// Safety timeout
setTimeout(() => {
    console.log('\n[timeout] No messages received in 30s');
    console.log('Current streamStartTimes keys:', Object.keys(streamStartTimes));
    process.exit(0);
}, 30000);
