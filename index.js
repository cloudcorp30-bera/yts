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

// Your original search endpoint - THE ONLY WORKING ONE
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

// Enhanced search that provides external download service links
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
        
        // Filter only videos and add external service URLs
        const videosWithExternalServices = results.videos
            .filter(video => video.type === 'video' && video.id)
            .map(video => {
                return {
                    ...video,
                    // Provide links to external services (not our own endpoints)
                    external_services: {
                        // Watch/Stream
                        youtube_watch: video.url,
                        youtube_embed: `https://www.youtube.com/embed/${video.id}`,
                        
                        // External converters (user will need to copy URL to these sites)
                        convert_instructions: `Copy this URL and paste into any YouTube downloader website: ${video.url}`,
                        
                        // Recommended external sites
                        recommended_sites: [
                            'y2mate.com',
                            'ytmp3.cc', 
                            'savetube.co',
                            'flvto.biz'
                        ]
                    }
                };
            });
        
        res.json({ 
            success: true,
            query: query,
            count: videosWithExternalServices.length,
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

// Simple video info endpoint
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
        
        res.json({
            success: true,
            video: video,
            external_links: {
                watch: video.url,
                embed: `https://www.youtube.com/embed/${video.id}`,
                thumbnail: `https://img.youtube.com/vi/${video.id}/maxresdefault.jpg`,
                // Note: We cannot provide direct download links due to YouTube restrictions
                download_suggestion: "Use external YouTube downloader websites or apps"
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

// Clean get endpoint - only provides search functionality
app.get('/get', async (req, res) => {
    const query = req.query.q || req.query.query || req.query.url;
    
    if (!query) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing query parameter' 
        });
    }

    try {
        const results = await ytSearch(query);
        
        // Clean response without broken download URLs
        const cleanVideos = results.videos.map(video => ({
            type: video.type,
            id: video.id,
            name: video.name,
            description: video.description,
            url: video.url,
            views: video.views,
            published: video.published,
            author: video.author,
            duration: video.duration,
            thumbnail: video.thumbnail,
            isLive: video.isLive
        }));
        
        res.json({ 
            success: true,
            query: query,
            count: cleanVideos.length,
            videos: cleanVideos 
        });
        
    } catch (error) {
        console.error('Error in /get endpoint:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error' 
        });
    }
});

// Health check and documentation
app.get('/health', (req, res) => {
    res.json({ 
        success: true,
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'YouTube Search API',
        working_endpoints: {
            search: 'GET /?q=query - Search YouTube videos',
            enhanced_search: 'GET /search?q=query - Search with external service info',
            video_info: 'GET /info?url=youtube_url - Get video information',
            clean_search: 'GET /get?q=query - Clean search results'
        },
        example_queries: {
            search: '/?q=wangi nyaka anyombi',
            search_with_params: '/?query=wangi nyaka anyombi',
            url_search: '/?q=https://youtube.com/watch?v=div2DHOFvR8'
        },
        note: 'This API only provides search functionality. For downloading, use external YouTube downloader services.'
    });
});

// Batch search for multiple queries
app.get('/batch', async (req, res) => {
    const queries = req.query.q ? req.query.q.split(',') : [];
    
    if (queries.length === 0) {
        return res.status(400).json({ 
            success: false, 
            error: 'Missing query parameters. Use ?q=query1,query2,query3' 
        });
    }
    
    if (queries.length > 5) {
        return res.status(400).json({ 
            success: false, 
            error: 'Maximum 5 queries allowed' 
        });
    }
    
    try {
        const searchPromises = queries.map(query => 
            ytSearch(query.trim()).catch(error => ({
                query: query.trim(),
                success: false,
                error: error.message,
                videos: []
            }))
        );
        
        const results = await Promise.all(searchPromises);
        
        const formattedResults = results.map((result, index) => ({
            query: queries[index].trim(),
            success: !result.error,
            count: result.videos ? result.videos.length : 0,
            videos: result.videos ? result.videos.slice(0, 3) : [] // Top 3 results
        }));
        
        res.json({
            success: true,
            count: queries.length,
            results: formattedResults
        });
        
    } catch (error) {
        console.error('Error in batch search:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Internal Server Error' 
        });
    }
});

// Suggestions/autocomplete endpoint
app.get('/suggest', async (req, res) => {
    const query = req.query.q || req.query.query; 
    
    if (!query || query.length < 2) {
        return res.json({ 
            success: true,
            query: query || '',
            suggestions: []
        });
    }

    try {
        // Get search results and use titles as suggestions
        const results = await ytSearch(query);
        
        // Extract unique titles (limited to 10)
        const seenTitles = new Set();
        const suggestions = [];
        
        for (const video of results.videos) {
            if (video.name && !seenTitles.has(video.name) && suggestions.length < 10) {
                seenTitles.add(video.name);
                suggestions.push({
                    text: video.name,
                    type: video.type,
                    id: video.id
                });
            }
        }
        
        res.json({ 
            success: true,
            query: query,
            suggestions: suggestions
        });
        
    } catch (error) {
        console.error('Error getting suggestions:', error);
        res.json({ 
            success: true,
            query: query,
            suggestions: []
        });
    }
});

// Start server
app.listen(port, () => {
    console.log(`✅ Server is running on port: ${port}`);
    console.log(`🔗 Main endpoint: http://localhost:${port}/?q=your_query`);
    console.log(`🔗 Example: http://localhost:${port}/?q=wangi nyaka anyombi`);
    console.log(`🔗 Health check: http://localhost:${port}/health`);
    console.log(`📝 Service: YouTube Search API (Search only)`);
    console.log(`⚠️  Note: Download functionality not available due to YouTube restrictions`);
});
