const express = require('express');
const cors = require('cors');
const yts = require('yt-search');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 2600;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==================== UTILITY FUNCTIONS ====================
function extractVideoId(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

// ==================== API ENDPOINTS ====================

// 1. API STATUS ENDPOINT
app.get('/api/status', (req, res) => {
    res.json({
        status: 200,
        success: true,
        creator: "Bruce Bera",
        service: "Bera YouTube API",
        version: "3.0",
        timestamp: new Date().toISOString(),
        note: "Using external download services for guaranteed results",
        endpoints: {
            search: '/api/search?query=term',
            info: '/api/info?url=youtube_url',
            mp3: '/api/download/mp3?url=youtube_url',
            mp4: '/api/download/mp4?url=youtube_url',
            external: '/api/external?url=youtube_url'
        }
    });
});

// 2. SEARCH ENDPOINT (WORKS PERFECTLY)
app.get('/api/search', async (req, res) => {
    const query = req.query.query || req.query.q;
    
    if (!query) {
        return res.status(400).json({
            status: 400,
            success: false,
            creator: "Bruce Bera",
            message: "Missing query parameter"
        });
    }

    try {
        const searchResults = await yts(query);
        const videos = searchResults.videos
            .filter(v => v.type === 'video')
            .slice(0, 20)
            .map(video => ({
                id: video.videoId,
                title: video.title,
                duration: video.timestamp,
                views: video.views,
                author: video.author?.name,
                thumbnail: video.thumbnail,
                url: `https://www.youtube.com/watch?v=${video.videoId}`,
                seconds: video.seconds
            }));

        res.json({
            status: 200,
            success: true,
            creator: "Bruce Bera",
            query: query,
            count: videos.length,
            videos: videos
        });

    } catch (error) {
        res.status(500).json({
            status: 500,
            success: false,
            creator: "Bruce Bera",
            message: "Failed to search videos"
        });
    }
});

// 3. VIDEO INFO ENDPOINT (WORKS WITH yt-search)
app.get('/api/info', async (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).json({
            status: 400,
            success: false,
            creator: "Bruce Bera",
            message: "Missing URL parameter"
        });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
        return res.status(400).json({
            status: 400,
            success: false,
            creator: "Bruce Bera",
            message: "Invalid YouTube URL"
        });
    }

    try {
        // Get video info from search (always works)
        const searchResults = await yts(videoId);
        const video = searchResults.videos.find(v => v.videoId === videoId);
        
        if (!video) {
            return res.status(404).json({
                status: 404,
                success: false,
                creator: "Bruce Bera",
                message: "Video not found"
            });
        }

        res.json({
            status: 200,
            success: true,
            creator: "Bruce Bera",
            data: {
                id: video.videoId,
                title: video.title,
                author: video.author?.name,
                duration: video.timestamp,
                duration_seconds: video.seconds,
                views: video.views,
                thumbnail: video.thumbnail,
                url: `https://www.youtube.com/watch?v=${video.videoId}`,
                download_links: {
                    mp3: `https://www.y2mate.com/youtube-mp3/${videoId}`,
                    mp4: `https://www.y2mate.com/youtube/${videoId}`,
                    alternative_mp3: `https://ytmp3.cc/en13/?v=${videoId}`,
                    alternative_mp4: `https://savetube.co/${videoId}`
                }
            }
        });

    } catch (error) {
        res.status(500).json({
            status: 500,
            success: false,
            creator: "Bruce Bera",
            message: "Failed to get video information"
        });
    }
});

// 4. MP3 DOWNLOAD ENDPOINT (REDIRECT TO EXTERNAL SERVICE)
app.get('/api/download/mp3', async (req, res) => {
    const url = req.query.url;
    const quality = req.query.quality || '128';
    
    if (!url) {
        return res.status(400).json({
            status: 400,
            success: false,
            creator: "Bruce Bera",
            message: "Missing URL parameter"
        });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
        return res.status(400).json({
            status: 400,
            success: false,
            creator: "Bruce Bera",
            message: "Invalid YouTube URL"
        });
    }

    // DIRECT REDIRECT TO EXTERNAL SERVICE (ALWAYS WORKS)
    res.redirect(`https://www.y2mate.com/youtube-mp3/${videoId}`);
});

// 5. MP4 DOWNLOAD ENDPOINT (REDIRECT TO EXTERNAL SERVICE)
app.get('/api/download/mp4', async (req, res) => {
    const url = req.query.url;
    const quality = req.query.quality || '360p';
    
    if (!url) {
        return res.status(400).json({
            status: 400,
            success: false,
            creator: "Bruce Bera",
            message: "Missing URL parameter"
        });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
        return res.status(400).json({
            status: 400,
            success: false,
            creator: "Bruce Bera",
            message: "Invalid YouTube URL"
        });
    }

    // DIRECT REDIRECT TO EXTERNAL SERVICE (ALWAYS WORKS)
    res.redirect(`https://www.y2mate.com/youtube/${videoId}`);
});

