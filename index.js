const cors = require('cors');
const yts = require("yt-search");
const express = require("express");
const fs = require('fs');
const path = require('path');
const app = express();

// For YouTube downloading and conversion
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

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

// Create temp directory for downloads
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Clean up temp files periodically
setInterval(() => {
  fs.readdir(tempDir, (err, files) => {
    if (err) return;
    
    const now = Date.now();
    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      fs.stat(filePath, (err, stat) => {
        if (err) return;
        // Delete files older than 1 hour
        if (now - stat.mtime.getTime() > 60 * 60 * 1000) {
          fs.unlink(filePath, () => {});
        }
      });
    });
  });
}, 60 * 60 * 1000); // Run every hour

function extractVideoId(url) {
  const regex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/;
  const match = url.match(regex);
  return match ? match[1] : null;
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
          const videos = data.all
            .filter(video => video.type === 'video')
            .map(video => ({
              type: video.type,
              id: video.videoId,
              name: video.title,
              description: video.description,
              url: `https://www.youtube.com/watch?v=${video.videoId}`,
              views: video.views,
              published: video.ago,
              author: video.author?.name,
              duration: video.timestamp,
              duration_seconds: video.seconds,
              thumbnail: video.thumbnail,
              isLive: false,
              formats: {
                video: true,
                audio: true
              }
            }));
          
          // If it was a direct URL, return just that video
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

// NEW: Combined search and download endpoint
app.get('/get', async (req, res) => {
  const { q, type = 'info', quality = 'highest', bitrate = '192' } = req.query;
  
  if (!q) {
    return res.status(400).json({
      success: false,
      error: 'Query parameter (q) is required'
    });
  }
  
  try {
    // Check if it's a direct URL
    const videoId = extractVideoId(q);
    
    if (videoId) {
      // It's a direct URL - handle download directly
      const url = q.startsWith('http') ? q : `https://www.youtube.com/watch?v=${q}`;
      
      switch (type) {
        case 'info':
          return res.redirect(`/info?url=${encodeURIComponent(url)}`);
        case 'mp4':
          return res.redirect(`/download/mp4?url=${encodeURIComponent(url)}&quality=${quality}`);
        case 'mp3':
          return res.redirect(`/download/mp3?url=${encodeURIComponent(url)}&bitrate=${bitrate}`);
        case 'stream':
          return res.redirect(`/stream/audio?url=${encodeURIComponent(url)}`);
        case 'search':
          // Fall through to search
          break;
        default:
          return res.redirect(`/info?url=${encodeURIComponent(url)}`);
      }
    }
    
    // It's a search query - perform search
    const searchResults = await ytSearch(q);
    
    if (type === 'search' || type === 'info') {
      return res.json({
        success: true,
        query: q,
        type: 'search_results',
        count: searchResults.videos.length,
        videos: searchResults.videos.map(video => ({
          ...video,
          download_urls: {
            info: `/get?q=${video.url}&type=info`,
            mp4: `/get?q=${video.url}&type=mp4`,
            mp3: `/get?q=${video.url}&type=mp3`,
            stream: `/get?q=${video.url}&type=stream`
          }
        }))
      });
    }
    
    // If user wants to download from search results, return first result with download options
    if (searchResults.videos.length > 0) {
      const firstVideo = searchResults.videos[0];
      
      res.json({
        success: true,
        query: q,
        type: 'download_options',
        selected_video: {
          ...firstVideo,
          download_urls: {
            info: `/get?q=${firstVideo.url}&type=info`,
            mp4: `/get?q=${firstVideo.url}&type=mp4`,
            mp3: `/get?q=${firstVideo.url}&type=mp3`,
            stream: `/get?q=${firstVideo.url}&type=stream`
          }
        },
        other_options: searchResults.videos.slice(1, 5).map(video => ({
          id: video.id,
          title: video.name,
          duration: video.duration,
          author: video.author,
          select_url: `/get?q=${video.url}&type=${type}`
        }))
      });
    } else {
      res.json({
        success: false,
        error: 'No videos found for your search query'
      });
    }
  } catch (error) {
    console.error('Get endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process request'
    });
  }
});

