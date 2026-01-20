const cors = require('cors'); 
const yts = require("yt-search");
const express = require("express");
const ytdl = require('ytdl-core');
const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
  credentials: false, 
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

app.use(express.json());
const port = process.env.PORT || 2600;
app.enable("trust proxy");
app.set("json spaces", 2);

// ==================== UTILITY FUNCTIONS ====================

function extractVideoId(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

function sanitizeFilename(filename) {
    return filename.replace(/[^\w\s\-.]/gi, '_').substring(0, 100);
}

async function ytSearch(query) {
    return new Promise((resolve, reject) => {
        try {
            let searchQuery = query;
            let isDirectUrl = false;
            let videoId = null;
            
            if (query.startsWith('http://') || query.startsWith('https://')) {
                videoId = extractVideoId(query);
                if (videoId) {
                    searchQuery = videoId;
                    isDirectUrl = true;
                } else {
                    reject(new Error('Invalid YouTube URL'));
                    return;
                }
            }

            yts(searchQuery)
                .then((data) => {
                    const videos = data.all.map(video => ({
                        type: video.type,
                        id: video.videoId,
                        name: video.title,
                        description: video.description,
                        url: `https://www.youtube.com/watch?v=${video.videoId}`,
                        views: video.views,
                        published: video.ago,
                        author: video.author?.name,
                        duration: video.timestamp,
                        thumbnail: video.thumbnail,
                        isLive: false,
                        duration_seconds: video.seconds || 0
                    }));
                    
                    if (isDirectUrl && videoId) {
                        const directVideo = videos.find(v => v.id === videoId);
                        resolve({ 
                            videos: directVideo ? [directVideo] : videos,
                            isDirectResult: true 
                        });
                    } else {
                        resolve({ 
                            videos: videos,
                            isDirectResult: false 
                        });
                    }
                })
                .catch((error) => {
                    reject(error);
                });
        } catch (error) {
            reject(error);
        }
    });
}

// ==================== SEARCH ENDPOINTS ====================

// 1. Original search endpoint (your working version)
app.get('/', async (req, res) => {
    const query = req.query.q || req.query.query; 
    if (!query) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing query parameter' 
        });
    }

    try {
        const results = await ytSearch(query);
        res.json(results); 
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// 2. Enhanced search with download options
app.get('/search', async (req, res) => {
    const query = req.query.q || req.query.query; 
    if (!query) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing query parameter' 
        });
    }

    try {
        const results = await ytSearch(query);
        
        const videosWithOptions = results.videos
            .filter(video => video.type === 'video' && video.id)
            .map(video => ({
                ...video,
                download_options: {
                    info: `/api/info?url=${encodeURIComponent(video.url)}`,
                    mp3: `/api/download/mp3?url=${encodeURIComponent(video.url)}`,
                    mp4_360: `/api/download/mp4?url=${encodeURIComponent(video.url)}&quality=360p`,
                    mp4_720: `/api/download/mp4?url=${encodeURIComponent(video.url)}&quality=720p`,
                    mp4_best: `/api/download/mp4?url=${encodeURIComponent(video.url)}&quality=best`
                },
                quick_download: `/api/get?q=${encodeURIComponent(video.url)}&type=mp3`
            }));
        
        res.json({ 
            success: true,
            query: query,
            count: videosWithOptions.length,
            videos: videosWithOptions 
        });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// ==================== INFORMATION ENDPOINTS ====================

// 3. Video information endpoint
app.get('/api/info', async (req, res) => {
    const url = req.query.url || req.query.video || req.query.id;
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing video URL, ID, or query parameter' 
        });
    }

    try {
        const videoId = extractVideoId(url) || url;
        
        // Get basic info from search
        const searchResults = await ytSearch(videoId);
        const video = searchResults.videos.find(v => v.id === videoId);
        
        if (!video) {
            return res.status(404).json({ 
                success: false, 
                error: 'Video not found' 
            });
        }
        
        // Try to get detailed info from ytdl
        try {
            const info = await ytdl.getInfo(videoId);
            
            const formats = {
                audio: ytdl.filterFormats(info.formats, 'audioonly'),
                video: ytdl.filterFormats(info.formats, 'videoonly'),
                combined: ytdl.filterFormats(info.formats, 'audioandvideo')
            };
            
            res.json({
                success: true,
                video: {
                    ...video,
                    title: info.videoDetails.title,
                    author: info.videoDetails.author.name,
                    channel_url: info.videoDetails.author.channel_url,
                    duration_seconds: parseInt(info.videoDetails.lengthSeconds),
                    keywords: info.videoDetails.keywords,
                    category: info.videoDetails.category,
                    isLive: info.videoDetails.isLive,
                    isPrivate: info.videoDetails.isPrivate,
                    isUnlisted: info.videoDetails.isUnlisted,
                    thumbnails: info.videoDetails.thumbnails
                },
                formats_summary: {
                    audio_count: formats.audio.length,
                    video_count: formats.video.length,
                    combined_count: formats.combined.length,
                    available_qualities: [...new Set(formats.combined.map(f => f.qualityLabel).filter(q => q))]
                },
                download_endpoints: {
                    mp3: `/api/download/mp3?url=${encodeURIComponent(video.url)}`,
                    mp4_360: `/api/download/mp4?url=${encodeURIComponent(video.url)}&quality=360p`,
                    mp4_720: `/api/download/mp4?url=${encodeURIComponent(video.url)}&quality=720p`,
                    mp4_best: `/api/download/mp4?url=${encodeURIComponent(video.url)}&quality=best`
                }
            });
            
        } catch (ytdlError) {
            // Fallback if ytdl fails
            res.json({
                success: true,
                video: video,
                note: 'Detailed format information unavailable',
                download_endpoints: {
                    mp3: `/api/download/mp3?url=${encodeURIComponent(video.url)}`,
                    mp4: `/api/download/mp4?url=${encodeURIComponent(video.url)}`
                }
            });
        }
        
    } catch (error) {
        console.error('Info error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get video information',
            message: error.message
        });
    }
});