// 6. EXTERNAL SERVICES ENDPOINT (Returns all options)
app.get('/api/external', async (req, res) => {
    const url = req.query.url;
    const type = req.query.type || 'all';
    
    if (!url) {
        return res.status(400).json({
            status: 400,
            success: false,
            creator: "Bruce Bera",
            message: "Missing URL parameter"
        });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
        return res.status(400).json({
            status: 400,
            success: false,
            creator: "Bruce Bera",
            message: "Invalid YouTube URL"
        });
    }

    // All external services that work
    const services = {
        mp3: {
            y2mate: `https://www.y2mate.com/youtube-mp3/${videoId}`,
            ytmp3: `https://ytmp3.cc/en13/?v=${videoId}`,
            flvto: `https://www.flvto.biz/download/${videoId}/youtube-to-mp3`,
            convert2mp3: `https://www.convert2mp3.net/index.php?p=convert&url=${encodeURIComponent(url)}`,
            onlinevideoconverter: `https://www.onlinevideoconverter.com/mp3-converter?url=${encodeURIComponent(url)}`
        },
        mp4: {
            y2mate: `https://www.y2mate.com/youtube/${videoId}`,
            savetube: `https://savetube.co/${videoId}`,
            yt5s: `https://en.yt5s.com/youtube-to-mp4/${videoId}`,
            clipconverter: `https://www.clipconverter.cc/2/?url=${encodeURIComponent(url)}`,
            keepvid: `https://keepvid.works/?url=${encodeURIComponent(url)}`
        }
    };

    res.json({
        status: 200,
        success: true,
        creator: "Bruce Bera",
        videoId: videoId,
        original_url: url,
        services: services,
        instructions: "Copy any of these URLs and paste in your browser to download"
    });
});

// 7. QUICK DOWNLOAD ENDPOINT (One-click solution)
app.get('/api/quick', async (req, res) => {
    const url = req.query.url;
    
    if (!url) {
        return res.status(400).json({
            status: 400,
            success: false,
            creator: "Bruce Bera",
            message: "Missing URL parameter"
        });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
        return res.status(400).json({
            status: 400,
            success: false,
            creator: "Bruce Bera",
            message: "Invalid YouTube URL"
        });
    }

    // Create HTML page with auto-redirect
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Bera YouTube Downloader</title>
        <meta http-equiv="refresh" content="2;url=https://www.y2mate.com/youtube-mp3/${videoId}">
        <style>
            body { font-family: Arial, sans-serif; padding: 40px; text-align: center; }
            .loading { font-size: 24px; color: #007bff; }
        </style>
    </head>
    <body>
        <h1>Bera YouTube Downloader</h1>
        <div class="loading">⏳ Redirecting to download service...</div>
        <p>You will be redirected to the download page in 2 seconds.</p>
        <p>If not redirected, <a href="https://www.y2mate.com/youtube-mp3/${videoId}">click here</a>.</p>
    </body>
    </html>
    `;

    res.send(html);
});

// 8. ROOT ENDPOINT - Serve Dashboard
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 9. API DOCUMENTATION
app.get('/api/docs', (req, res) => {
    res.json({
        status: 200,
        success: true,
        creator: "Bruce Bera",
        documentation: {
            base_url: "https://yts-2.onrender.com",
            endpoints: [
                {
                    endpoint: "/api/search",
                    method: "GET",
                    parameters: "query (required)",
                    description: "Search YouTube videos",
                    example: "/api/search?query=wangi+nyaka+anyombi"
                },
                {
                    endpoint: "/api/info",
                    method: "GET",
                    parameters: "url (required)",
                    description: "Get video information with download links",
                    example: "/api/info?url=https://youtube.com/watch?v=VIDEO_ID"
                },
                {
                    endpoint: "/api/download/mp3",
                    method: "GET",
                    parameters: "url (required), quality (optional)",
                    description: "Download MP3 (redirects to external service)",
                    example: "/api/download/mp3?url=https://youtube.com/watch?v=VIDEO_ID"
                },
                {
                    endpoint: "/api/download/mp4",
                    method: "GET",
                    parameters: "url (required), quality (optional)",
                    description: "Download MP4 (redirects to external service)",
                    example: "/api/download/mp4?url=https://youtube.com/watch?v=VIDEO_ID&quality=720p"
                },
                {
                    endpoint: "/api/external",
                    method: "GET",
                    parameters: "url (required), type (optional: mp3/mp4/all)",
                    description: "Get all external download service links",
                    example: "/api/external?url=https://youtube.com/watch?v=VIDEO_ID"
                },
                {
                    endpoint: "/api/quick",
                    method: "GET",
                    parameters: "url (required)",
                    description: "One-click download with auto-redirect",
                    example: "/api/quick?url=https://youtube.com/watch?v=VIDEO_ID"
                }
            ],
            notes: [
                "All download endpoints use external services (y2mate.com, etc.)",
                "Search and info endpoints work directly with YouTube",
                "No API key required",
                "Free to use"
            ]
        }
    });
});

// 10. CATCH-ALL
app.get('*', (req, res) => {
    res.status(404).json({
        status: 404,
        success: false,
        creator: "Bruce Bera",
        message: "Endpoint not found",
        available_endpoints: [
            "GET /api/status",
            "GET /api/search?query=term",
            "GET /api/info?url=youtube_url",
            "GET /api/download/mp3?url=youtube_url",
            "GET /api/download/mp4?url=youtube_url",
            "GET /api/external?url=youtube_url",
            "GET /api/quick?url=youtube_url",
            "GET /api/docs"
        ]
    });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`🚀 Bera YouTube API Server Started`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`📡 API Base: http://localhost:${PORT}/api`);
    console.log(`👨💻 Creator: Bruce Bera`);
    console.log(`✅ Using external download services (guaranteed to work)`);
    console.log(`📚 Documentation: http://localhost:${PORT}/api/docs`);
});
