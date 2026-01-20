require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const NodeCache = require('node-cache');
const yts = require("yt-search");
const ytdl = require('ytdl-core');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 2600;
const MONTHLY_LIMIT = 30000; // Free tier limit

// ==================== CONFIGURATION ====================
const API_CONFIG = {
  name: "Bera",
  creator: "Bruce Bera",
  version: "1.0.0",
  freeLimit: MONTHLY_LIMIT,
  premiumLimit: 100000,
  contact: "admin@beratech.co.ke"
};

// API Key Management (in production, use a database)
const apiKeys = new Map();
const apiUsage = new Map();
const requestCache = new NodeCache({ stdTTL: 600 }); // 10 minute cache

// Initialize default API key
apiKeys.set("bera", {
  key: "bera",
  name: "Free Tier",
  tier: "free",
  requests: 0,
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) // 1 year
});

// Initialize usage tracking
apiUsage.set("bera", {
  monthlyRequests: 0,
  totalRequests: 0,
  resetDate: getNextMonthResetDate(),
  lastRequest: null
});

// ==================== MIDDLEWARE ====================
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Global rate limiter to prevent abuse[citation:1][citation:8]
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    status: 429,
    success: false,
    creator: API_CONFIG.creator,
    message: "Too many requests from this IP, please try again later."
  }
});
app.use('/api/', globalLimiter);

// ==================== UTILITY FUNCTIONS ====================

function extractVideoId(url) {
  const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
}

function getNextMonthResetDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

function checkAPIKey(apikey) {
  // Check if API key exists
  if (!apiKeys.has(apikey)) {
    return {
      valid: false,
      message: "Invalid API Key"
    };
  }

  const keyInfo = apiKeys.get(apikey);
  const usage = apiUsage.get(apikey) || {
    monthlyRequests: 0,
    totalRequests: 0,
    resetDate: getNextMonthResetDate(),
    lastRequest: null
  };

  // Check if key is expired
  if (new Date() > new Date(keyInfo.expiresAt)) {
    return {
      valid: false,
      message: "API Key has expired"
    };
  }

  // Check monthly limit
  const limit = keyInfo.tier === "premium" ? API_CONFIG.premiumLimit : API_CONFIG.freeLimit;
  
  if (usage.monthlyRequests >= limit) {
    return {
      valid: false,
      limitExceeded: true,
      message: `Your API Key Limit is Exceeded. This is a ${keyInfo.tier} apikey with monthly limit of ${limit} reqs. Please Wait until the next month incase key limit is full for the limit to auto reset or Contact Admin for premium/unlimited/custom Api Key.`
    };
  }

  // Check if monthly reset is needed
  if (new Date() >= usage.resetDate) {
    usage.monthlyRequests = 0;
    usage.resetDate = getNextMonthResetDate();
  }

  // Update usage
  usage.monthlyRequests++;
  usage.totalRequests++;
  usage.lastRequest = new Date();
  apiUsage.set(apikey, usage);

  return {
    valid: true,
    tier: keyInfo.tier,
    remaining: limit - usage.monthlyRequests,
    resetDate: usage.resetDate
  };
}

// ==================== AUTHENTICATION MIDDLEWARE[citation:5] ====================

function authenticateAPI(req, res, next) {
  const apikey = req.query.apikey || req.headers['x-api-key'];
  
  if (!apikey) {
    return res.status(401).json({
      status: 401,
      success: false,
      creator: API_CONFIG.creator,
      message: "API Key is required"
    });
  }

  const keyCheck = checkAPIKey(apikey);
  
  if (!keyCheck.valid) {
    const status = keyCheck.limitExceeded ? 403 : 401;
    return res.status(status).json({
      status: status,
      success: false,
      creator: API_CONFIG.creator,
      message: keyCheck.message
    });
  }

  // Add API info to request
  req.apiInfo = {
    key: apikey,
    tier: keyCheck.tier,
    remaining: keyCheck.remaining,
    resetDate: keyCheck.resetDate
  };

  // Add rate limit headers[citation:4]
  res.setHeader('X-RateLimit-Limit', keyCheck.tier === "premium" ? API_CONFIG.premiumLimit : API_CONFIG.freeLimit);
  res.setHeader('X-RateLimit-Remaining', keyCheck.remaining);
  res.setHeader('X-RateLimit-Reset', keyCheck.resetDate.toISOString());

  next();
}

// ==================== API ENDPOINTS ====================