// ==================== DOWNLOAD ENDPOINTS ====================

// 4. MP3 Download endpoint
app.get('/api/download/mp3', async (req, res) => {
    const url = req.query.url || req.query.video || req.query.id;
    const quality = req.query.quality || 'highest';
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing video URL or ID parameter' 
        });
    }

    const videoId = extractVideoId(url) || url;
    
    try {
        const info = await ytdl.getInfo(videoId);
        const title = sanitizeFilename(info.videoDetails.title);
        
        res.header('Content-Disposition', `attachment; filename="${title}.mp3"`);
        res.header('Content-Type', 'audio/mpeg');
        
        ytdl(videoId, {
            quality: quality,
            filter: 'audioonly'
        }).pipe(res);
        
    } catch (error) {
        console.error('MP3 download error:', error);
        
        // Fallback: Redirect to external service
        try {
            const searchResults = await ytSearch(videoId);
            const video = searchResults.videos.find(v => v.id === videoId);
            
            if (video) {
                res.redirect(`https://www.y2mate.com/youtube-mp3/${videoId}`);
            } else {
                throw new Error('Video not found');
            }
        } catch (fallbackError) {
            res.status(500).json({ 
                success: false, 
                error: 'Failed to download MP3',
                message: error.message,
                suggestion: 'Try using an external service like y2mate.com'
            });
        }
    }
});

// 5. MP4 Download endpoint
app.get('/api/download/mp4', async (req, res) => {
    const url = req.query.url || req.query.video || req.query.id;
    const quality = req.query.quality || '360p';
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing video URL or ID parameter' 
        });
    }

    const videoId = extractVideoId(url) || url;
    
    try {
        const info = await ytdl.getInfo(videoId);
        const title = sanitizeFilename(info.videoDetails.title);
        
        let ytdlOptions = {
            filter: 'audioandvideo'
        };
        
        // Set quality
        if (quality === 'best' || quality === 'highest') {
            ytdlOptions.quality = 'highest';
        } else if (quality === 'lowest') {
            ytdlOptions.quality = 'lowest';
        } else {
            ytdlOptions.quality = quality;
        }
        
        res.header('Content-Disposition', `attachment; filename="${title}.mp4"`);
        res.header('Content-Type', 'video/mp4');
        
        ytdl(videoId, ytdlOptions).pipe(res);
        
    } catch (error) {
        console.error('MP4 download error:', error);
        
        // Fallback: Redirect to external service
        try {
            const searchResults = await ytSearch(videoId);
            const video = searchResults.videos.find(v => v.id === videoId);
            
            if (video) {
                res.redirect(`https://www.y2mate.com/youtube/${videoId}`);
            } else {
                throw new Error('Video not found');
            }
        } catch (fallbackError) {
            res.status(500).json({ 
                success: false, 
                error: 'Failed to download MP4',
                message: error.message,
                suggestion: 'Try using an external service like y2mate.com'
            });
        }
    }
});

