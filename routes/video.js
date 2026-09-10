// routes/video.js

const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { GoogleGenAI } = require('@google/genai');

const router = express.Router();
const execFileAsync = promisify(execFile);

// CONFIGURATION

console.log('🔥 VIDEO ROUTES FILE LOADED');
console.log('📁 File:', __filename);

const HEYGEN_API_URL = 'https://api.heygen.com';
const HEYGEN_UPLOAD_URL = 'https://upload.heygen.com';

const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const ai = GEMINI_API_KEY
  ? new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
    })
  : null;


// FFMPEG


let ffmpegPath;

try {
  ffmpegPath = require('ffmpeg-static');

  if (!ffmpegPath) {
    ffmpegPath = 'ffmpeg';
  }
} catch (error) {
  console.warn(
    '⚠️ ffmpeg-static not available. Using system ffmpeg.'
  );

  ffmpegPath = 'ffmpeg';
}

console.log('🎬 FFmpeg:', ffmpegPath);

// ============================================================
// DIRECTORIES
// ============================================================

const TMP_DIR = path.join(__dirname, '..', 'tmp');

if (!fs.existsSync(TMP_DIR)) {
  fs.mkdirSync(TMP_DIR, {
    recursive: true,
  });
}

console.log('📂 Temporary directory:', TMP_DIR);

// ============================================================
// GENERAL HELPERS
// ============================================================

function safeUnlink(filePath) {
  if (!filePath) return;

  return fs.promises
    .unlink(filePath)
    .catch(() => {});
}

function cleanBase64(value) {
  if (!value) {
    return '';
  }

  return String(value)
    .replace(/^data:[^;]+;base64,/i, '')
    .replace(/\s/g, '');
}

function getMimeType(value) {
  if (!value) {
    return 'image/jpeg';
  }

  const mime = String(value).toLowerCase();

  if (mime.includes('png')) {
    return 'image/png';
  }

  if (mime.includes('webp')) {
    return 'image/webp';
  }

  if (mime.includes('gif')) {
    return 'image/gif';
  }

  return 'image/jpeg';
}

function getImageExtension(mimeType) {
  const mime = getMimeType(mimeType);

  if (mime === 'image/png') {
    return '.png';
  }

  if (mime === 'image/webp') {
    return '.webp';
  }

  if (mime === 'image/gif') {
    return '.gif';
  }

  return '.jpg';
}

function makeFilename(prefix, extension = '.mp4') {
  return `${prefix}-${Date.now()}-${crypto
    .randomBytes(6)
    .toString('hex')}${extension}`;
}

function getPublicApiBaseUrl(req) {
  let base =
    process.env.PUBLIC_API_URL ||
    `${req.protocol}://${req.get('host')}/api/video`;

  base = String(base).replace(/\/+$/, '');

  if (base.endsWith('/api/video')) {
    return base;
  }

  return `${base}/api/video`;
}

function getHeyGenHeaders(extra = {}) {
  if (!HEYGEN_API_KEY) {
    throw new Error(
      'HEYGEN_API_KEY is not configured.'
    );
  }

  return {
    'X-Api-Key': HEYGEN_API_KEY,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...extra,
  };
}

function getErrorMessage(error) {
  if (!error) {
    return 'Unknown error';
  }

  if (error.response?.data) {
    const data = error.response.data;

    if (typeof data === 'string') {
      return data;
    }

    return (
      data.message ||
      data.error?.message ||
      data.error ||
      JSON.stringify(data)
    );
  }

  return error.message || String(error);
}

function getStatusCode(error) {
  return error?.response?.status || 500;
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === 'http:' ||
      url.protocol === 'https:'
    );
  } catch {
    return false;
  }
}

function getFilenameFromRequest(value) {
  if (!value) {
    return null;
  }

  return path.basename(String(value));
}

function resolveTmpFile(filename) {
  const safeFilename =
    getFilenameFromRequest(filename);

  if (!safeFilename) {
    return null;
  }

  const fullPath = path.resolve(
    TMP_DIR,
    safeFilename
  );

  const rootPath = path.resolve(TMP_DIR);

  if (
    fullPath !== rootPath &&
    !fullPath.startsWith(rootPath + path.sep)
  ) {
    return null;
  }

  return fullPath;
}

// ============================================================
// HEYGEN RESPONSE HELPERS
// ============================================================

function extractHeyGenVoices(payload) {
  if (!payload) {
    return [];
  }

  // Raw array
  if (Array.isArray(payload)) {
    return payload;
  }

  // Most common:
  // { data: [...] }
  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  // { voices: [...] }
  if (Array.isArray(payload.voices)) {
    return payload.voices;
  }

  // { data: { voices: [...] } }
  if (
    payload.data &&
    Array.isArray(payload.data.voices)
  ) {
    return payload.data.voices;
  }

  // { result: [...] }
  if (Array.isArray(payload.result)) {
    return payload.result;
  }

  // { result: { voices: [...] } }
  if (
    payload.result &&
    Array.isArray(payload.result.voices)
  ) {
    return payload.result.voices;
  }

  return [];
}

function extractHeyGenPagination(payload) {
  const sources = [
    payload,
    payload?.data,
    payload?.result,
  ].filter(Boolean);

  let hasMore = false;
  let nextToken = null;

  for (const source of sources) {
    if (source.has_more !== undefined) {
      hasMore = Boolean(source.has_more);
    }

    if (source.hasMore !== undefined) {
      hasMore = Boolean(source.hasMore);
    }

    if (source.next_token) {
      nextToken = source.next_token;
    }

    if (source.nextToken) {
      nextToken = source.nextToken;
    }

    if (source.next_page_token) {
      nextToken = source.next_page_token;
    }

    if (source.nextPageToken) {
      nextToken = source.nextPageToken;
    }
  }

  return {
    hasMore,
    nextToken,
  };
}

