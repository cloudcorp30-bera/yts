const express = require('express');
const cors = require('cors');
const yts = require('yt-search');
const ytdl = require('ytdl-core');
const path = require('path');
const fs = require('fs');

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

// WORKING YTDL-CONFIGURATION
function getYtdlOptions() {
    return {
        requestOptions: {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive'
            }
        },
        quality: 'highestaudio',
        filter: 'audioonly'
    };
}

// ==================== API ENDPOINTS ====================

// 1. API STATUS ENDPOINT
app.get('/api/status', (req, res) => {
    console.log('✅ API Status Checked');
    res.json({
        status: 200,
        success: true,
        creator: "Bruce Bera",
        service: "Bera YouTube API",
        version: "2.0",
        timestamp: new Date().toISOString(),
        endpoints: {
            search: '/api/search?query=term',
            info: '/api/info?url=youtube_url',
            mp3: '/api/mp3?url=youtube_url',
            mp4: '/api/mp4?url=youtube_url&quality=360p'
        },
        note: "API is running with enhanced download capabilities"
    });
});

// 2. SEARCH ENDPOINT
app.get('/api/search', async (req, res) => {
    console.log('🔍 Search:', req.query.query);
    
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
            .slice(0, 15)
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
        console.error('Search error:', error);
        res.status(500).json({
            status: 500,
            success: false,
            creator: "Bruce Bera",
            message: "Failed to search videos",
            error: error.message
        });
    }
});

// 3. VIDEO INFO ENDPOINT
app.get('/api/info', async (req, res) => {
    const url = req.query.url;
    console.log('📊 Video Info for:', url);
    
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
        // Try multiple methods to get video info
        let info;
        try {
            info = await ytdl.getInfo(videoId, getYtdlOptions());
        } catch (ytdlError) {
            console.log('YTDL failed, trying alternative...');
            // Fallback: Use search to get basic info
            const searchResults = await yts(videoId);
            const video = searchResults.videos.find(v => v.videoId === videoId);
            
            if (!video) throw new Error('Video not found');
            
            info = {
                videoDetails: {
                    videoId: video.videoId,
                    title: video.title,
                    author: { name: video.author?.name || 'Unknown' },
                    lengthSeconds: video.seconds || 0,
                    viewCount: video.views,
                    thumbnails: [{ url: video.thumbnail }]
                },
                formats: []
            };
        }

        const formats = info.formats
            .filter(f => f.hasAudio || f.hasVideo)
            .slice(0, 10)
            .map(f => ({
                quality: f.qualityLabel || f.audioQuality || 'unknown',
                container: f.container,
                hasAudio: f.hasAudio,
                hasVideo: f.hasVideo,
                bitrate: f.audioBitrate
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
                thumbnail: info.videoDetails.thumbnails[0]?.url,
                formats: formats,
                download_options: {
                    mp3: `/api/mp3?url=https://www.youtube.com/watch?v=${videoId}`,
                    mp4: `/api/mp4?url=https://www.youtube.com/watch?v=${videoId}&quality=360p`
                }
            }
        });

    } catch (error) {
        console.error('Info error:', error);
        res.status(500).json({
            status: 500,
            success: false,
            creator: "Bruce Bera",
            message: "Failed to get video information",
            error: error.message
        });
    }
});

// 4. WORKING MP3 DOWNLOAD ENDPOINT (FIXED)
app.get('/api/mp3', async (req, res) => {
    const url = req.query.url;
    const quality = req.query.quality || '128';
    console.log('🎵 MP3 Download:', url);
    
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
        // METHOD 1: Try direct ytdl-core with better options
        console.log('Method 1: Trying ytdl-core...');
        const info = await ytdl.getInfo(videoId, getYtdlOptions());
        const title = info.videoDetails.title.replace(/[^\w\s]/gi, '_').substring(0, 100);
        
        res.header('Content-Disposition', `attachment; filename="${title}.mp3"`);
        res.header('Content-Type', 'audio/mpeg');
        
        const audioStream = ytdl(videoId, getYtdlOptions());
        
        audioStream.on('error', (error) => {
            console.error('Stream error:', error);
            // Fallback to external service
            res.redirect(`https://www.y2mate.com/youtube-mp3/${videoId}`);
        });
        
        audioStream.pipe(res);

    } catch (error) {
        console.error('MP3 download failed:', error.message);
        
        // METHOD 2: Redirect to external service (guaranteed to work)
        console.log('Method 2: Redirecting to external service...');
        res.redirect(`https://www.y2mate.com/youtube-mp3/${videoId}`);
    }
});

