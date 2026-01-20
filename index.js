const cors = require('cors'); 
const yts = require("yt-search");
const express = require("express");
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

// Enhanced search with external download services
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
        
        // Add external download services to each video
        const videosWithExternalServices = results.videos.map(video => {
            if (video.type === 'video' && video.id) {
                const encodedVideoUrl = encodeURIComponent(video.url);
                const encodedVideoTitle = encodeURIComponent(video.name);
                
                return {
                    ...video,
                    external_download_services: {
                        // Free YouTube to MP3 converters
                        y2mate: `https://www.y2mate.com/youtube/${video.id}`,
                        ytmp3: `https://ytmp3.cc/en13/?v=${video.id}`,
                        flvto: `https://www.flvto.biz/download/${video.id}/youtube-to-mp3`,
                        
                        // YouTube downloader sites
                        savetube: `https://savetube.co/${video.id}`,
                        yt5s: `https://en.yt5s.com/youtube-to-mp3/${video.id}`,
                        
                        // Direct links for apps/scripts
                        dl_links: {
                            audio: `https://www.youtube.com/watch?v=${video.id}`,
                            video: `https://www.youtube.com/watch?v=${video.id}`,
                            thumbnail: `https://img.youtube.com/vi/${video.id}/maxresdefault.jpg`
                        },
                        
                        // Quick download instructions
                        instructions: "Copy the YouTube URL and paste it into any YouTube downloader website like y2mate, ytmp3.cc, etc."
                    }
                };
            }
            return video;
        });
        
        res.json({ 
            success: true,
            query: query,
            videos: videosWithExternalServices 
        });
        
    } catch (error) {
        console.error('Error fetching yts data:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error' 
        });
    }
});

// Get detailed information about a specific video
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
        // Search for this specific video
        const results = await ytSearch(videoId);
        const video = results.videos.find(v => v.id === videoId);
        
        if (!video) {
            return res.status(404).json({ 
                success: false, 
                error: 'Video not found' 
            });
        }
        
        const encodedVideoUrl = encodeURIComponent(video.url);
        
        res.json({
            success: true,
            data: {
                id: video.id,
                title: video.name,
                author: video.author,
                description: video.description,
                duration: video.duration,
                duration_seconds: video.duration_seconds,
                views: video.views,
                published: video.published,
                thumbnail: video.thumbnail,
                url: video.url,
                
                // External services for downloading
                external_download_links: {
                    // MP3 converters
                    y2mate_mp3: `https://www.y2mate.com/youtube-mp3/${video.id}`,
                    ytmp3_mp3: `https://ytmp3.cc/en13/?v=${video.id}`,
                    
                    // Video downloaders
                    y2mate_video: `https://www.y2mate.com/youtube/${video.id}`,
                    savetube_video: `https://savetube.co/${video.id}`,
                    
                    // Other formats
                    flvto: `https://www.flvto.biz/download/${video.id}/youtube-to-mp3`,
                    convert2mp3: `https://www.convert2mp3.net/index.php?p=convert&url=${encodedVideoUrl}`,
                    
                    // Browser extensions suggestion
                    browser_extensions: [
                        "Video DownloadHelper (Firefox/Chrome)",
                        "YouTube Video Downloader (Chrome)",
                        "4K Video Downloader (Desktop App)"
                    ]
                },
                
                // Direct API alternatives (for developers)
                api_alternatives: {
                    rapidapi: "Use RapidAPI YouTube Downloader APIs",
                    scraperapi: "Use web scraping services",
                    puppeteer: "Use Puppeteer for browser automation"
                },
                
                instructions: {
                    web: "Copy the video URL and paste it into any YouTube downloader website",
                    mobile: "Use YouTube downloader apps like Snaptube, Videoder, etc.",
                    desktop: "Use 4K Video Downloader, YTD Video Downloader, etc."
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

// Smart endpoint for search + external download links
app.get('/get', async (req, res) => {
    const query = req.query.q || req.query.query || req.query.url;
    const format = req.query.format || 'search'; // 'search', 'info', 'mp3', 'mp4'
    
    if (!query) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing query parameter' 
        });
    }

    try {
        // Check if it's a direct URL
        const videoId = extractVideoId(query);
        
        if (videoId && format !== 'search') {
            // It's a direct URL, get info with external download links
            const url = query.startsWith('http') ? query : `https://www.youtube.com/watch?v=${videoId}`;
            
            // Search for this specific video
            const results = await ytSearch(videoId);
            const video = results.videos.find(v => v.id === videoId);
            
            if (!video) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Video not found' 
                });
            }
            
            const encodedVideoUrl = encodeURIComponent(video.url);
            
            // Return different formats based on request
            if (format === 'info') {
                return res.json({
                    success: true,
                    type: 'video_info',
                    video: video,
                    external_download: {
                        mp3: `https://www.y2mate.com/youtube-mp3/${video.id}`,
                        mp4: `https://www.y2mate.com/youtube/${video.id}`,
                        web_player: `https://www.youtube.com/embed/${video.id}`
                    }
                });
            } else if (format === 'mp3') {
                // Redirect to external MP3 converter
                return res.redirect(`https://www.y2mate.com/youtube-mp3/${video.id}`);
            } else if (format === 'mp4') {
                // Redirect to external video downloader
                return res.redirect(`https://www.y2mate.com/youtube/${video.id}`);
            }
        }
        
        // Perform a regular search
        const results = await ytSearch(query);
        
        // Add external download services to search results
        const videosWithServices = results.videos.map(video => {
            if (video.type === 'video' && video.id) {
                return {
                    ...video,
                    quick_download: `/get?q=${video.url}&format=info`,
                    external_links: {
                        mp3: `https://www.y2mate.com/youtube-mp3/${video.id}`,
                        mp4: `https://www.y2mate.com/youtube/${video.id}`
                    }
                };
            }
            return video;
        });
        
        res.json({ 
            success: true,
            query: query,
            type: 'search_results',
            count: videosWithServices.length,
            videos: videosWithServices 
        });
        
    } catch (error) {
        console.error('Error in /get endpoint:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error' 
        });
    }
});