function normalizeHeyGenVoice(voice) {
  if (!voice || typeof voice !== 'object') {
    return null;
  }

  const voiceId =
    voice.voice_id ||
    voice.voiceId ||
    voice.id ||
    '';

  if (!voiceId) {
    return null;
  }

  return {
    ...voice,

    voice_id: voiceId,

    name:
      voice.name ||
      voice.voice_name ||
      voice.voiceName ||
      'Unnamed voice',

    language:
      voice.language ||
      voice.language_code ||
      voice.languageCode ||
      '',

    gender:
      voice.gender ||
      '',

    type:
      voice.type ||
      '',

    preview_audio:
      voice.preview_audio ||
      voice.previewAudio ||
      voice.preview_audio_url ||
      voice.previewAudioUrl ||
      '',
  };
}

// ============================================================
// HEYGEN IMAGE HELPER
// ============================================================

function createHeyGenBase64Image(
  imageBase64,
  mimeType = 'image/jpeg'
) {
  return {
    type: 'base64',
    media_type: getMimeType(mimeType),
    data: cleanBase64(imageBase64),
  };
}

// ============================================================
// AUDIO MIME HELPER
// ============================================================

function normalizeAudioMimeType(value) {
  let mime = String(
    value || 'audio/mp4'
  ).toLowerCase();

  if (
    mime === 'application/octet-stream'
  ) {
    return 'audio/mp4';
  }

  if (
    mime.includes('m4a') ||
    mime.includes('mp4')
  ) {
    return 'audio/mp4';
  }

  if (mime.includes('wav')) {
    return 'audio/wav';
  }

  if (
    mime.includes('mpeg') ||
    mime.includes('mp3')
  ) {
    return 'audio/mpeg';
  }

  if (mime.includes('aac')) {
    return 'audio/aac';
  }

  return mime;
}

// ============================================================
// STATIC PHOTO → VIDEO
// ============================================================

async function createStaticBackgroundVideo(
  imageBase64,
  mimeType,
  outputPath,
  duration = 15
) {
  const safeDuration = Math.min(
    60,
    Math.max(
      3,
      Number(duration) || 15
    )
  );

  const extension =
    getImageExtension(mimeType);

  const imagePath = path.join(
    TMP_DIR,
    `background-${Date.now()}-${crypto
      .randomBytes(4)
      .toString('hex')}${extension}`
  );

  try {
    const buffer = Buffer.from(
      cleanBase64(imageBase64),
      'base64'
    );

    if (!buffer.length) {
      throw new Error(
        'The background image is empty or invalid.'
      );
    }

    await fs.promises.writeFile(
      imagePath,
      buffer
    );

    const args = [
      '-y',
      '-loop',
      '1',
      '-i',
      imagePath,
      '-t',
      String(safeDuration),
      '-vf',
      [
        'scale=1080:1920:force_original_aspect_ratio=increase',
        'crop=1080:1920',
        'setsar=1',
      ].join(','),
      '-r',
      '30',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-an',
      '-movflags',
      '+faststart',
      outputPath,
    ];

    console.log(
      '=========================================='
    );

    console.log(
      '🎬 Creating static background video...'
    );

    console.log(
      '⏱️ Duration:',
      safeDuration
    );

    console.log(
      '=========================================='
    );

    await execFileAsync(
      ffmpegPath,
      args,
      {
        maxBuffer:
          20 * 1024 * 1024,
      }
    );

    return outputPath;
  } finally {
    await safeUnlink(imagePath);
  }
}

// ============================================================
// GEMINI / VEO BACKGROUND VIDEO
// ============================================================

async function downloadGeminiVideo(
  videoObject,
  outputPath
) {
  if (!videoObject) {
    throw new Error(
      'Gemini returned no video object.'
    );
  }

  const videoUrl =
    videoObject.uri ||
    videoObject.url ||
    videoObject.downloadUri ||
    videoObject.downloadUrl;

  if (
    videoUrl &&
    isValidHttpUrl(videoUrl)
  ) {
    console.log(
      '⬇️ Downloading Gemini video from URL...'
    );

    const response =
      await axios.get(videoUrl, {
        responseType:
          'arraybuffer',
        timeout: 300000,
      });

    await fs.promises.writeFile(
      outputPath,
      response.data
    );

    return outputPath;
  }

  const fileName =
    videoObject.name ||
    videoObject.videoObject?.name;

  if (
    fileName &&
    ai &&
    ai.files &&
    typeof ai.files.download ===
      'function'
  ) {
    console.log(
      '⬇️ Downloading Gemini generated file...'
    );

    await ai.files.download({
      file: fileName,
      downloadPath: outputPath,
    });

    return outputPath;
  }

  throw new Error(
    'Gemini returned a video, but no downloadable video URL was found.'
  );
}

