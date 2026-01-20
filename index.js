const cors = require('cors'); 
const yts = require("yt-search");
const express = require("express");
const axios = require('axios');
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
                        isLive: false,
                        duration_seconds: video.seconds || 0
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

// Your original search endpoint
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

// Video info endpoint
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
        const results = await ytSearch(videoId);
        const video = results.videos.find(v => v.id === videoId);
        
        if (!video) {
            return res.status(404).json({ 
                success: false, 
                error: 'Video not found' 
            });
        }
        
        res.json({
            success: true,
            video: video,
            download_links: {
                mp3: `/download/mp3?id=${videoId}&title=${encodeURIComponent(video.name)}`,
                mp4: `/download/mp4?id=${videoId}&title=${encodeURIComponent(video.name)}`,
                direct_links: {
                    y2mate: `https://www.y2mate.com/youtube/${videoId}`,
                    ytmp3: `https://ytmp3.cc/en13/?v=${videoId}`,
                    savetube: `https://savetube.co/${videoId}`
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

// ==================== WORKING MP3 DOWNLOAD ====================
app.get('/download/mp3', async (req, res) => {
    const videoId = req.query.id || extractVideoId(req.query.url);
    const title = req.query.title || 'audio';
    
    if (!videoId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing video ID or URL' 
        });
    }

    try {
        // Method 1: Try external API first
        const apiUrl = `https://youtube-mp36.p.rapidapi.com/dl?id=${videoId}`;
        
        // Use a free external service
        const response = await axios.get(`https://api.vevioz.com/api/button/mp3/${videoId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.data && response.data.url) {
            // Redirect to the download URL
            return res.redirect(response.data.url);
        }
        
        // Method 2: Try another service
        try {
            const response2 = await axios.get(`https://api.onlinevideoconverter.pro/api/convert`, {
                params: {
                    url: `https://www.youtube.com/watch?v=${videoId}`,
                    format: 'mp3'
                }
            });
            
            if (response2.data && response2.data.url) {
                return res.redirect(response2.data.url);
            }
        } catch (e) {
            // Continue to next method
        }
        
        // Method 3: Redirect to external download site
        const safeTitle = title.replace(/[^\w\s]/gi, '_').substring(0, 100);
        res.header('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
        
        // Use ytdl-core alternative approach
        const ytdl = require('ytdl-core');
        const info = await ytdl.getInfo(videoId);
        const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
        
        if (format && format.url) {
            // Redirect to the direct audio URL
            return res.redirect(format.url);
        } else {
            // Fallback to external service
            return res.redirect(`https://www.y2mate.com/youtube-mp3/${videoId}`);
        }
        
    } catch (error) {
        console.error('MP3 download error:', error.message);
        
        // Ultimate fallback - redirect to external service
        res.redirect(`https://www.y2mate.com/youtube-mp3/${videoId}`);
    }
});

// ==================== WORKING MP4 DOWNLOAD ====================
app.get('/download/mp4', async (req, res) => {
    const videoId = req.query.id || extractVideoId(req.query.url);
    const quality = req.query.quality || '720p';
    const title = req.query.title || 'video';
    
    if (!videoId) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing video ID or URL' 
        });
    }

    try {
        // Method 1: Try external API
        const response = await axios.get(`https://api.vevioz.com/api/button/videos/${videoId}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        
        if (response.data && response.data.url) {
            return res.redirect(response.data.url);
        }
        
        // Method 2: Use ytdl-core directly
        const ytdl = require('ytdl-core');
        const info = await ytdl.getInfo(videoId);
        
        // Find the best available format
        let format;
        if (quality === 'highest') {
            format = ytdl.chooseFormat(info.formats, { quality: 'highest' });
        } else {
            format = ytdl.chooseFormat(info.formats, { 
                quality: quality,
                filter: 'audioandvideo'
            });
        }
        
        if (format && format.url) {
            const safeTitle = title.replace(/[^\w\s]/gi, '_').substring(0, 100);
            res.header('Content-Disposition', `attachment; filename="${safeTitle}.mp4"`);
            res.header('Content-Type', 'video/mp4');
            
            // Pipe the video stream
            ytdl(videoId, {
                quality: format.itag,
                filter: 'audioandvideo'
            }).pipe(res);
        } else {
            // Fallback to external service
            res.redirect(`https://www.y2mate.com/youtube/${videoId}`);
        }
        
    } catch (error) {
        console.error('MP4 download error:', error.message);
        
        // Ultimate fallback
        res.redirect(`https://www.y2mate.com/youtube/${videoId}`);
    }
});

// ==================== SIMPLE DOWNLOAD ENDPOINT ====================
app.get('/dl', async (req, res) => {
    const url = req.query.url;
    const type = req.query.type || 'mp3'; // mp3 or mp4
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing YouTube URL' 
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
        // Get video info for title
        const results = await ytSearch(videoId);
        const video = results.videos.find(v => v.id === videoId);
        const title = video ? video.name : 'download';
        
        if (type === 'mp3') {
            res.redirect(`/download/mp3?id=${videoId}&title=${encodeURIComponent(title)}`);
        } else if (type === 'mp4') {
            const quality = req.query.quality || '720p';
            res.redirect(`/download/mp4?id=${videoId}&title=${encodeURIComponent(title)}&quality=${quality}`);
        } else {
            res.status(400).json({
                success: false,
                error: 'Invalid type. Use mp3 or mp4'
            });
        }
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to process download'
        });
    }
});