// Health check and API documentation
app.get('/health', (req, res) => {
    res.json({ 
        success: true,
        status: 'OK',
        timestamp: new Date().toISOString(),
        version: '2.0.0',
        note: 'Using external download services due to YouTube restrictions',
        endpoints: {
            search: 'GET /?q=query - Original search endpoint',
            enhanced_search: 'GET /search?q=query - Search with external download links',
            video_info: 'GET /info?url=youtube_url - Video info with download options',
            smart_search: 'GET /get?q=query_or_url&format=search|info|mp3|mp4'
        },
        example_queries: {
            search: '/?q=coldplay yellow',
            search_with_downloads: '/search?q=coldplay yellow',
            video_info: '/info?url=https://youtube.com/watch?v=VIDEO_ID',
            quick_download: '/get?q=https://youtube.com/watch?v=VIDEO_ID&format=mp3'
        },
        recommended_external_services: [
            'y2mate.com',
            'ytmp3.cc',
            'savetube.co',
            'flvto.biz'
        ],
        disclaimer: 'This API only provides search functionality. For downloading, use the provided external service links.'
    });
});

// Batch search endpoint
app.get('/batch', async (req, res) => {
    const queries = req.query.q ? req.query.q.split(',') : [];
    
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
            queries.map(async (query, index) => {
                try {
                    const searchResults = await ytSearch(query.trim());
                    return {
                        query: query.trim(),
                        success: true,
                        results: searchResults.videos.slice(0, 3) // Return top 3 results
                    };
                } catch (error) {
                    return {
                        query: query.trim(),
                        success: false,
                        error: error.message
                    };
                }
            })
        );
        
        res.json({
            success: true,
            count: queries.length,
            results: results
        });
        
    } catch (error) {
        console.error('Error in batch search:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error' 
        });
    }
});

// Auto-complete/suggestions endpoint
app.get('/suggest', async (req, res) => {
    const query = req.query.q || req.query.query; 
    
    if (!query || query.length < 2) {
        return res.json({ 
            success: true,
            suggestions: []
        });
    }

    try {
        // Use yt-search to get suggestions
        const results = await ytSearch(query);
        
        // Extract unique video titles and authors as suggestions
        const suggestions = results.videos.slice(0, 10).map(video => ({
            text: video.name,
            type: video.type,
            author: video.author,
            id: video.id
        }));
        
        // Add query-based suggestions
        const querySuggestions = [
            `${query} music`,
            `${query} official video`,
            `${query} lyrics`,
            `${query} full album`,
            `${query} live`
        ].map(text => ({ text, type: 'suggestion' }));
        
        res.json({ 
            success: true,
            query: query,
            suggestions: [...suggestions, ...querySuggestions]
        });
        
    } catch (error) {
        console.error('Error getting suggestions:', error);
        res.json({ 
            success: true,
            suggestions: []
        });
    }
});

// Start server
app.listen(port, () => {
    console.log(`🚀 Server is running on port: ${port}`);
    console.log(`🔗 Search: http://localhost:${port}/?q=query`);
    console.log(`🔗 Search with downloads: http://localhost:${port}/search?q=query`);
    console.log(`🔗 Video info: http://localhost:${port}/info?url=youtube_url`);
    console.log(`🔗 Smart search: http://localhost:${port}/get?q=query_or_url&format=mp3`);
    console.log(`📝 Note: Due to YouTube restrictions, download links point to external services`);
});