// 6. Audio Stream endpoint
app.get('/api/stream/audio', async (req, res) => {
    const url = req.query.url || req.query.video || req.query.id;
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing video URL or ID parameter' 
        });
    }

    const videoId = extractVideoId(url) || url;
    
    try {
        res.header('Content-Type', 'audio/mpeg');
        res.header('Accept-Ranges', 'bytes');
        res.header('Cache-Control', 'no-cache');
        
        ytdl(videoId, {
            quality: 'highestaudio',
            filter: 'audioonly'
        }).pipe(res);
        
    } catch (error) {
        console.error('Stream error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to stream audio',
            message: error.message
        });
    }
});

// 7. Video Stream endpoint
app.get('/api/stream/video', async (req, res) => {
    const url = req.query.url || req.query.video || req.query.id;
    const quality = req.query.quality || '360p';
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing video URL or ID parameter' 
        });
    }

    const videoId = extractVideoId(url) || url;
    
    try {
        res.header('Content-Type', 'video/mp4');
        res.header('Accept-Ranges', 'bytes');
        res.header('Cache-Control', 'no-cache');
        
        let ytdlOptions = {
            filter: 'audioandvideo'
        };
        
        if (quality === 'best' || quality === 'highest') {
            ytdlOptions.quality = 'highest';
        } else {
            ytdlOptions.quality = quality;
        }
        
        ytdl(videoId, ytdlOptions).pipe(res);
        
    } catch (error) {
        console.error('Video stream error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to stream video',
            message: error.message
        });
    }
});

// ==================== SMART ENDPOINTS ====================