async function generateMovingBackgroundVideo(
  imageBase64,
  mimeType,
  outputPath
) {
  if (!ai) {
    throw new Error(
      'GEMINI_API_KEY is not configured.'
    );
  }

  const clean =
    cleanBase64(imageBase64);

  if (!clean) {
    throw new Error(
      'Background image is missing.'
    );
  }

  const finalMime =
    getMimeType(mimeType);

  console.log(
    '=========================================='
  );

  console.log(
    '🤖 STARTING GEMINI / VEO'
  );

  console.log(
    '=========================================='
  );

  let operation =
    await ai.models.generateVideos({
      model:
        'veo-3.1-generate-preview',

      prompt:
        'Animate this real farm photograph into a natural realistic farming scene. Preserve the original farm, crops, soil, buildings, animals and overall appearance as much as possible. Add subtle realistic movement such as gentle wind moving crops and leaves, natural environmental movement and slight cinematic camera movement. Do not turn the photograph into a cartoon. Do not replace the farm with a different location.',

      image: {
        imageBytes: clean,
        mimeType: finalMime,
      },

      config: {
        aspectRatio: '9:16',
        resolution: '720p',
      },
    });

  for (
    let attempt = 1;
    attempt <= 60;
    attempt++
  ) {
    console.log(
      `🤖 Gemini status check ${attempt}/60`
    );

    if (operation?.error) {
      throw new Error(
        operation.error.message ||
          JSON.stringify(
            operation.error
          )
      );
    }

    if (operation?.done) {
      break;
    }

    await new Promise(
      resolve =>
        setTimeout(
          resolve,
          10000
        )
    );

    operation =
      await ai.operations.get({
        operation,
      });
  }

  if (!operation?.done) {
    throw new Error(
      'Gemini video generation timed out.'
    );
  }

  if (operation?.error) {
    throw new Error(
      operation.error.message ||
        JSON.stringify(
          operation.error
        )
    );
  }

  const generatedVideos =
    operation.response
      ?.generatedVideos ||
    operation.response?.videos ||
    [];

  if (!generatedVideos.length) {
    throw new Error(
      'Gemini completed but returned no video.'
    );
  }

  const videoObject =
    generatedVideos[0]?.video ||
    generatedVideos[0];

  return downloadGeminiVideo(
    videoObject,
    outputPath
  );
}

// ============================================================
// COMPOSITE BACKGROUND + CHARACTER
// ============================================================

async function compositeVideoOverVideo(
  backgroundPath,
  characterPath,
  outputPath
) {
  console.log(
    '=========================================='
  );

  console.log(
    '🎬 COMPOSITING CHARACTER + BACKGROUND'
  );

  console.log(
    '=========================================='
  );

  const args = [
    '-y',

    '-i',
    backgroundPath,

    '-i',
    characterPath,

    '-filter_complex',

    [
      '[0:v]',
      'scale=1080:1920:force_original_aspect_ratio=increase,',
      'crop=1080:1920,',
      'setsar=1',
      '[bg];',

      '[1:v]',
      'scale=ceil(iw*0.72/2)*2:-2,',
      'setsar=1',
      '[char];',

      '[bg][char]',
      'overlay=(W-w)/2:H-h-120:eof_action=pass:shortest=0',
      '[video]',
    ].join(''),

    '-map',
    '[video]',

    '-map',
    '1:a?',

    '-c:v',
    'libx264',

    '-preset',
    'veryfast',

    '-pix_fmt',
    'yuv420p',

    '-c:a',
    'aac',

    '-b:a',
    '192k',

    '-shortest',

    '-movflags',
    '+faststart',

    outputPath,
  ];

  await execFileAsync(
    ffmpegPath,
    args,
    {
      maxBuffer:
        20 * 1024 * 1024,
    }
  );

  return outputPath;
}

// ============================================================
// HEALTH / TEST
// ============================================================

router.get(
  '/test',
  async (req, res) => {
    return res.json({
      success: true,

      message:
        'Video routes are working.',

      file: __filename,

      ffmpeg: ffmpegPath,

      heygenConfigured:
        Boolean(HEYGEN_API_KEY),

      geminiConfigured:
        Boolean(GEMINI_API_KEY),
    });
  }
);

// ============================================================
// BACKGROUND TEST
// ============================================================

router.get(
  '/background/test',
  (req, res) => {
    return res.json({
      success: true,

      message:
        'Background video routes are working.',

      ffmpeg: ffmpegPath,

      tmpDirectory: TMP_DIR,

      routes: [
        'POST /api/video/background/photo',
        'POST /api/video/background/generate',
      ],
    });
  }
);

// ============================================================
// BACKGROUND PHOTO → VIDEO
// ============================================================

