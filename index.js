const express = require('express');
const cors = require('cors');
const yts = require('yt-search');
const ytdl = require('ytdl-core');
const path = require('path');

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

// 1. API STATUS ENDPOINT (Simplified - No Authentication)
app.get('/api/status', (req, res) => {
    console.log('✅ /api/status endpoint called');
    res.json({
        status: 200,
        success: true,
        creator: "Bruce Bera",
        service: "Bera YouTube API",
        timestamp: new Date().toISOString(),
        endpoints: [
            '/api/search?query=term',
            '/api/info?url=youtube_url',
            '/api/download/mp3?url=youtube_url',
            '/api/download/mp4?url=youtube_url'
        ]
    });
});

// 2. SEARCH ENDPOINT
app.get('/api/search', async (req, res) => {
    console.log('🔍 /api/search endpoint called');
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
        const videos = searchResults.videos.slice(0, 10).map(video => ({
            id: video.videoId,
            title: video.title,
            duration: video.timestamp,
            views: video.views,
            author: video.author.name,
            thumbnail: video.thumbnail,
            url: video.url
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
        console.error('Search error:', error);
        res.status(500).json({
            status: 500,
            success: false,
            creator: "Bruce Bera",
            message: "Failed to search videos"
        });
    }
});

// 3. VIDEO INFO ENDPOINT
app.get('/api/info', async (req, res) => {
    console.log('📊 /api/info endpoint called');
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
        const info = await ytdl.getInfo(videoId);
        const formats = info.formats
            .filter(f => f.hasAudio || f.hasVideo)
            .slice(0, 10)
            .map(f => ({
                quality: f.qualityLabel || f.audioQuality,
                container: f.container,
                hasAudio: f.hasAudio,
                hasVideo: f.hasVideo
            }));

        res.json({
            status: 200,
            success: true,
            creator: "Bruce Bera",
            data: {
                id: info.videoDetails.videoId,
                title: info.videoDetails.title,
                author: info.videoDetails.author.name,
                duration: parseInt(info.videoDetails.lengthSeconds),
                views: info.videoDetails.viewCount,
                thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
                formats: formats
            }
        });

    } catch (error) {
        console.error('Info error:', error);
        res.status(500).json({
            status: 500,
            success: false,
            creator: "Bruce Bera",
            message: "Failed to get video information"
        });
    }
});

// 4. MP3 DOWNLOAD ENDPOINT
app.get('/api/download/mp3', async (req, res) => {
    console.log('🎵 /api/download/mp3 endpoint called');
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
        const info = await ytdl.getInfo(videoId);
        const title = info.videoDetails.title.replace(/[^\w\s]/gi, '_').substring(0, 100);
        
        res.header('Content-Disposition', `attachment; filename="${title}.mp3"`);
        res.header('Content-Type', 'audio/mpeg');
        
        ytdl(videoId, {
            quality: 'highestaudio',
            filter: 'audioonly'
        }).pipe(res);

    } catch (error) {
        console.error('MP3 download error:', error);
        res.status(500).json({
            status: 500,
            success: false,
            creator: "Bruce Bera",
            message: "Failed to download MP3"
        });
    }
});

// 5. MP4 DOWNLOAD ENDPOINT
app.get('/api/download/mp4', async (req, res) => {
    console.log('🎬 /api/download/mp4 endpoint called');
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

    try {
        const info = await ytdl.getInfo(videoId);
        const title = info.videoDetails.title.replace(/[^\w\s]/gi, '_').substring(0, 100);
        
        res.header('Content-Disposition', `attachment; filename="${title}.mp4"`);
        res.header('Content-Type', 'video/mp4');
        
        ytdl(videoId, {
            quality: quality === 'highest' ? 'highest' : quality,
            filter: 'audioandvideo'
        }).pipe(res);

    } catch (error) {
        console.error('MP4 download error:', error);
        res.status(500).json({
            status: 500,
            success: false,
            creator: "Bruce Bera",
            message: "Failed to download MP4"
        });
    }
});

// 6. ROOT ENDPOINT - Serve Dashboard
app.get('/', (req, res) => {
    console.log('🏠 Serving dashboard');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 7. CATCH-ALL FOR UNDEFINED ROUTES
app.get('*', (req, res) => {
    console.log('🚫 Route not found:', req.url);
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
            "GET /api/download/mp4?url=youtube_url"
        ]
    });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`🚀 Bera YouTube API Server Started`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`📡 API Base: http://localhost:${PORT}/api`);
    console.log(`👨💻 Creator: Bruce Bera`);
    console.log(`✅ Server is ready!`);
});