// 8. Smart endpoint (handles both search and direct URLs)
app.get('/api/get', async (req, res) => {
    const query = req.query.q || req.query.url;
    const type = req.query.type || 'search';
    const quality = req.query.quality || '720p';
    
    if (!query) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing query parameter' 
        });
    }
    
    // Check if it's a direct URL
    const videoId = extractVideoId(query);
    
    if (videoId) {
        // It's a direct URL
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        
        switch(type) {
            case 'info':
                return res.redirect(`/api/info?url=${encodeURIComponent(url)}`);
            case 'mp3':
                return res.redirect(`/api/download/mp3?url=${encodeURIComponent(url)}`);
            case 'mp4':
                return res.redirect(`/api/download/mp4?url=${encodeURIComponent(url)}&quality=${quality}`);
            case 'stream':
                return res.redirect(`/api/stream/video?url=${encodeURIComponent(url)}&quality=${quality}`);
            case 'audio':
                return res.redirect(`/api/stream/audio?url=${encodeURIComponent(url)}`);
            default:
                return res.redirect(`/api/info?url=${encodeURIComponent(url)}`);
        }
    }
    
    // It's a search query
    try {
        const results = await ytSearch(query);
        
        if (type === 'mp3' || type === 'mp4') {
            // Auto-download first result
            const firstVideo = results.videos.find(v => v.type === 'video' && v.id);
            if (firstVideo) {
                if (type === 'mp3') {
                    return res.redirect(`/api/download/mp3?url=${encodeURIComponent(firstVideo.url)}`);
                } else {
                    return res.redirect(`/api/download/mp4?url=${encodeURIComponent(firstVideo.url)}&quality=${quality}`);
                }
            }
        }
        
        // Return search results
        const videosWithOptions = results.videos
            .filter(video => video.type === 'video' && video.id)
            .map(video => ({
                ...video,
                actions: {
                    info: `/api/get?q=${video.url}&type=info`,
                    mp3: `/api/get?q=${video.url}&type=mp3`,
                    mp4_360: `/api/get?q=${video.url}&type=mp4&quality=360p`,
                    mp4_720: `/api/get?q=${video.url}&type=mp4&quality=720p`
                }
            }));
        
        res.json({
            success: true,
            query: query,
            type: 'search_results',
            count: videosWithOptions.length,
            videos: videosWithOptions
        });
        
    } catch (error) {
        console.error('Smart endpoint error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// ==================== BATCH & UTILITY ENDPOINTS ====================

// 9. Batch search endpoint
app.get('/api/batch', async (req, res) => {
    const queries = req.query.q ? req.query.q.split(',') : [];
    const limit = parseInt(req.query.limit) || 3;
    
    if (queries.length === 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing query parameters. Use ?q=query1,query2,query3' 
        });
    }
    
    if (queries.length > 10) {
        return res.status(400).json({ 
            success: false, 
            error: 'Maximum 10 queries allowed' 
        });
    }
    
    try {
        const results = await Promise.all(
            queries.map(async (query) => {
                try {
                    const searchResults = await ytSearch(query.trim());
                    return {
                        query: query.trim(),
                        success: true,
                        results: searchResults.videos.slice(0, limit)
                    };
                } catch (error) {
                    return {
                        query: query.trim(),
                        success: false,
                        error: error.message,
                        results: []
                    };
                }
            })
        );
        
        res.json({
            success: true,
            count: queries.length,
            limit_per_query: limit,
            results: results
        });
        
    } catch (error) {
        console.error('Batch search error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// 10. Suggestions endpoint
app.get('/api/suggest', async (req, res) => {
    const query = req.query.q || req.query.query;
    
    if (!query || query.length < 2) {
        return res.json({ 
            success: true,
            query: query || '',
            suggestions: []
        });
    }
    
    try {
        const results = await ytSearch(query);
        
        const seen = new Set();
        const suggestions = [];
        
        for (const video of results.videos) {
            if (video.name && !seen.has(video.name) && suggestions.length < 15) {
                seen.add(video.name);
                suggestions.push({
                    text: video.name,
                    type: video.type,
                    id: video.id,
                    author: video.author
                });
            }
        }
        
        res.json({ 
            success: true,
            query: query,
            suggestions: suggestions
        });
        
    } catch (error) {
        console.error('Suggestions error:', error);
        res.json({ 
            success: true,
            query: query,
            suggestions: []
        });
    }
});

// ==================== HEALTH & DOCUMENTATION ====================

// 11. Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        success: true,
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'YouTube Search & Download API',
        version: '3.0.0',
        uptime: process.uptime(),
        endpoints: {
            search: {
                main: 'GET /?q=query',
                enhanced: 'GET /search?q=query',
                smart: 'GET /api/get?q=query&type=search|mp3|mp4|info',
                batch: 'GET /api/batch?q=query1,query2',
                suggest: 'GET /api/suggest?q=query'
            },
            info: {
                video_info: 'GET /api/info?url=youtube_url'
            },
            download: {
                mp3: 'GET /api/download/mp3?url=youtube_url',
                mp4: 'GET /api/download/mp4?url=youtube_url&quality=360p|720p|best',
                stream_audio: 'GET /api/stream/audio?url=youtube_url',
                stream_video: 'GET /api/stream/video?url=youtube_url&quality=360p|720p|best'
            }
        },
        examples: {
            search: '/?q=wangi nyaka anyombi',
            search_download: '/api/get?q=wangi nyaka anyombi&type=mp3',
            direct_download: '/api/download/mp3?url=https://youtube.com/watch?v=div2DHOFvR8',
            video_info: '/api/info?url=https://youtube.com/watch?v=div2DHOFvR8',
            batch: '/api/batch?q=coldplay,eminem,beyonce&limit=2'
        }
    });
});