// 1. HOME PAGE WITH DASHBOARD
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 2. API STATUS
app.get('/api/status', authenticateAPI, (req, res) => {
  const usage = apiUsage.get(req.apiInfo.key);
  
  res.json({
    status: 200,
    success: true,
    creator: API_CONFIG.creator,
    service: `${API_CONFIG.name} YouTube API`,
    data: {
      tier: req.apiInfo.tier,
      monthlyRequests: usage.monthlyRequests,
      totalRequests: usage.totalRequests,
      monthlyLimit: req.apiInfo.tier === "premium" ? API_CONFIG.premiumLimit : API_CONFIG.freeLimit,
      remainingRequests: req.apiInfo.remaining,
      resetDate: req.apiInfo.resetDate,
      lastRequest: usage.lastRequest
    }
  });
});

// 3. SEARCH YOUTUBE VIDEOS
app.get('/api/search', authenticateAPI, async (req, res) => {
  const query = req.query.query || req.query.q;
  
  if (!query) {
    return res.status(400).json({
      status: 400,
      success: false,
      creator: API_CONFIG.creator,
      message: "Missing query parameter"
    });
  }

  try {
    const cacheKey = `search:${query}`;
    const cached = requestCache.get(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }

    const searchResults = await yts(query);
    const videos = searchResults.videos.slice(0, 20).map(video => ({
      id: video.videoId,
      title: video.title,
      duration: video.timestamp,
      views: video.views,
      author: video.author.name,
      thumbnail: video.thumbnail,
      url: video.url,
      uploaded: video.ago
    }));

    const response = {
      status: 200,
      success: true,
      creator: API_CONFIG.creator,
      data: {
        query: query,
        results: videos,
        count: videos.length
      }
    };

    requestCache.set(cacheKey, response);
    res.json(response);

  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      status: 500,
      success: false,
      creator: API_CONFIG.creator,
      message: "Failed to search videos"
    });
  }
});

// 4. GET VIDEO INFORMATION
app.get('/api/info', authenticateAPI, async (req, res) => {
  const url = req.query.url;
  
  if (!url) {
    return res.status(400).json({
      status: 400,
      success: false,
      creator: API_CONFIG.creator,
      message: "Missing URL parameter"
    });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({
      status: 400,
      success: false,
      creator: API_CONFIG.creator,
      message: "Invalid YouTube URL"
    });
  }

  try {
    const cacheKey = `info:${videoId}`;
    const cached = requestCache.get(cacheKey);
    
    if (cached) {
      return res.json(cached);
    }

    const info = await ytdl.getInfo(videoId);
    const formats = info.formats
      .filter(f => f.hasAudio || f.hasVideo)
      .map(f => ({
        quality: f.qualityLabel || f.audioQuality,
        container: f.container,
        hasAudio: f.hasAudio,
        hasVideo: f.hasVideo,
        bitrate: f.audioBitrate
      }));

    const response = {
      status: 200,
      success: true,
      creator: API_CONFIG.creator,
      data: {
        id: info.videoDetails.videoId,
        title: info.videoDetails.title,
        author: info.videoDetails.author.name,
        duration: parseInt(info.videoDetails.lengthSeconds),
        views: info.videoDetails.viewCount,
        thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
        formats: formats,
        availableQualities: {
          audio: [...new Set(formats.filter(f => f.hasAudio).map(f => f.quality))],
          video: [...new Set(formats.filter(f => f.hasVideo).map(f => f.quality))]
        }
      }
    };

    requestCache.set(cacheKey, response, 300); // Cache for 5 minutes
    res.json(response);

  } catch (error) {
    console.error('Info error:', error);
    res.status(500).json({
      status: 500,
      success: false,
      creator: API_CONFIG.creator,
      message: "Failed to get video information"
    });
  }
});

// 5. DOWNLOAD MP3
app.get('/api/download/mp3', authenticateAPI, async (req, res) => {
  const url = req.query.url;
  const quality = req.query.quality || '128';
  
  if (!url) {
    return res.status(400).json({
      status: 400,
      success: false,
      creator: API_CONFIG.creator,
      message: "Missing URL parameter"
    });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({
      status: 400,
      success: false,
      creator: API_CONFIG.creator,
      message: "Invalid YouTube URL"
    });
  }

  try {
    const info = await ytdl.getInfo(videoId);
    const title = info.videoDetails.title.replace(/[^\w\s]/gi, '_').substring(0, 100);
    
    res.header('Content-Disposition', `attachment; filename="${title}.mp3"`);
    res.header('Content-Type', 'audio/mpeg');
    
    const bitrate = parseInt(quality);
    const audioStream = ytdl(videoId, {
      quality: 'highestaudio',
      filter: 'audioonly'
    });

    // For MP3 conversion, you would typically pipe through ffmpeg
    // This example uses ytdl's built-in format selection
    audioStream.pipe(res);

  } catch (error) {
    console.error('MP3 download error:', error);
    res.status(500).json({
      status: 500,
      success: false,
      creator: API_CONFIG.creator,
      message: "Failed to download MP3"
    });
  }
});

