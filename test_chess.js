const { LiveChat } = require('youtube-chat');

const channelId = 'UCF4rlw_pDM5AUxwXzseP2vQ';
const liveChat = new LiveChat({ channelId: channelId });

console.log(`Testing LiveChat for ${channelId}...`);

liveChat.on('start', (liveId) => {
    console.log(`[SUCCESS] Started monitoring ${channelId}, Live ID: ${liveId}`);
    // Keep it running for a few messages if possible
});

liveChat.on('chat', (chatItem) => {
    const author = chatItem.author.name;
    const message = chatItem.message.map(m => m.text).join('');
    console.log(`[CHAT] ${author}: ${message}`);
});

liveChat.on('error', (err) => {
    console.error(`[ERROR]`, err.message || err);
});

liveChat.start();

setTimeout(() => {
    console.log('Test timeout, stopping...');
    liveChat.stop();
    process.exit(0);
}, 20000);