// 12. Documentation endpoint
app.get('/docs', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>YouTube API Documentation</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 40px; line-height: 1.6; }
            .endpoint { background: #f4f4f4; padding: 15px; margin: 10px 0; border-radius: 5px; }
            code { background: #333; color: #fff; padding: 2px 6px; border-radius: 3px; }
            a { color: #0066cc; text-decoration: none; }
            a:hover { text-decoration: underline; }
            .example { background: #e8f4f8; padding: 10px; margin: 5px 0; border-left: 4px solid #0066cc; }
        </style>
    </head>
    <body>
        <h1>🎬 YouTube Search & Download API</h1>
        <p>Version 3.0.0 | Complete working API</p>
        
        <h2>📚 Quick Start</h2>
        <div class="example">
            <strong>Search:</strong> <code>GET /?q=your_query</code><br>
            <strong>Download MP3:</strong> <code>GET /api/download/mp3?url=youtube_url</code><br>
            <strong>Download MP4:</strong> <code>GET /api/download/mp4?url=youtube_url&quality=720p</code>
        </div>
        
        <h2>🔍 Search Endpoints</h2>
        <div class="endpoint">
            <h3>Basic Search</h3>
            <code>GET /?q=query</code> or <code>GET /?query=query</code><br>
            <div class="example">Example: <a href="/?q=wangi nyaka anyombi">/?q=wangi nyaka anyombi</a></div>
        </div>
        
        <div class="endpoint">
            <h3>Enhanced Search with Download Links</h3>
            <code>GET /search?q=query</code><br>
            <div class="example">Example: <a href="/search?q=wangi nyaka anyombi">/search?q=wangi nyaka anyombi</a></div>
        </div>
        
        <div class="endpoint">
            <h3>Smart Search & Download</h3>
            <code>GET /api/get?q=query&type=mp3|mp4|info|search</code><br>
            <div class="example">
                Search & download MP3: <a href="/api/get?q=wangi nyaka anyombi&type=mp3">/api/get?q=wangi nyaka anyombi&type=mp3</a><br>
                Direct URL download: <a href="/api/get?q=https://youtube.com/watch?v=div2DHOFvR8&type=mp3">/api/get?q=https://youtube.com/watch?v=div2DHOFvR8&type=mp3</a>
            </div>
        </div>
        
        <h2>⬇️ Download Endpoints</h2>
        <div class="endpoint">
            <h3>MP3 Download</h3>
            <code>GET /api/download/mp3?url=youtube_url</code><br>
            <div class="example">Example: <a href="/api/download/mp3?url=https://youtube.com/watch?v=div2DHOFvR8">/api/download/mp3?url=https://youtube.com/watch?v=div2DHOFvR8</a></div>
        </div>
        
        <div class="endpoint">
            <h3>MP4 Download</h3>
            <code>GET /api/download/mp4?url=youtube_url&quality=360p|720p|best</code><br>
            <div class="example">Example: <a href="/api/download/mp4?url=https://youtube.com/watch?v=div2DHOFvR8&quality=720p">/api/download/mp4?url=https://youtube.com/watch?v=div2DHOFvR8&quality=720p</a></div>
        </div>
        
        <h2>📊 Information Endpoints</h2>
        <div class="endpoint">
            <h3>Video Information</h3>
            <code>GET /api/info?url=youtube_url</code><br>
            <div class="example">Example: <a href="/api/info?url=https://youtube.com/watch?v=div2DHOFvR8">/api/info?url=https://youtube.com/watch?v=div2DHOFvR8</a></div>
        </div>
        
        <h2>🔄 Utility Endpoints</h2>
        <div class="endpoint">
            <h3>Health Check</h3>
            <code>GET /health</code><br>
            <div class="example">Example: <a href="/health">/health</a></div>
        </div>
        
        <div class="endpoint">
            <h3>Batch Search</h3>
            <code>GET /api/batch?q=query1,query2,query3&limit=2</code><br>
            <div class="example">Example: <a href="/api/batch?q=coldplay,eminem,beyonce&limit=2">/api/batch?q=coldplay,eminem,beyonce&limit=2</a></div>
        </div>
        
        <footer style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #ccc;">
            <p>API Base URL: <code>https://yts-m37q.onrender.com</code></p>
            <p>All endpoints support CORS and return JSON responses.</p>
        </footer>
    </body>
    </html>
    `;
    
    res.send(html);
});

// ==================== ERROR HANDLING ====================

// 404 Handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        available_endpoints: [
            'GET /?q=query - Search YouTube',
            'GET /search?q=query - Search with download links',
            'GET /api/info?url=youtube_url - Get video info',
            'GET /api/download/mp3?url=youtube_url - Download MP3',
            'GET /api/download/mp4?url=youtube_url - Download MP4',
            'GET /api/get?q=query_or_url&type=mp3|mp4 - Smart download',
            'GET /health - API status',
            'GET /docs - Documentation'
        ]
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal Server Error',
        message: err.message
    });
});

// ==================== START SERVER ====================

app.listen(port, () => {
    console.log(`🚀 Server is running on port: ${port}`);
    console.log(`🌐 Base URL: http://localhost:${port}`);
    console.log(`🔍 Search: http://localhost:${port}/?q=your_query`);
    console.log(`⬇️  Download MP3: http://localhost:${port}/api/download/mp3?url=youtube_url`);
    console.log(`📊 Health: http://localhost:${port}/health`);
    console.log(`📚 Docs: http://localhost:${port}/docs`);
    console.log(`✅ API Ready!`);
});