router.post(
  '/background/photo',
  async (req, res) => {
    try {
      const {
        backgroundImageBase64,
        imageBase64,
        mimeType = 'image/jpeg',
        duration = 15,
      } = req.body;

      const base64 =
        backgroundImageBase64 ||
        imageBase64;

      if (!base64) {
        return res.status(400).json({
          success: false,

          message:
            'backgroundImageBase64 is required.',
        });
      }

      const filename =
        makeFilename(
          'background-photo'
        );

      const outputPath =
        path.join(
          TMP_DIR,
          filename
        );

      await createStaticBackgroundVideo(
        base64,
        mimeType,
        outputPath,
        duration
      );

      const baseUrl =
        getPublicApiBaseUrl(req);

      return res.json({
        success: true,

        message:
          'Background photo converted to video successfully.',

        filename,

        duration: Math.min(
          60,
          Math.max(
            3,
            Number(duration) || 15
          )
        ),

        videoUrl:
          `${baseUrl}/files/${encodeURIComponent(
            filename
          )}`,
      });
    } catch (error) {
      console.error(
        '❌ Background photo error:',
        error
      );

      return res.status(
        getStatusCode(error)
      ).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// BACKGROUND PHOTO → GEMINI VIDEO
// ============================================================

router.post(
  '/background/generate',
  async (req, res) => {
    try {
      const {
        backgroundImageBase64,
        imageBase64,
        mimeType = 'image/jpeg',
      } = req.body;

      const base64 =
        backgroundImageBase64 ||
        imageBase64;

      if (!base64) {
        return res.status(400).json({
          success: false,

          message:
            'backgroundImageBase64 is required.',
        });
      }

      if (!GEMINI_API_KEY) {
        return res.status(503).json({
          success: false,

          code:
            'GEMINI_NOT_CONFIGURED',

          message:
            'GEMINI_API_KEY is not configured. Use Photo As-Is instead.',
        });
      }

      const filename =
        makeFilename(
          'background-ai'
        );

      const outputPath =
        path.join(
          TMP_DIR,
          filename
        );

      try {
        await generateMovingBackgroundVideo(
          base64,
          mimeType,
          outputPath
        );
      } catch (error) {
        const message =
          getErrorMessage(error);

        const lower =
          message.toLowerCase();

        const isQuota =
          message.includes('429') ||
          lower.includes('quota') ||
          lower.includes(
            'resource exhausted'
          );

        if (isQuota) {
          return res.status(429).json({
            success: false,

            code:
              'GEMINI_QUOTA_EXCEEDED',

            message:
              'Gemini video quota has been exceeded. Please use "Use Photo As-Is".',
          });
        }

        throw error;
      }

      const baseUrl =
        getPublicApiBaseUrl(req);

      return res.json({
        success: true,

        message:
          'AI background video generated successfully.',

        filename,

        videoUrl:
          `${baseUrl}/files/${encodeURIComponent(
            filename
          )}`,
      });
    } catch (error) {
      console.error(
        '❌ Gemini background error:',
        error
      );

      return res.status(
        getStatusCode(error)
      ).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// HEYGEN TEST
// ============================================================

router.get(
  '/heygen/test',
  async (req, res) => {
    try {
      if (!HEYGEN_API_KEY) {
        return res.status(503).json({
          success: false,

          message:
            'HEYGEN_API_KEY is not configured.',
        });
      }

      const response =
        await axios.get(
          `${HEYGEN_API_URL}/v3/voices`,
          {
            headers:
              getHeyGenHeaders(),

            params: {
              limit: 10,
            },

            timeout: 30000,
          }
        );

      const voices =
        extractHeyGenVoices(
          response.data
        );

      return res.json({
        success: true,

        message:
          'HeyGen configuration is working.',

        voiceCount:
          voices.length,

        model:
          'heygen-v3',
      });
    } catch (error) {
      console.error(
        '❌ HeyGen test error:',
        error.response?.data ||
          error.message
      );

      return res.status(
        getStatusCode(error)
      ).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// GET HEYGEN VOICES
// ============================================================

router.get(
  '/heygen/voices',
  async (req, res) => {
    try {
      if (!HEYGEN_API_KEY) {
        return res.status(503).json({
          success: false,

          message:
            'HEYGEN_API_KEY is not configured.',
        });
      }

      const limit =
        Math.min(
          100,
          Math.max(
            1,
            Number(
              req.query.limit
            ) || 100
          )
        );

      const params = {
        limit,
      };

      if (req.query.token) {
        params.token =
          req.query.token;
      }

      if (
        !params.token &&
        req.query.page_token
      ) {
        params.token =
          req.query.page_token;
      }

      if (req.query.type) {
        params.type =
          req.query.type;
      }

      if (req.query.language) {
        params.language =
          req.query.language;
      }

      if (req.query.gender) {
        params.gender =
          req.query.gender;
      }

      if (req.query.engine) {
        params.engine =
          req.query.engine;
      }

      console.log(
        '=========================================='
      );

      console.log(
        '🎙️ REQUESTING HEYGEN VOICES'
      );

      console.log(
        'Params:',
        params
      );

      console.log(
        '=========================================='
      );

      const response =
        await axios.get(
          `${HEYGEN_API_URL}/v3/voices`,
          {
            headers:
              getHeyGenHeaders(),

            params,

            timeout: 30000,
          }
        );

      // IMPORTANT:
      // Normalize every known HeyGen response shape.
      const rawResponse =
        response.data;

      console.log(
        '🎙️ HeyGen raw voice response keys:',
        rawResponse &&
          typeof rawResponse === 'object'
          ? Object.keys(rawResponse)
          : typeof rawResponse
      );

      const rawVoices =
        extractHeyGenVoices(
          rawResponse
        );

      const voices =
        rawVoices
          .map(normalizeHeyGenVoice)
          .filter(Boolean);

      const pagination =
        extractHeyGenPagination(
          rawResponse
        );

      console.log(
        '🎙️ HEYGEN VOICES FOUND:',
        voices.length
      );

      if (voices.length > 0) {
        console.log(
          '🎙️ First voice:',
          {
            id:
              voices[0].voice_id,

            name:
              voices[0].name,

            language:
              voices[0].language,

            gender:
              voices[0].gender,
          }
        );
      }

      return res.json({
        success: true,

        voices,

        count:
          voices.length,

        hasMore:
          pagination.hasMore,

        nextPageToken:
          pagination.nextToken,

        // Compatibility fields
        data: voices,

        raw: {
          has_more:
            pagination.hasMore,

          next_token:
            pagination.nextToken,
        },
      });
    } catch (error) {
      console.error(
        '=========================================='
      );

      console.error(
        '❌ HEYGEN VOICE LIST ERROR'
      );

      console.error(
        'STATUS:',
        error.response?.status
      );

      console.error(
        'RESPONSE:',
        error.response?.data
      );

      console.error(
        'MESSAGE:',
        error.message
      );

      console.error(
        '=========================================='
      );

      return res.status(
        getStatusCode(error)
      ).json({
        success: false,

        message:
          getErrorMessage(error),

        details:
          error.response?.data ||
          null,

        voices: [],
      });
    }
  }
);

// ============================================================
// PRIVATE / CLONED VOICES
// ============================================================

router.get(
  '/heygen/private-voices',
  async (req, res) => {
    try {
      if (!HEYGEN_API_KEY) {
        return res.status(503).json({
          success: false,

          message:
            'HEYGEN_API_KEY is not configured.',
        });
      }

      const params = {
        type: 'private',

        engine:
          req.query.engine ||
          'starfish',

        limit: 100,
      };

      const response =
        await axios.get(
          `${HEYGEN_API_URL}/v3/voices`,
          {
            headers:
              getHeyGenHeaders(),

            params,

            timeout: 30000,
          }
        );

      const rawVoices =
        extractHeyGenVoices(
          response.data
        );

      const voices =
        rawVoices
          .map(normalizeHeyGenVoice)
          .filter(Boolean);

      const pagination =
        extractHeyGenPagination(
          response.data
        );

      return res.json({
        success: true,

        message:
          'Private HeyGen voices retrieved successfully.',

        voices,

        count:
          voices.length,

        hasMore:
          pagination.hasMore,

        nextPageToken:
          pagination.nextToken,
      });
    } catch (error) {
      console.error(
        '❌ Private voice list error:',
        error.response?.data ||
          error.message
      );

      return res.status(
        getStatusCode(error)
      ).json({
        success: false,

        message:
          getErrorMessage(error),

        details:
          error.response?.data ||
          null,

        voices: [],
      });
    }
  }
);

// ============================================================
// VOICE CLONING / PRIVATE VOICE VERIFICATION
// ============================================================

router.post(
  '/heygen/clone-voice',
  async (req, res) => {
    try {
      if (!HEYGEN_API_KEY) {
        return res.status(503).json({
          success: false,

          message:
            'HEYGEN_API_KEY is not configured.',
        });
      }

      const {
        voiceId,
        voice_id,
      } = req.body;

      const finalVoiceId =
        voiceId ||
        voice_id;

      if (!finalVoiceId) {
        return res.status(400).json({
          success: false,

          code:
            'VOICE_ID_REQUIRED',

          message:
            'Provide the voiceId of an existing HeyGen private/cloned voice.',
        });
      }

      console.log(
        '🎙️ Verifying private HeyGen voice:',
        finalVoiceId
      );

      const response =
        await axios.get(
          `${HEYGEN_API_URL}/v3/voices`,
          {
            headers:
              getHeyGenHeaders(),

            params: {
              type: 'private',
              limit: 100,
            },

            timeout: 30000,
          }
        );

      const rawVoices =
        extractHeyGenVoices(
          response.data
        );

      const voices =
        rawVoices
          .map(normalizeHeyGenVoice)
          .filter(Boolean);

      const matchingVoice =
        voices.find(
          voice =>
            voice.voice_id ===
            finalVoiceId
        );

      if (!matchingVoice) {
        return res.status(404).json({
          success: false,

          code:
            'PRIVATE_VOICE_NOT_FOUND',

          message:
            'The supplied voiceId was not found in your HeyGen private voices.',

          voiceId:
            finalVoiceId,
        });
      }

      return res.json({
        success: true,

        message:
          'HeyGen private voice verified successfully.',

        voiceId:
          matchingVoice.voice_id,

        voice:
          matchingVoice,

        status:
          'ready',
      });
    } catch (error) {
      console.error(
        '❌ HEYGEN VOICE VERIFICATION FAILED:',
        error.response?.data ||
          error.message
      );

      return res.status(
        getStatusCode(error)
      ).json({
        success: false,

        message:
          getErrorMessage(error),

        status:
          error.response?.status ||
          null,

        details:
          error.response?.data ||
          null,
      });
    }
  }
);

// ============================================================
// CREATE HEYGEN CHARACTER VIDEO
// ============================================================

router.post('/heygen/create', async (req, res) => {
  try {
    console.log('\n==========================================');
    console.log('🎬 HEYGEN CREATE REQUEST');
    console.log('==========================================');

    const {
      image,
      script,
      voiceId,
      voice_id,
      title,
      aspectRatio,
      aspect_ratio,
      resolution,
      motionPrompt,
      motion_prompt,
    } = req.body || {};

    // --------------------------------------------------
    // Validate required fields
    // --------------------------------------------------

    if (!image) {
      return res.status(400).json({
        success: false,
        message: 'Character image is required.',
      });
    }

    if (!script || !String(script).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Script is required.',
      });
    }

    const finalVoiceId = voiceId || voice_id;

    if (!finalVoiceId) {
      return res.status(400).json({
        success: false,
        message: 'HeyGen voice ID is required.',
      });
    }

    // --------------------------------------------------
    // Normalize values
    // --------------------------------------------------

    const finalTitle =
      title && String(title).trim()
        ? String(title).trim()
        : 'Agriventure Character';

    const finalAspectRatio =
      aspectRatio ||
      aspect_ratio ||
      '9:16';

    const finalResolution =
      resolution || '720p';

    const finalMotionPrompt =
      motionPrompt ||
      motion_prompt ||
      '';

    const finalScript = String(script).trim();

    const finalImage = image;

    // --------------------------------------------------
    // Build HeyGen payload
    // --------------------------------------------------

    const payload = {
      type: 'image',

      title: finalTitle,

      aspect_ratio:
        finalAspectRatio === '16:9'
          ? '16:9'
          : '9:16',

      resolution:
        ['720p', '1080p', '4k'].includes(finalResolution)
          ? finalResolution
          : '720p',

      output_format: 'mp4',

      image: finalImage,

      script: finalScript,

      voice_id: finalVoiceId,
    };

    // Only send motion_prompt when the user actually supplied one.
    if (finalMotionPrompt && String(finalMotionPrompt).trim()) {
      payload.motion_prompt =
        String(finalMotionPrompt).trim();
    }

    // --------------------------------------------------
    // IMPORTANT DEBUG LOG
    // --------------------------------------------------
    //
    // This lets us see exactly what is being sent to
    // HeyGen.
    //
    // DO NOT log the API key.
    //
    // The image may be a large Base64 string, so replace
    // it with a short description in the console.
    // --------------------------------------------------

    const debugPayload = {
      ...payload,
      image: payload.image
        ? `[IMAGE PROVIDED - ${String(payload.image).length} characters]`
        : null,
    };

    console.log('\n==========================================');
    console.log('🎬 HEYGEN FINAL PAYLOAD');
    console.log('==========================================');
    console.log(
      JSON.stringify(debugPayload, null, 2)
    );
    console.log('==========================================\n');

    console.log('🎬 Sending character video request to HeyGen...');
    console.log('Voice ID:', finalVoiceId);
    console.log('Aspect ratio:', payload.aspect_ratio);
    console.log('Resolution:', payload.resolution);
    console.log('Output format:', payload.output_format);
    console.log('Script length:', finalScript.length);
    console.log(
      'Motion prompt:',
      payload.motion_prompt || '(none)'
    );

    // --------------------------------------------------
    // Idempotency key
    // --------------------------------------------------

    const idempotencyKey = crypto.randomUUID();

    console.log(
      'Idempotency-Key:',
      idempotencyKey
    );

    // --------------------------------------------------
    // Send request to HeyGen
    // --------------------------------------------------

    const response = await axios.post(
      `${HEYGEN_API_URL}/v3/videos`,
      payload,
      {
        headers: getHeyGenHeaders({
          'Idempotency-Key': idempotencyKey,
        }),

        timeout: 120000,
      }
    );

    console.log('\n==========================================');
    console.log('✅ HEYGEN CREATE RESPONSE');
    console.log('==========================================');
    console.log(
      JSON.stringify(response.data, null, 2)
    );
    console.log('==========================================\n');

    // --------------------------------------------------
    // Extract video ID
    // --------------------------------------------------

    const data = response.data?.data || response.data || {};

    const videoId =
      data.video_id ||
      data.videoId ||
      response.data?.video_id ||
      response.data?.videoId;

    if (!videoId) {
      console.error(
        '❌ HeyGen did not return a video ID.'
      );

      return res.status(502).json({
        success: false,
        message: 'HeyGen did not return a video ID.',
        data: response.data,
      });
    }

    // --------------------------------------------------
    // Return success
    // --------------------------------------------------

    return res.json({
      success: true,

      message:
        'HeyGen video generation started.',

      videoId,

      status:
        data.status || 'waiting',

      data: response.data,
    });

  } catch (error) {
    console.error('\n==========================================');
    console.error('❌ HEYGEN CREATE ERROR');
    console.error('==========================================');

    // --------------------------------------------------
    // Axios response error
    // --------------------------------------------------

    if (error.response) {
      console.error(
        'HTTP Status:',
        error.response.status
      );

      console.error(
        'HeyGen response:',
        JSON.stringify(
          error.response.data,
          null,
          2
        )
      );

      console.error(
        'Headers:',
        JSON.stringify(
          error.response.headers,
          null,
          2
        )
      );

      console.error('==========================================\n');

      return res.status(
        error.response.status || 500
      ).json({
        success: false,

        message:
          error.response.data?.message ||
          error.response.data?.error?.message ||
          'HeyGen video creation failed.',

        error:
          error.response.data?.error ||
          error.response.data,

        status:
          error.response.status,
      });
    }

    // --------------------------------------------------
    // Timeout
    // --------------------------------------------------

    if (error.code === 'ECONNABORTED') {
      console.error(
        '⏱️ HeyGen request timed out.'
      );

      console.error('==========================================\n');

      return res.status(504).json({
        success: false,
        message:
          'HeyGen request timed out.',
        error: 'HEYGEN_TIMEOUT',
      });
    }

    // --------------------------------------------------
    // Generic error
    // --------------------------------------------------

    console.error(
      'Error:',
      error.message
    );

    console.error(
      'Stack:',
      error.stack
    );

    console.error('==========================================\n');

    return res.status(500).json({
      success: false,

      message:
        error.message ||
        'HeyGen video creation failed.',

      error: 'HEYGEN_CREATE_ERROR',
    });
  }
});

// ============================================================
// HEYGEN CHARACTER VIDEO STATUS
// ============================================================

router.get(
  '/heygen/status/:videoId',
  async (req, res) => {
    try {
      if (!HEYGEN_API_KEY) {
        return res.status(503).json({
          success: false,

          message:
            'HEYGEN_API_KEY is not configured.',
        });
      }

      const {
        videoId,
      } = req.params;

      if (!videoId) {
        return res.status(400).json({
          success: false,

          message:
            'videoId is required.',
        });
      }

      const response =
        await axios.get(
          `${HEYGEN_API_URL}/v3/videos/${encodeURIComponent(
            videoId
          )}`,
          {
            headers:
              getHeyGenHeaders(),

            timeout: 30000,
          }
        );

      const root =
        response.data || {};

      const data =
        root.data ??
        root;

      const status =
        data.status ||
        'unknown';

      const videoUrl =
        data.video_url ||
        data.videoUrl ||
        null;

      const completed =
        status === 'completed' ||
        status === 'complete' ||
        Boolean(videoUrl);

      return res.json({
        success: true,

        videoId,

        status,

        completed,

        videoUrl,

        failureCode:
          data.failure_code ||
          null,

        failureMessage:
          data.failure_message ||
          null,

        data,
      });
    } catch (error) {
      console.error(
        '❌ HeyGen status error:',
        error.response?.data ||
          error.message
      );

      return res.status(
        getStatusCode(error)
      ).json({
        success: false,

        message:
          getErrorMessage(error),

        details:
          error.response?.data ||
          null,
      });
    }
  }
);

// ============================================================
// DOWNLOAD COMPLETED HEYGEN CHARACTER VIDEO
// ============================================================

router.get(
  '/heygen/character/:videoId',
  async (req, res) => {
    try {
      if (!HEYGEN_API_KEY) {
        return res.status(503).json({
          success: false,

          message:
            'HEYGEN_API_KEY is not configured.',
        });
      }

      const {
        videoId,
      } = req.params;

      const response =
        await axios.get(
          `${HEYGEN_API_URL}/v3/videos/${encodeURIComponent(
            videoId
          )}`,
          {
            headers:
              getHeyGenHeaders(),

            timeout: 30000,
          }
        );

      const root =
        response.data || {};

      const data =
        root.data ??
        root;

      const status =
        data.status ||
        'unknown';

      if (
        status === 'failed' ||
        status === 'error'
      ) {
        return res.status(500).json({
          success: false,

          status,

          message:
            data.failure_message ||
            data.error?.message ||
            data.error ||
            'HeyGen video generation failed.',
        });
      }

      const heygenVideoUrl =
        data.video_url ||
        data.videoUrl;

      if (!heygenVideoUrl) {
        return res.json({
          success: true,

          completed: false,

          status,

          message:
            'HeyGen video is not ready yet.',
        });
      }

      const filename =
        makeFilename(
          `character-${videoId}`
        );

      const outputPath =
        path.join(
          TMP_DIR,
          filename
        );

      console.log(
        '⬇️ Downloading completed HeyGen video...'
      );

      const videoResponse =
        await axios.get(
          heygenVideoUrl,
          {
            responseType:
              'arraybuffer',

            timeout: 300000,
          }
        );

      await fs.promises.writeFile(
        outputPath,
        videoResponse.data
      );

      const baseUrl =
        getPublicApiBaseUrl(req);

      return res.json({
        success: true,

        completed: true,

        status,

        videoId,

        filename,

        originalVideoUrl:
          heygenVideoUrl,

        videoUrl:
          `${baseUrl}/files/${encodeURIComponent(
            filename
          )}`,
      });
    } catch (error) {
      console.error(
        '❌ HeyGen character download error:',
        error.response?.data ||
          error.message
      );

      return res.status(
        getStatusCode(error)
      ).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// HEYGEN DIRECT DOWNLOAD
// ============================================================

router.get(
  '/heygen/download/:videoId',
  async (req, res) => {
    try {
      if (!HEYGEN_API_KEY) {
        return res.status(503).json({
          success: false,

          message:
            'HEYGEN_API_KEY is not configured.',
        });
      }

      const {
        videoId,
      } = req.params;

      const response =
        await axios.get(
          `${HEYGEN_API_URL}/v3/videos/${encodeURIComponent(
            videoId
          )}`,
          {
            headers:
              getHeyGenHeaders(),

            timeout: 30000,
          }
        );

      const root =
        response.data || {};

      const data =
        root.data ??
        root;

      const videoUrl =
        data.video_url ||
        data.videoUrl;

      if (!videoUrl) {
        return res.status(404).json({
          success: false,

          message:
            'HeyGen video is not ready.',

          status:
            data.status ||
            'unknown',
        });
      }

      const filename =
        makeFilename(
          `heygen-${videoId}`
        );

      const outputPath =
        path.join(
          TMP_DIR,
          filename
        );

      const videoResponse =
        await axios.get(
          videoUrl,
          {
            responseType:
              'arraybuffer',

            timeout: 300000,
          }
        );

      await fs.promises.writeFile(
        outputPath,
        videoResponse.data
      );

      const baseUrl =
        getPublicApiBaseUrl(req);

      return res.json({
        success: true,

        videoId,

        filename,

        videoUrl:
          `${baseUrl}/files/${encodeURIComponent(
            filename
          )}`,
      });
    } catch (error) {
      console.error(
        '❌ HeyGen download error:',
        error.response?.data ||
          error.message
      );

      return res.status(
        getStatusCode(error)
      ).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// HEYGEN VIDEO HISTORY
// ============================================================

router.get(
  '/heygen/history',
  async (req, res) => {
    try {
      if (!HEYGEN_API_KEY) {
        return res.status(503).json({
          success: false,

          message:
            'HEYGEN_API_KEY is not configured.',
        });
      }

      const limit =
        Math.min(
          100,
          Math.max(
            1,
            Number(
              req.query.limit
            ) || 50
          )
        );

      const params = {
        limit,
      };

      if (req.query.token) {
        params.token =
          req.query.token;
      }

      const response =
        await axios.get(
          `${HEYGEN_API_URL}/v3/videos`,
          {
            headers:
              getHeyGenHeaders(),

            params,

            timeout: 30000,
          }
        );

      const root =
        response.data || {};

      const raw =
        root.data ??
        root;

      const videos =
        Array.isArray(raw)
          ? raw
          : raw.videos || [];

      return res.json({
        success: true,

        videos,

        hasMore:
          Boolean(
            raw.has_more
          ),

        nextPageToken:
          raw.next_token ||
          null,
      });
    } catch (error) {
      console.error(
        '❌ HeyGen history error:',
        error.response?.data ||
          error.message
      );

      return res.status(
        getStatusCode(error)
      ).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// COMPOSE FINAL VIDEO
// ============================================================

router.post(
  '/compose',
  async (req, res) => {
    try {
      const {
        backgroundFilename,
        characterFilename,
        videoId,
        title =
          'Agriventure Video',
      } = req.body;

      if (
        !backgroundFilename ||
        !characterFilename
      ) {
        return res.status(400).json({
          success: false,

          message:
            'backgroundFilename and characterFilename are required.',
        });
      }

      const backgroundPath =
        resolveTmpFile(
          backgroundFilename
        );

      const characterPath =
        resolveTmpFile(
          characterFilename
        );

      if (
        !backgroundPath ||
        !characterPath
      ) {
        return res.status(400).json({
          success: false,

          message:
            'Invalid video filename.',
        });
      }

      if (
        !fs.existsSync(
          backgroundPath
        )
      ) {
        return res.status(404).json({
          success: false,

          message:
            'Background video file not found.',
        });
      }

      if (
        !fs.existsSync(
          characterPath
        )
      ) {
        return res.status(404).json({
          success: false,

          message:
            'Character video file not found.',
        });
      }

      const filename =
        makeFilename(
          'agriventure-final'
        );

      const outputPath =
        path.join(
          TMP_DIR,
          filename
        );

      await compositeVideoOverVideo(
        backgroundPath,
        characterPath,
        outputPath
      );

      const baseUrl =
        getPublicApiBaseUrl(req);

      return res.json({
        success: true,

        message:
          'Final Agriventure video created successfully.',

        title,

        videoId:
          videoId || null,

        filename,

        videoUrl:
          `${baseUrl}/files/${encodeURIComponent(
            filename
          )}`,
      });
    } catch (error) {
      console.error(
        '❌ Video composition error:',
        error
      );

      return res.status(
        getStatusCode(error)
      ).json({
        success: false,

        message:
          getErrorMessage(error),
      });
    }
  }
);

// ============================================================
// SERVE GENERATED VIDEO FILES
// ============================================================

router.get(
  '/files/:filename',
  async (req, res) => {
    try {
      const filePath =
        resolveTmpFile(
          req.params.filename
        );

      if (!filePath) {
        return res.status(400).json({
          success: false,

          message:
            'Invalid filename.',
        });
      }

      if (
        !fs.existsSync(filePath)
      ) {
        return res.status(404).json({
          success: false,

          message:
            'Video file not found.',
        });
      }

      const stat =
        await fs.promises.stat(
          filePath
        );

      const fileSize =
        stat.size;

      const range =
        req.headers.range;

      res.setHeader(
        'Content-Type',
        'video/mp4'
      );

      res.setHeader(
        'Accept-Ranges',
        'bytes'
      );

      res.setHeader(
        'Cache-Control',
        'public, max-age=3600'
      );

      if (!range) {
        res.setHeader(
          'Content-Length',
          fileSize
        );

        return fs
          .createReadStream(
            filePath
          )
          .pipe(res);
      }

      const match =
        /bytes=(\d*)-(\d*)/.exec(
          range
        );

      if (!match) {
        return res
          .status(416)
          .end();
      }

      let start =
        match[1]
          ? parseInt(
              match[1],
              10
            )
          : 0;

      let end =
        match[2]
          ? parseInt(
              match[2],
              10
            )
          : fileSize - 1;

      if (
        start >= fileSize ||
        end >= fileSize ||
        start > end
      ) {
        res.setHeader(
          'Content-Range',
          `bytes */${fileSize}`
        );

        return res
          .status(416)
          .end();
      }

      const chunkSize =
        end - start + 1;

      res.statusCode = 206;

      res.setHeader(
        'Content-Length',
        chunkSize
      );

      res.setHeader(
        'Content-Range',
        `bytes ${start}-${end}/${fileSize}`
      );

      const stream =
        fs.createReadStream(
          filePath,
          {
            start,
            end,
          }
        );

      stream.pipe(res);
    } catch (error) {
      console.error(
        '❌ File serving error:',
        error
      );

      if (!res.headersSent) {
        res.status(500).json({
          success: false,

          message:
            getErrorMessage(error),
        });
      }
    }
  }
);

// ============================================================
// 404 HANDLER
// ============================================================

router.use(
  (req, res) => {
    return res.status(404).json({
      success: false,

      message:
        'Video route not found.',

      path:
        req.originalUrl,

      availableRoutes: [
        'GET /api/video/test',
        'GET /api/video/background/test',
        'POST /api/video/background/photo',
        'POST /api/video/background/generate',
        'GET /api/video/heygen/test',
        'GET /api/video/heygen/voices',
        'GET /api/video/heygen/private-voices',
        'POST /api/video/heygen/clone-voice',
        'POST /api/video/heygen/create',
        'GET /api/video/heygen/status/:videoId',
        'GET /api/video/heygen/character/:videoId',
        'GET /api/video/heygen/download/:videoId',
        'GET /api/video/heygen/history',
        'POST /api/video/compose',
        'GET /api/video/files/:filename',
      ],
    });
  }
);

// ============================================================
// EXPORT
// ============================================================

module.exports = router;