// Smart download endpoint - NEW
app.get('/smart-download/:type', async (req, res) => {
  const { type } = req.params; // mp3 or mp4
  const { q, quality = type === 'mp3' ? '192' : 'highest' } = req.query;
  
  if (!q) {
    return res.status(400).json({
      success: false,
      error: 'Query parameter (q) is required'
    });
  }
  
  try {
    // Check if it's a direct URL
    const videoId = extractVideoId(q);
    
    if (videoId) {
      // Direct URL - redirect to download
      const url = q.startsWith('http') ? q : `https://www.youtube.com/watch?v=${q}`;
      return res.redirect(`/download/${type}?url=${encodeURIComponent(url)}&${type === 'mp3' ? 'bitrate' : 'quality'}=${quality}`);
    }
    
    // It's a search query - search and download first result
    const searchResults = await ytSearch(q);
    
    if (searchResults.videos.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No videos found for your search query'
      });
    }
    
    // Download the first search result
    const firstVideo = searchResults.videos[0];
    const url = firstVideo.url;
    
    return res.redirect(`/download/${type}?url=${encodeURIComponent(url)}&${type === 'mp3' ? 'bitrate' : 'quality'}=${quality}`);
    
  } catch (error) {
    console.error('Smart download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process download request'
    });
  }
});

// Get video info (kept for backward compatibility)
app.get('/info', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL parameter is required'
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
        },
        download_urls: {
          mp4: `/get?q=${url}&type=mp4`,
          mp3: `/get?q=${url}&type=mp3`,
          stream: `/get?q=${url}&type=stream`
        }
      }
    });
  } catch (error) {
    console.error('Info error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get video info'
    });
  }
});

// Download MP4 (kept for backward compatibility)
app.get('/download/mp4', async (req, res) => {
  const { url, quality = 'highest' } = req.query;
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL parameter is required'
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
    console.error('MP4 download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download video'
    });
  }
});

// Download MP3 (kept for backward compatibility)
app.get('/download/mp3', async (req, res) => {
  const { url, bitrate = '192' } = req.query;
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL parameter is required'
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
    
    const audioStream = ytdl(videoId, { 
      quality: 'highestaudio',
      filter: 'audioonly'
    });
    
    ffmpeg(audioStream)
      .audioBitrate(parseInt(bitrate))
      .toFormat('mp3')
      .on('error', (err) => {
        console.error('FFmpeg conversion error:', err);
        res.status(500).json({
          success: false,
          error: 'Audio conversion failed'
        });
      })
      .pipe(res, { end: true });
    
  } catch (error) {
    console.error('MP3 download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to convert to MP3'
    });
  }
});

// Audio stream (kept for backward compatibility)
app.get('/stream/audio', async (req, res) => {
  const { url } = req.query;
  
  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'URL parameter is required'
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
    const audioStream = ytdl(videoId, {
      quality: 'highestaudio',
      filter: 'audioonly'
    });
    
    res.header('Content-Type', 'audio/mpeg');
    res.header('Accept-Ranges', 'bytes');
    res.header('Cache-Control', 'no-cache');
    
    audioStream.pipe(res);
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stream audio'
    });
  }
});

// Search endpoint (kept for backward compatibility)
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
    const videosWithDownloads = results.videos.map(video => ({
      ...video,
      download_urls: {
        info: `/get?q=${video.url}&type=info`,
        mp4: `/get?q=${video.url}&type=mp4`,
        mp3: `/get?q=${video.url}&type=mp3`,
        stream: `/get?q=${video.url}&type=stream`
      }
    }));
    
    res.json({
      ...results,
      videos: videosWithDownloads
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to search videos'
    });
  }
});

// Home page with API documentation
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Gifted YouTube API',
    version: '1.0.0',
    endpoints: {
      // New unified endpoints
      smart_get: '/get?q=query_or_url&type=info|mp3|mp4|stream|search',
      smart_download: '/smart-download/mp3?q=query_or_url&bitrate=192',
      smart_download_mp4: '/smart-download/mp4?q=query_or_url&quality=highest',
      
      // Legacy endpoints (backward compatibility)
      search: '/search?q=query',
      info: '/info?url=youtube_url',
      download_mp4: '/download/mp4?url=youtube_url&quality=highest',
      download_mp3: '/download/mp3?url=youtube_url&bitrate=192',
      stream_audio: '/stream/audio?url=youtube_url'
    },
    examples: {
      // Using search queries (no need for URL!)
      search_and_info: '/get?q=coldplay yellow&type=info',
      search_and_download_first: '/get?q=coldplay yellow&type=mp3',
      smart_download_example: '/smart-download/mp3?q=coldplay yellow&bitrate=320',
      
      // Still works with URLs
      direct_url_info: '/get?q=https://youtube.com/watch?v=...&type=info',
      direct_url_download: '/get?q=https://youtube.com/watch?v=...&type=mp4',
      
      // Legacy examples
      search: '/search?q=coldplay',
      info: '/info?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    },
    notes: 'You can now use search queries directly! No need to find YouTube URLs first.'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

app.listen(port, () => {
  console.log(`🚀 Server running on port: ${port}`);
  console.log(`📁 Temp directory: ${tempDir}`);
  console.log(`🔗 Base URL: http://localhost:${port}`);
  console.log(`✨ New feature: Search and download without URLs!`);
  console.log(`   Example: /get?q=your_search_query&type=mp3`);
});
