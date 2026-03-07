const tmi = require('tmi.js');

const channel = 'nyang'; // No hash
const client = new tmi.Client({
    channels: [channel]
});

client.on('message', (channel, tags, message, self) => {
    console.log(`Received message: ${message}`);
});

client.on('connected', (address, port) => {
    console.log(`Connected to ${address}:${port}`);
    // Check joined channels
    console.log('Channels:', client.getChannels());
});

client.connect().catch(err => {
    console.error('Connection error:', err);
});

setTimeout(() => {
    console.log('Closing test...');
    client.disconnect();
    process.exit(0);
}, 10000);
