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
          const videos = data.all
            .filter(video => video.type === 'video') // Only include videos
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

// New: Get video info
async function getVideoInfo(videoId) {
  try {
    const info = await ytdl.getInfo(videoId);
    
    // Get available formats
    const formats = ytdl.filterFormats(info.formats, 'audioandvideo');
    const audioFormats = ytdl.filterFormats(info.formats, 'audioonly');
    const videoFormats = ytdl.filterFormats(info.formats, 'videoonly');
    
    return {
      id: info.videoDetails.videoId,
      title: info.videoDetails.title,
      author: info.videoDetails.author.name,
      duration: info.videoDetails.lengthSeconds,
      thumbnail: info.videoDetails.thumbnails[info.videoDetails.thumbnails.length - 1].url,
      formats: {
        audio: audioFormats.map(f => ({
          quality: f.audioQuality || 'unknown',
          codec: f.audioCodec,
          bitrate: f.audioBitrate,
          container: f.container,
          url: f.url
        })),
        video: videoFormats.map(f => ({
          quality: f.qualityLabel,
          codec: f.videoCodec,
          container: f.container,
          url: f.url
        }))
      }
    };
  } catch (error) {
    throw new Error(`Failed to get video info: ${error.message}`);
  }
}

// New: Download video in MP4 format
app.get('/download/mp4', async (req, res) => {
  const { id, quality = 'highest' } = req.query;
  
  if (!id) {
    return res.status(400).json({
      success: false,
      error: 'Video ID is required'
    });
  }
  
  try {
    const videoInfo = await ytdl.getInfo(id);
    const title = videoInfo.videoDetails.title.replace(/[^\w\s]/gi, '');
    
    res.header('Content-Disposition', `attachment; filename="${title}.mp4"`);
    res.header('Content-Type', 'video/mp4');
    
    ytdl(id, {
      quality: quality === 'highest' ? 'highest' : quality,
      filter: 'audioandvideo'
    }).pipe(res);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to download video'
    });
  }
});

// New: Download audio as MP3
app.get('/download/mp3', async (req, res) => {
  const { id, bitrate = '128' } = req.query;
  
  if (!id) {
    return res.status(400).json({
      success: false,
      error: 'Video ID is required'
    });
  }
  
  try {
    const videoInfo = await ytdl.getInfo(id);
    const title = videoInfo.videoDetails.title.replace(/[^\w\s]/gi, '');
    const tempFilePath = path.join(tempDir, `${id}_${Date.now()}.mp3`);
    
    // Stream audio and convert to MP3
    const audioStream = ytdl(id, { quality: 'highestaudio' });
    
    ffmpeg(audioStream)
      .audioBitrate(parseInt(bitrate))
      .toFormat('mp3')
      .on('error', (err) => {
        console.error('FFmpeg error:', err);
        res.status(500).json({
          success: false,
          error: 'Conversion failed'
        });
      })
      .on('end', () => {
        // Clean up temp file after sending
        fs.unlink(tempFilePath, () => {});
      })
      .pipe(res, { end: true });
    
    res.header('Content-Disposition', `attachment; filename="${title}.mp3"`);
    res.header('Content-Type', 'audio/mpeg');
    
  } catch (error) {
    console.error('MP3 conversion error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to convert to MP3'
    });
  }
});

// New: Get available formats for a video
app.get('/formats/:id', async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({
      success: false,
      error: 'Video ID is required'
    });
  }
  
  try {
    const info = await getVideoInfo(id);
    res.json({
      success: true,
      data: info
    });
  } catch (error) {
    console.error('Formats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get video formats'
    });
  }
});

// New: Stream audio (play in browser without download)
app.get('/stream/audio/:id', async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({
      success: false,
      error: 'Video ID is required'
    });
  }
  
  try {
    const audioStream = ytdl(id, {
      quality: 'highestaudio',
      filter: 'audioonly'
    });
    
    res.header('Content-Type', 'audio/mpeg');
    res.header('Accept-Ranges', 'bytes');
    
    audioStream.pipe(res);
  } catch (error) {
    console.error('Stream error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to stream audio'
    });
  }
});

// Updated search endpoint with video info
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
    res.json(results);
  } catch (error) {
    console.error('Error fetching yts data:', error);
    res.status(500).json({
      success: false,
      error: 'Internal Server Error'
    });
  }
});

// Root endpoint with instructions
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'YouTube Download API',
    endpoints: {
      search: '/search?q=query',
      formats: '/formats/[video-id]',
      download: {
        mp4: '/download/mp4?id=[video-id]&quality=[quality]',
        mp3: '/download/mp3?id=[video-id]&bitrate=[128|192|320]'
      },
      stream: '/stream/audio/[video-id]'
    },
    examples: {
      search: 'GET /search?q=coldplay',
      download_mp3: 'GET /download/mp3?id=dQw4w9WgXcQ'
    }
  });
});

app.listen(port, () => {
  console.log(`Server is running on port: ${port}`);
  console.log(`Temp directory: ${tempDir}`);
});
