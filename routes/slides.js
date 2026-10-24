const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const sharp = require('sharp');

const router = express.Router();
const execFileAsync = promisify(execFile);
const TMP_DIR = path.join(__dirname, '..', 'tmp');
const MAX_SLIDES = 8;
const MAX_INPUT_BYTES = 35 * 1024 * 1024;

let ffmpegPath;
try {
  ffmpegPath = require('ffmpeg-static') || 'ffmpeg';
} catch (error) {
  console.warn('ffmpeg-static is unavailable; using system ffmpeg.');
  ffmpegPath = 'ffmpeg';
}

function parseDataUri(value, expression, label) {
  if (typeof value !== 'string') {
    const error = new Error(`${label} is missing.`);
    error.status = 400;
    throw error;
  }
  const match = value.match(expression);
  if (!match) {
    const error = new Error(`${label} must be a supported base64 file.`);
    error.status = 400;
    throw error;
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) {
    const error = new Error(`${label} is empty.`);
    error.status = 400;
    throw error;
  }
  return { mimeType: match[1].toLowerCase(), buffer };
}

function wrapText(value, maxCharacters) {
  const words = value.trim().split(/\s+/);
  const lines = [];
  let line = '';
  for (let word of words) {
    while (word.length > maxCharacters) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(word.slice(0, maxCharacters));
      word = word.slice(maxCharacters);
    }
    const nextLine = line ? `${line} ${word}` : word;
    if (line && nextLine.length > maxCharacters) {
      lines.push(line);
      line = word;
    } else {
      line = nextLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function makeCaptionSvg(text) {
  const lines = wrapText(text, 34);
  const fontSize = Math.min(52, 300 / lines.length);
  const lineHeight = fontSize * 1.2;
  const firstLineY = 650 - (lines.length - 1) * lineHeight;
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="640" y="${firstLineY + index * lineHeight}">${escapeXml(line)}</tspan>`
    )
    .join('');

  return Buffer.from(
    `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".78"/></linearGradient></defs><rect y="270" width="1280" height="450" fill="url(#shade)"/><text text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="700" fill="#fff" stroke="#000" stroke-opacity=".28" stroke-width="1">${tspans}</text></svg>`
  );
}

function getAudioExtension(mimeType) {
  const extensions = {
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/mp4': '.m4a',
    'audio/x-m4a': '.m4a',
    'audio/aac': '.aac',
    'audio/wav': '.wav',
    'audio/x-wav': '.wav',
    'audio/ogg': '.ogg',
  };
  return extensions[mimeType] || '.audio';
}

router.post('/create', async (req, res) => {
  let workingDirectory;
  let outputPath;

  try {
    const slides = req.body?.slides;
    if (!Array.isArray(slides) || slides.length < 1 || slides.length > MAX_SLIDES) {
      return res.status(400).json({
        success: false,
        message: `Add between 1 and ${MAX_SLIDES} slides.`,
      });
    }

    let inputBytes = 0;
    const preparedSlides = slides.map((slide, index) => {
      const text = typeof slide?.text === 'string' ? slide.text.trim() : '';
      if (!text || text.length > 240) {
        const error = new Error(`Slide ${index + 1} needs a caption of 1 to 240 characters.`);
        error.status = 400;
        throw error;
      }
      const image = parseDataUri(
        slide.image,
        /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i,
        `Slide ${index + 1} picture`
      );
      inputBytes += image.buffer.length;
      return { text, image };
    });

    let music;
    if (req.body?.music != null) {
      music = parseDataUri(
        req.body.music.data,
        /^data:(audio\/(?:mpeg|mp3|mp4|aac|wav|x-wav|ogg));base64,([A-Za-z0-9+/=\s]+)$/i,
        'Music'
      );
      inputBytes += music.buffer.length;
    }
    if (inputBytes > MAX_INPUT_BYTES) {
      const error = new Error('The selected files are too large. Use smaller pictures or audio files.');
      error.status = 413;
      throw error;
    }

    await fs.promises.mkdir(TMP_DIR, { recursive: true });
    workingDirectory = await fs.promises.mkdtemp(path.join(TMP_DIR, 'slides-'));
    const framePaths = [];

    for (const [index, slide] of preparedSlides.entries()) {
      const framePath = path.join(workingDirectory, `slide-${index}.jpg`);
      try {
        await sharp(slide.image.buffer).metadata();
      } catch {
        const error = new Error(`Slide ${index + 1} picture is not a valid image.`);
        error.status = 400;
        throw error;
      }
      const frame = await sharp(slide.image.buffer)
        .rotate()
        .resize(1280, 720, { fit: 'cover' })
        .composite([{ input: makeCaptionSvg(slide.text) }])
        .jpeg({ quality: 88 })
        .toBuffer();
      await fs.promises.writeFile(framePath, frame);
      framePaths.push(framePath);
    }

    const filterParts = framePaths.map(
      (_, index) =>
        `[${index}:v]trim=duration=4,setpts=PTS-STARTPTS,fps=30,format=yuv420p[v${index}]`
    );
    const videoStreams = framePaths.map((_, index) => `[v${index}]`).join('');
    filterParts.push(`${videoStreams}concat=n=${framePaths.length}:v=1:a=0[outv]`);

    const args = ['-y'];
    for (const framePath of framePaths) {
      args.push('-loop', '1', '-framerate', '30', '-t', '4', '-i', framePath);
    }

    let audioIndex = -1;
    if (music) {
      const musicPath = path.join(workingDirectory, `music${getAudioExtension(music.mimeType)}`);
      await fs.promises.writeFile(musicPath, music.buffer);
      audioIndex = framePaths.length;
      args.push('-stream_loop', '-1', '-i', musicPath);
    }

    const filename = `slides-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.mp4`;
    outputPath = path.join(TMP_DIR, filename);
    args.push(
      '-filter_complex',
      filterParts.join(';'),
      '-map',
      '[outv]'
    );
    const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 80) : '';
    if (title) args.push('-metadata', `title=${title}`);
    if (audioIndex >= 0) {
      args.push(
        '-map',
        `${audioIndex}:a:0`,
        '-af',
        `atrim=duration=${framePaths.length * 4},asetpts=PTS-STARTPTS`,
        '-c:a',
        'aac',
        '-b:a',
        '128k'
      );
    } else {
      args.push('-an');
    }
    args.push(
      '-t',
      String(framePaths.length * 4),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputPath
    );

    await execFileAsync(ffmpegPath, args, {
      maxBuffer: 20 * 1024 * 1024,
      timeout: 300000,
    });

    return res.json({
      success: true,
      videoUrl: `${req.protocol}://${req.get('host')}/api/slides/videos/${filename}`,
    });
  } catch (error) {
    console.error('Slideshow generation error:', error);
    if (outputPath) {
      try {
        await fs.promises.unlink(outputPath);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') {
          console.error('Unable to remove incomplete slideshow video:', cleanupError);
        }
      }
    }
    return res.status(error.status || 500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Unable to create slideshow video.',
    });
  } finally {
    if (workingDirectory) {
      try {
        await fs.promises.rm(workingDirectory, { recursive: true, force: true });
      } catch (error) {
        console.error('Unable to clean slideshow temporary files:', error);
      }
    }
  }
});

router.get('/videos/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!/^slides-\d+-[a-f0-9]+\.mp4$/i.test(filename)) {
    return res.status(404).json({ success: false, message: 'Video not found.' });
  }

  const filePath = path.join(TMP_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'Video not found.' });
  }
  return res.type('mp4').sendFile(filePath);
});

module.exports = router;