// ==================== ENHANCED SEARCH WITH DOWNLOAD LINKS ====================
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
        
        const videosWithDownloads = results.videos
            .filter(video => video.type === 'video' && video.id)
            .map(video => ({
                ...video,
                download: {
                    info: `/info?url=${encodeURIComponent(video.url)}`,
                    mp3: `/dl?url=${encodeURIComponent(video.url)}&type=mp3`,
                    mp4_360p: `/dl?url=${encodeURIComponent(video.url)}&type=mp4&quality=360p`,
                    mp4_720p: `/dl?url=${encodeURIComponent(video.url)}&type=mp4&quality=720p`,
                    mp4_highest: `/dl?url=${encodeURIComponent(video.url)}&type=mp4&quality=highest`
                },
                quick_download: `https://yts-m37q.onrender.com/dl?url=${encodeURIComponent(video.url)}&type=mp3`
            }));
        
        res.json({ 
            success: true,
            query: query,
            count: videosWithDownloads.length,
            videos: videosWithDownloads 
        });
        
    } catch (error) {
        console.error('Search error:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error' 
        });
    }
});

// ==================== SMART DOWNLOAD ENDPOINT ====================
app.get('/get', async (req, res) => {
    const query = req.query.q || req.query.url;
    const type = req.query.type || 'mp3';
    
    if (!query) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing query parameter' 
        });
    }
    
    // Check if it's a direct URL
    const videoId = extractVideoId(query);
    
    if (videoId) {
        // Direct URL - redirect to download
        const url = query.startsWith('http') ? query : `https://www.youtube.com/watch?v=${videoId}`;
        
        if (type === 'mp3') {
            return res.redirect(`/dl?url=${encodeURIComponent(url)}&type=mp3`);
        } else if (type === 'mp4') {
            const quality = req.query.quality || '720p';
            return res.redirect(`/dl?url=${encodeURIComponent(url)}&type=mp4&quality=${quality}`);
        } else if (type === 'info') {
            return res.redirect(`/info?url=${encodeURIComponent(url)}`);
        }
    }
    
    // Otherwise perform search
    try {
        const results = await ytSearch(query);
        
        if (results.videos.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No videos found'
            });
        }
        
        // If user wants to download, use first result
        if (type === 'mp3' || type === 'mp4') {
            const firstVideo = results.videos.find(v => v.type === 'video' && v.id);
            if (firstVideo) {
                if (type === 'mp3') {
                    return res.redirect(`/dl?url=${encodeURIComponent(firstVideo.url)}&type=mp3`);
                } else {
                    const quality = req.query.quality || '720p';
                    return res.redirect(`/dl?url=${encodeURIComponent(firstVideo.url)}&type=mp4&quality=${quality}`);
                }
            }
        }
        
        // Return search results with download options
        const videosWithOptions = results.videos
            .filter(video => video.type === 'video' && video.id)
            .map(video => ({
                ...video,
                download_options: {
                    mp3: `/get?q=${video.url}&type=mp3`,
                    mp4_360p: `/get?q=${video.url}&type=mp4&quality=360p`,
                    mp4_720p: `/get?q=${video.url}&type=mp4&quality=720p`,
                    info: `/get?q=${video.url}&type=info`
                }
            }));
        
        res.json({
            success: true,
            query: query,
            type: 'search_results',
            videos: videosWithOptions
        });
        
    } catch (error) {
        console.error('Get endpoint error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal Server Error'
        });
    }
});

// ==================== HEALTH CHECK ====================
app.get('/health', (req, res) => {
    res.json({ 
        success: true,
        status: 'OK',
        timestamp: new Date().toISOString(),
        endpoints: {
            search: 'GET /?q=query',
            search_with_downloads: 'GET /search?q=query',
            info: 'GET /info?url=youtube_url',
            download_mp3: 'GET /download/mp3?id=video_id&title=video_title',
            download_mp4: 'GET /download/mp4?id=video_id&title=video_title&quality=720p',
            simple_download: 'GET /dl?url=youtube_url&type=mp3|mp4',
            smart_download: 'GET /get?q=query_or_url&type=mp3|mp4|info'
        },
        examples: {
            search: '/?q=wangi nyaka anyombi',
            download_mp3: '/dl?url=https://youtube.com/watch?v=div2DHOFvR8&type=mp3',
            download_mp4: '/dl?url=https://youtube.com/watch?v=div2DHOFvR8&type=mp4',
            smart_search_download: '/get?q=wangi nyaka anyombi&type=mp3'
        }
    });
});

// ==================== START SERVER ====================
app.listen(port, () => {
    console.log(`🚀 Server is running on port: ${port}`);
    console.log(`🔗 Search: http://localhost:${port}/?q=query`);
    console.log(`🔗 Download MP3: http://localhost:${port}/dl?url=youtube_url&type=mp3`);
    console.log(`🔗 Download MP4: http://localhost:${port}/dl?url=youtube_url&type=mp4`);
    console.log(`🔗 Smart: http://localhost:${port}/get?q=query_or_url&type=mp3`);
});