// 6. DOWNLOAD MP4
app.get('/api/download/mp4', authenticateAPI, async (req, res) => {
  const url = req.query.url;
  const quality = req.query.quality || '360p';
  
  if (!url) {
    return res.status(400).json({
      status: 400,
      success: false,
      creator: API_CONFIG.creator,
      message: "Missing URL parameter"
    });
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    return res.status(400).json({
      status: 400,
      success: false,
      creator: API_CONFIG.creator,
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
      creator: API_CONFIG.creator,
      message: "Failed to download MP4"
    });
  }
});

// 7. ALIAS ENDPOINTS (for compatibility)
app.get('/api/download/ytmp3', authenticateAPI, (req, res) => {
  const newUrl = `/api/download/mp3?apikey=${req.apiInfo.key}&url=${encodeURIComponent(req.query.url)}&quality=${req.query.quality || '128'}`;
  res.redirect(newUrl);
});

app.get('/api/download/ytmp4', authenticateAPI, (req, res) => {
  const newUrl = `/api/download/mp4?apikey=${req.apiInfo.key}&url=${encodeURIComponent(req.query.url)}&quality=${req.query.quality || '360p'}`;
  res.redirect(newUrl);
});

// ==================== ADMIN ENDPOINTS ====================

// Generate new API key (protected with admin key)
app.post('/api/admin/generate-key', (req, res) => {
  const adminKey = req.query.admin_key || req.headers['x-admin-key'];
  const { name, tier = 'free', expiresInMonths = 12 } = req.body;
  
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({
      status: 403,
      success: false,
      creator: API_CONFIG.creator,
      message: "Unauthorized"
    });
  }
  
  if (!name) {
    return res.status(400).json({
      status: 400,
      success: false,
      creator: API_CONFIG.creator,
      message: "Name is required"
    });
  }
  
  // Generate random API key
  const newKey = 'bera_' + require('crypto').randomBytes(16).toString('hex');
  
  apiKeys.set(newKey, {
    key: newKey,
    name: name,
    tier: tier,
    requests: 0,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + expiresInMonths * 30 * 24 * 60 * 60 * 1000)
  });
  
  apiUsage.set(newKey, {
    monthlyRequests: 0,
    totalRequests: 0,
    resetDate: getNextMonthResetDate(),
    lastRequest: null
  });
  
  res.json({
    status: 200,
    success: true,
    creator: API_CONFIG.creator,
    data: {
      apiKey: newKey,
      name: name,
      tier: tier,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + expiresInMonths * 30 * 24 * 60 * 60 * 1000)
    }
  });
});

// Get all API keys (admin only)
app.get('/api/admin/keys', (req, res) => {
  const adminKey = req.query.admin_key || req.headers['x-admin-key'];
  
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(403).json({
      status: 403,
      success: false,
      creator: API_CONFIG.creator,
      message: "Unauthorized"
    });
  }
  
  const keys = Array.from(apiKeys.entries()).map(([key, info]) => ({
    key: key,
    ...info,
    usage: apiUsage.get(key) || {}
  }));
  
  res.json({
    status: 200,
    success: true,
    creator: API_CONFIG.creator,
    data: keys
  });
});

// ==================== ERROR HANDLING ====================

app.use((req, res) => {
  res.status(404).json({
    status: 404,
    success: false,
    creator: API_CONFIG.creator,
    message: "Endpoint not found",
    available_endpoints: [
      "GET /api/search?apikey=YOUR_KEY&query=SEARCH_TERM",
      "GET /api/info?apikey=YOUR_KEY&url=YOUTUBE_URL",
      "GET /api/download/mp3?apikey=YOUR_KEY&url=YOUTUBE_URL&quality=128|192|256|320",
      "GET /api/download/mp4?apikey=YOUR_KEY&url=YOUTUBE_URL&quality=144p|240p|360p|480p|720p|1080p|highest",
      "GET /api/status?apikey=YOUR_KEY"
    ]
  });
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  console.log(`🚀 ${API_CONFIG.name} YouTube API running on port: ${PORT}`);
  console.log(`🔗 Base URL: http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🔑 Default API Key: bera`);
  console.log(`📈 Monthly Limit: ${MONTHLY_LIMIT} requests`);
  console.log(`👨💻 Creator: ${API_CONFIG.creator}`);
});