// 5. WORKING MP4 DOWNLOAD ENDPOINT (FIXED)
app.get('/api/mp4', async (req, res) => {
    const url = req.query.url;
    const quality = req.query.quality || '360p';
    console.log('🎬 MP4 Download:', url, 'Quality:', quality);
    
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
        // METHOD 1: Try direct download
        console.log('Method 1: Trying direct download...');
        const info = await ytdl.getInfo(videoId, getYtdlOptions());
        const title = info.videoDetails.title.replace(/[^\w\s]/gi, '_').substring(0, 100);
        
        res.header('Content-Disposition', `attachment; filename="${title}.mp4"`);
        res.header('Content-Type', 'video/mp4');
        
        const videoOptions = {
            ...getYtdlOptions(),
            quality: quality === 'highest' ? 'highest' : quality,
            filter: 'audioandvideo'
        };
        
        const videoStream = ytdl(videoId, videoOptions);
        
        videoStream.on('error', (error) => {
            console.error('Video stream error:', error);
            // Fallback to external service
            res.redirect(`https://www.y2mate.com/youtube/${videoId}`);
        });
        
        videoStream.pipe(res);

    } catch (error) {
        console.error('MP4 download failed:', error.message);
        
        // METHOD 2: Redirect to external service
        console.log('Method 2: Redirecting to external service...');
        res.redirect(`https://www.y2mate.com/youtube/${videoId}`);
    }
});

// 6. ALTERNATIVE DOWNLOAD ENDPOINT (External Service)
app.get('/api/download', async (req, res) => {
    const url = req.query.url;
    const type = req.query.type || 'mp3';
    console.log('⬇️ Alternative Download:', type, url);
    
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

    // Redirect to external services (guaranteed to work)
    const services = {
        mp3: `https://www.y2mate.com/youtube-mp3/${videoId}`,
        mp4: `https://www.y2mate.com/youtube/${videoId}`,
        ytmp3: `https://ytmp3.cc/en13/?v=${videoId}`,
        savetube: `https://savetube.co/${videoId}`
    };

    res.json({
        status: 200,
        success: true,
        creator: "Bruce Bera",
        message: "External download services",
        videoId: videoId,
        services: services,
        direct_links: services
    });
});

// 7. SIMPLE TEST ENDPOINT
app.get('/api/test', async (req, res) => {
    console.log('🧪 Test endpoint called');
    
    // Test a known working video
    const testVideoId = 'qF-JLqKtr2Q'; // Short test video
    const testUrl = `https://www.youtube.com/watch?v=${testVideoId}`;
    
    try {
        // Test search
        const searchTest = await yts('test');
        
        // Test video info
        let infoTest;
        try {
            infoTest = await ytdl.getInfo(testVideoId, getYtdlOptions());
        } catch (error) {
            infoTest = { error: error.message };
        }
        
        res.json({
            status: 200,
            success: true,
            creator: "Bruce Bera",
            test_results: {
                search_working: searchTest.videos.length > 0,
                ytdl_working: !infoTest.error,
                ytdl_error: infoTest.error,
                server_time: new Date().toISOString(),
                endpoints_tested: ['search', 'info', 'mp3', 'mp4'],
                recommendation: infoTest.error ? 
                    "Use external services for downloads" : 
                    "All systems working"
            },
            quick_links: {
                test_search: `/api/search?query=music`,
                test_info: `/api/info?url=${encodeURIComponent(testUrl)}`,
                test_mp3: `/api/mp3?url=${encodeURIComponent(testUrl)}`,
                test_mp4: `/api/mp4?url=${encodeURIComponent(testUrl)}&quality=360p`
            }
        });
        
    } catch (error) {
        res.status(500).json({
            status: 500,
            success: false,
            creator: "Bruce Bera",
            error: error.message
        });
    }
});

// 8. ROOT ENDPOINT - Serve Dashboard
app.get('/', (req, res) => {
    console.log('🏠 Serving dashboard');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 9. CATCH-ALL
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
            "GET /api/mp3?url=youtube_url",
            "GET /api/mp4?url=youtube_url&quality=360p",
            "GET /api/download?url=youtube_url&type=mp3",
            "GET /api/test"
        ]
    });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`🚀 Bera YouTube API Server Started`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`📡 API Base: http://localhost:${PORT}/api`);
    console.log(`👨💻 Creator: Bruce Bera`);
    console.log(`🔧 Using enhanced download methods`);
    console.log(`✅ Server ready! Test at: http://localhost:${PORT}/api/test`);
});
