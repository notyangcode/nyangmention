const axios = require('axios');

async function getYoutubeStartTime(videoId) {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 10000
        });
        const html = response.data;

        // Try multiple regex patterns for startTimestamp
        const patterns = [
            /"startTimestamp":"([^"]+)"/,
            /"actualStartTime":"([^"]+)"/,
            /"scheduledStartTime":"([^"]+)"/
        ];

        for (const pattern of patterns) {
            const match = html.match(pattern);
            if (match && match[1]) {
                console.log(`Matched pattern ${pattern}: ${match[1]}`);
                return match[1];
            }
        }

        console.log('No start time found in HTML');
        return null;
    } catch (e) {
        console.error('Error fetching YouTube page:', e.message);
        return null;
    }
}

// Test with a known live video ID if possible, or just run and see
const testVideoId = process.argv[2] || 'jfKfPfyJRdk'; // Lo-fi girl or something likely live
getYoutubeStartTime(testVideoId).then(time => {
    if (time) {
        console.log(`Stream start time: ${time}`);
        const start = new Date(time);
        const now = new Date();
        const offsetMs = now - start;
        console.log(`Current offset: ${Math.floor(offsetMs / 1000)}s (${(offsetMs / (1000 * 60 * 60)).toFixed(2)}h)`);
    }
});
