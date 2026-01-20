const cors = require('cors'); 
const yts = require("yt-search");
const express = require("express");
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');
const app = express();

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

function extractVideoId(url) {
    const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;
    const match = url.match(regex);
    return match ? match[1] : null;
}

async function ytSearch(query) {
    return new Promise((resolve, reject) => {
        try {
            let searchQuery = query;
            if (query.startsWith('http://') || query.startsWith('https://')) {
                const videoId = extractVideoId(query);
                if (videoId) {
                    searchQuery = videoId;
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
                        isLive: false
                    }));
                    resolve({ videos }); 
                })
                .catch((error) => {
                    reject(error);
                    console.error(error);
                });
        } catch (error) {
            reject(error);
            console.error(error);
        }
    });
}

// Your existing search endpoint - unchanged
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
        console.error('Error fetching yts data:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error' 
        });
    }
});

// ==================== NEW DOWNLOAD ENDPOINTS ====================

// Get video information
app.get('/info', async (req, res) => {
    const url = req.query.url || req.query.video;
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing video URL parameter' 
        });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Invalid YouTube URL' 
        });
    }

    try {
        const info = await ytdl.getInfo(videoId);
        
        const formats = {
            audio: ytdl.filterFormats(info.formats, 'audioonly').map(f => ({
                quality: f.audioQuality || 'unknown',
                bitrate: f.audioBitrate,
                container: f.container,
                codec: f.audioCodec
            })),
            video: ytdl.filterFormats(info.formats, 'videoonly').map(f => ({
                quality: f.qualityLabel,
                container: f.container,
                codec: f.videoCodec
            })),
            combined: ytdl.filterFormats(info.formats, 'audioandvideo').map(f => ({
                quality: f.qualityLabel,
                container: f.container,
                hasAudio: !!f.audioCodec,
                hasVideo: !!f.videoCodec
            }))
        };
        
        res.json({
            success: true,
            data: {
                id: info.videoDetails.videoId,
                title: info.videoDetails.title,
                author: info.videoDetails.author.name,
                duration: parseInt(info.videoDetails.lengthSeconds),
                thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
                formats: formats,
                availableQualities: {
                    audio: [...new Set(formats.audio.map(f => f.quality))],
                    video: [...new Set(formats.video.map(f => f.quality))],
                    combined: [...new Set(formats.combined.map(f => f.quality))]
                }
            }
        });
    } catch (error) {
        console.error('Error getting video info:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get video information' 
        });
    }
});

// Download video as MP4
app.get('/download/mp4', async (req, res) => {
    const url = req.query.url || req.query.video;
    const quality = req.query.quality || 'highest';
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing video URL parameter' 
        });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Invalid YouTube URL' 
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
        console.error('Error downloading MP4:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to download video' 
        });
    }
});

// Download audio as MP3
app.get('/download/mp3', async (req, res) => {
    const url = req.query.url || req.query.video;
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing video URL parameter' 
        });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Invalid YouTube URL' 
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
        console.error('Error downloading MP3:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to download audio' 
        });
    }
});

// Stream audio
app.get('/stream/audio', async (req, res) => {
    const url = req.query.url || req.query.video;
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing video URL parameter' 
        });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Invalid YouTube URL' 
        });
    }

    try {
        res.header('Content-Type', 'audio/mpeg');
        res.header('Accept-Ranges', 'bytes');
        res.header('Cache-Control', 'no-cache');
        
        ytdl(videoId, {
            quality: 'highestaudio',
            filter: 'audioonly'
        }).pipe(res);
        
    } catch (error) {
        console.error('Error streaming audio:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to stream audio' 
        });
    }
});

// ==================== ENHANCED SEARCH WITH DOWNLOAD OPTIONS ====================

// Enhanced search that includes download URLs
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
        
        // Add download URLs to each video
        const videosWithDownloads = results.videos.map(video => {
            // Only add download options for actual videos (not playlists)
            if (video.type === 'video' && video.id) {
                return {
                    ...video,
                    download_urls: {
                        info: `/info?url=${encodeURIComponent(video.url)}`,
                        mp4: `/download/mp4?url=${encodeURIComponent(video.url)}`,
                        mp3: `/download/mp3?url=${encodeURIComponent(video.url)}`,
                        stream: `/stream/audio?url=${encodeURIComponent(video.url)}`
                    }
                };
            }
            return video;
        });
        
        res.json({ 
            success: true,
            query: query,
            videos: videosWithDownloads 
        });
        
    } catch (error) {
        console.error('Error fetching yts data:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error' 
        });
    }
});

// Smart endpoint that handles both search and direct URLs
app.get('/get', async (req, res) => {
    const query = req.query.q || req.query.query || req.query.url;
    const type = req.query.type || 'search'; // 'search', 'info', 'mp4', 'mp3', 'stream'
    
    if (!query) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing query parameter' 
        });
    }

    // Check if it's a direct YouTube URL
    const videoId = extractVideoId(query);
    
    if (videoId && type !== 'search') {
        // It's a direct URL, handle download
        const url = query.startsWith('http') ? query : `https://www.youtube.com/watch?v=${videoId}`;
        
        switch (type) {
            case 'info':
                return res.redirect(`/info?url=${encodeURIComponent(url)}`);
            case 'mp4':
                return res.redirect(`/download/mp4?url=${encodeURIComponent(url)}`);
            case 'mp3':
                return res.redirect(`/download/mp3?url=${encodeURIComponent(url)}`);
            case 'stream':
                return res.redirect(`/stream/audio?url=${encodeURIComponent(url)}`);
        }
    }
    
    // Otherwise, perform a search
    try {
        const results = await ytSearch(query);
        
        // If user specified a download type and we have results, use first result
        if ((type === 'mp4' || type === 'mp3' || type === 'stream') && results.videos.length > 0) {
            const firstVideo = results.videos.find(v => v.type === 'video');
            if (firstVideo) {
                return res.redirect(`/download/${type}?url=${encodeURIComponent(firstVideo.url)}`);
            }
        }
        
        // Return search results with download options
        const videosWithDownloads = results.videos.map(video => {
            if (video.type === 'video' && video.id) {
                return {
                    ...video,
                    download_urls: {
                        info: `/get?q=${video.url}&type=info`,
                        mp4: `/get?q=${video.url}&type=mp4`,
                        mp3: `/get?q=${video.url}&type=mp3`,
                        stream: `/get?q=${video.url}&type=stream`
                    }
                };
            }
            return video;
        });
        
        res.json({ 
            success: true,
            query: query,
            type: 'search_results',
            videos: videosWithDownloads 
        });
        
    } catch (error) {
        console.error('Error in /get endpoint:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error' 
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        success: true,
        status: 'OK',
        timestamp: new Date().toISOString(),
        endpoints: {
            search: 'GET /?q=query or /search?q=query',
            info: 'GET /info?url=youtube_url',
            download_mp4: 'GET /download/mp4?url=youtube_url',
            download_mp3: 'GET /download/mp3?url=youtube_url',
            stream: 'GET /stream/audio?url=youtube_url',
            smart: 'GET /get?q=query_or_url&type=search|info|mp4|mp3|stream'
        }
    });
});

app.listen(port, () => {
    console.log(`🚀 Server is running on port: ${port}`);
    console.log(`🔗 Search endpoint: http://localhost:${port}/?q=your_query`);
    console.log(`🔗 Download endpoint: http://localhost:${port}/download/mp3?url=youtube_url`);
    console.log(`🔗 Smart endpoint: http://localhost:${port}/get?q=query_or_url&type=mp3`);
});
