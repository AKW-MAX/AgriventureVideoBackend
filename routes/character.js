const express = require('express');
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { pathToFileURL } = require('url');
const axios = require('axios');
const cloudinary = require('cloudinary').v2;

const router = express.Router();

/* =========================================================
   BACKGROUND REMOVAL
   ========================================================= */

let removeBackground = null;
let imglyAssetPath = null;

try {
  const backgroundRemoval =
    require('@imgly/background-removal-node');

  removeBackground =
    backgroundRemoval.removeBackground;

  try {
    const imglyMainFile =
      require.resolve(
        '@imgly/background-removal-node'
      );

    const possibleDirectories = [
      path.dirname(imglyMainFile),

      path.dirname(
        path.dirname(imglyMainFile)
      ),

      path.join(
        path.dirname(imglyMainFile),
        'dist'
      ),

      path.join(
        path.dirname(
          path.dirname(imglyMainFile)
        ),
        'dist'
      ),
    ];

    for (
      const directory of possibleDirectories
    ) {
      if (
        fs.existsSync(directory)
      ) {
        const files =
          fs.readdirSync(
            directory
          );

        if (
          files.includes(
            'resources.json'
          )
        ) {
          imglyAssetPath =
            directory;

          break;
        }
      }
    }
  } catch (resolveError) {
    console.warn(
      'Could not automatically locate IMG.LY assets:',
      resolveError.message
    );
  }

  console.log(
    'Background removal loaded successfully.'
  );

  if (imglyAssetPath) {
    console.log(
      'IMG.LY asset directory:',
      imglyAssetPath
    );
  } else {
    console.warn(
      'IMG.LY resources.json was not found locally.'
    );
  }

} catch (error) {
  console.warn(
    'Background removal package could not be loaded:',
    error.message
  );
}

/* =========================================================
   IMG.LY CONFIG
   ========================================================= */

function getBackgroundRemovalConfig() {
  const config = {
    debug: true,

    device: 'cpu',

    model: 'medium',

    output: {
      format: 'image/png',
      quality: 1,
      type: 'foreground',
    },

    progress: (
      key,
      current,
      total
    ) => {
      if (total > 0) {
        const percent =
          Math.round(
            (current / total) * 100
          );

        console.log(
          `IMG.LY: ${key} ${percent}%`
        );
      }
    },
  };

  if (imglyAssetPath) {
    config.publicPath =
      pathToFileURL(
        imglyAssetPath
      ).href;

    if (
      !config.publicPath.endsWith('/')
    ) {
      config.publicPath += '/';
    }

    console.log(
      'IMG.LY publicPath:',
      config.publicPath
    );
  }

  return config;
}

/* =========================================================
   CLOUDINARY
   ========================================================= */

if (
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
) {
  cloudinary.config({
    cloud_name:
      process.env.CLOUDINARY_CLOUD_NAME,

    api_key:
      process.env.CLOUDINARY_API_KEY,

    api_secret:
      process.env.CLOUDINARY_API_SECRET,
  });

  console.log(
    'Cloudinary configured.'
  );
} else {
  console.warn(
    'Cloudinary credentials not found in env. Uploads to Cloudinary will be disabled.'
  );
}

/* =========================================================
   FFMPEG
   ========================================================= */

let ffmpegPath;

try {
  ffmpegPath =
    require('ffmpeg-static');
} catch (error) {
  ffmpegPath = 'ffmpeg';
}

console.log(
  'FFmpeg path:',
  ffmpegPath
);

/* =========================================================
   TEMP DIRECTORY
   ========================================================= */

const TMP_DIR =
  path.join(
    __dirname,
    '..',
    'tmp'
  );

if (
  !fs.existsSync(
    TMP_DIR
  )
) {
  fs.mkdirSync(
    TMP_DIR,
    {
      recursive: true,
    }
  );
}

/* =========================================================
   GEMINI
   ========================================================= */

let ai = null;

if (
  process.env.GEMINI_API_KEY
) {
  ai =
    new GoogleGenAI({
      apiKey:
        process.env.GEMINI_API_KEY,
    });

  console.log(
    'Gemini configured.'
  );
} else {
  console.warn(
    'GEMINI_API_KEY is missing.'
  );
}

/* =========================================================
   GEMINI TEXT MODELS
   ========================================================= */

const GEMINI_TEXT_MODELS = [
  'gemini-3.7-flash',
  'gemini-3.6-flash',
];

/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function sleep(ms) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        ms
      )
  );
}

function cleanBase64(
  value
) {
  if (!value) {
    return '';
  }

  if (
    value.includes(',')
  ) {
    return value.split(',')[1];
  }

  return value;
}

function getImageExtension(
  mimeType
) {
  const mime =
    String(
      mimeType || ''
    ).toLowerCase();

  if (
    mime.includes('png')
  ) {
    return 'png';
  }

  if (
    mime.includes('webp')
  ) {
    return 'webp';
  }

  if (
    mime.includes('gif')
  ) {
    return 'gif';
  }

  if (
    mime.includes('jpeg') ||
    mime.includes('jpg')
  ) {
    return 'jpg';
  }

  return 'jpg';
}

function getErrorMessage(
  error
) {
  if (!error) {
    return 'Unknown error';
  }

  return (
    error?.message ||
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    String(error)
  );
}

function getErrorDetails(
  error
) {
  return {
    message:
      getErrorMessage(
        error
      ),

    responseData:
      error?.response?.data ||
      null,

    cause:
      error?.cause?.message ||
      null,

    status:
      error?.status ||
      error?.response?.status ||
      null,
  };
}

function safeUnlink(
  filePath
) {
  try {
    if (
      filePath &&
      fs.existsSync(
        filePath
      )
    ) {
      fs.unlinkSync(
        filePath
      );
    }
  } catch (error) {
    console.warn(
      'Cleanup failed:',
      error.message
    );
  }
}

/* =========================================================
   GEMINI TEMPORARY ERROR
   ========================================================= */

function isGeminiTemporaryError(
  error
) {
  const message =
    getErrorMessage(
      error
    ).toLowerCase();

  return (
    message.includes('503') ||
    message.includes('unavailable') ||
    message.includes('high demand') ||
    message.includes('resource exhausted') ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('temporarily')
  );
}

/* =========================================================
   GEMINI TEXT FALLBACK
   ========================================================= */

async function generateGeminiContentWithFallback(
  payload
) {
  if (!ai) {
    throw new Error(
      'Gemini is not configured.'
    );
  }

  let lastError =
    null;

  for (
    const model of GEMINI_TEXT_MODELS
  ) {
    console.log('');
    console.log(
      '=========================================='
    );
    console.log(
      `Gemini model: ${model}`
    );
    console.log(
      '=========================================='
    );

    for (
      let attempt = 1;
      attempt <= 3;
      attempt++
    ) {
      try {
        console.log(
          `Gemini ${model} attempt ${attempt}/3`
        );

        const response =
          await ai.models.generateContent({
            ...payload,
            model,
          });

        console.log(
          `Gemini ${model} succeeded.`
        );

        return {
          response,
          model,
        };

      } catch (error) {
        lastError =
          error;

        console.error(
          `Gemini ${model} attempt ${attempt} failed:`
        );

        console.error(
          getErrorDetails(
            error
          )
        );

        if (
          !isGeminiTemporaryError(
            error
          )
        ) {
          throw error;
        }

        if (
          attempt < 3
        ) {
          const delay =
            attempt === 1
              ? 3000
              : attempt === 2
                ? 7000
                : 15000;

          console.log(
            `Waiting ${delay / 1000}s before retry...`
          );

          await sleep(
            delay
          );
        }
      }
    }

    console.warn(
      `${model} failed after all retries.`
    );

    console.log(
      'Trying next Gemini 3.x model...'
    );
  }

  throw (
    lastError ||
    new Error(
      'All Gemini 3.x models failed.'
    )
  );
}

/* =========================================================
   EXTRACT GEMINI IMAGE
   ========================================================= */

function extractGeminiImage(
  response
) {
  if (!response) {
    return null;
  }

  if (
    response.output_image &&
    response.output_image.data
  ) {
    return {
      data:
        response.output_image.data,

      mimeType:
        response.output_image.mime_type ||
        'image/png',
    };
  }

  if (
    Array.isArray(
      response.steps
    )
  ) {
    for (
      const step of response.steps
    ) {
      if (
        step?.type ===
          'model_output' &&
        Array.isArray(
          step.content
        )
      ) {
        for (
          const contentBlock of
            step.content
        ) {
          if (
            contentBlock?.type ===
              'image' &&
            contentBlock?.data
          ) {
            return {
              data:
                contentBlock.data,

              mimeType:
                contentBlock.mime_type ||
                'image/png',
            };
          }
        }
      }
    }
  }

  if (
    Array.isArray(
      response.candidates
    )
  ) {
    for (
      const candidate of
        response.candidates
    ) {
      const parts =
        candidate?.content?.parts;

      if (
        !Array.isArray(parts)
      ) {
        continue;
      }

      for (
        const part of parts
      ) {
        if (
          part?.inlineData?.data
        ) {
          return {
            data:
              part.inlineData.data,

            mimeType:
              part.inlineData.mimeType ||
              'image/png',
          };
        }

        if (
          part?.inline_data?.data
        ) {
          return {
            data:
              part.inline_data.data,

            mimeType:
              part.inline_data
                .mime_type ||
              'image/png',
          };
        }
      }
    }
  }

  return null;
}

/* =========================================================
   CREATE STATIC VIDEO FROM FARM PHOTO
   ========================================================= */

/*
 * IMPORTANT:
 *
 * This function DOES NOT call Gemini.
 *
 * It takes the real farm photograph and creates
 * an MP4 using FFmpeg.
 *
 * This is the:
 *
 * "📷 Use Photo As-Is"
 *
 * option.
 */

async function createStaticBackgroundVideo(
  backgroundImageBase64,
  mimeType,
  outputPath,
  durationSeconds = 8
) {
  if (
    !backgroundImageBase64
  ) {
    throw new Error(
      'backgroundImageBase64 is required.'
    );
  }

  const imageData =
    cleanBase64(
      backgroundImageBase64
    );

  if (!imageData) {
    throw new Error(
      'The supplied farm image is empty.'
    );
  }

  const imageExtension =
    getImageExtension(
      mimeType
    );

  const inputPath =
    path.join(
      TMP_DIR,
      `farm-photo-${Date.now()}.${imageExtension}`
    );

  try {
    const imageBuffer =
      Buffer.from(
        imageData,
        'base64'
      );

    if (
      !imageBuffer.length
    ) {
      throw new Error(
        'The supplied farm image could not be decoded.'
      );
    }

    fs.writeFileSync(
      inputPath,
      imageBuffer
    );

    const safeDuration =
      Math.max(
        1,
        Math.min(
          60,
          Number(
            durationSeconds
          ) || 8
        )
      );

    console.log('');
    console.log(
      '=========================================='
    );
    console.log(
      '📷 STATIC FARM PHOTO VIDEO'
    );
    console.log(
      '=========================================='
    );
    console.log(
      `Input: ${inputPath}`
    );
    console.log(
      `Output: ${outputPath}`
    );
    console.log(
      `Duration: ${safeDuration}s`
    );
    console.log(
      'Gemini: NOT USED'
    );
    console.log(
      '=========================================='
    );

    const args = [
      '-y',

      '-loop',
      '1',

      '-i',
      inputPath,

      '-vf',

      [
        'scale=1080:1920:force_original_aspect_ratio=increase',
        'crop=1080:1920',
        'setsar=1',
        'fps=30',
      ].join(','),

      '-t',
      String(
        safeDuration
      ),

      '-an',

      '-c:v',
      'libx264',

      '-preset',
      'medium',

      '-crf',
      '23',

      '-pix_fmt',
      'yuv420p',

      '-movflags',
      '+faststart',

      outputPath,
    ];

    console.log(
      'Running FFmpeg for static farm photo...'
    );

    await new Promise(
      (
        resolve,
        reject
      ) => {
        execFile(
          ffmpegPath,
          args,
          {
            maxBuffer:
              1024 *
              1024 *
              20,
          },

          (
            error,
            stdout,
            stderr
          ) => {
            if (error) {
              console.error(
                'FFmpeg static photo error:',
                error
              );

              console.error(
                'FFmpeg stderr:',
                stderr
              );

              reject(
                new Error(
                  `FFmpeg failed to create farm background video: ${error.message}\n${stderr}`
                )
              );

              return;
            }

            resolve();
          }
        );
      }
    );

    if (
      !fs.existsSync(
        outputPath
      )
    ) {
      throw new Error(
        'FFmpeg completed but the farm background video was not created.'
      );
    }

    const stats =
      fs.statSync(
        outputPath
      );

    if (
      stats.size === 0
    ) {
      throw new Error(
        'The generated farm background video is empty.'
      );
    }

    console.log(
      `Static farm video created successfully: ${stats.size} bytes`
    );

    return outputPath;

  } finally {
    safeUnlink(
      inputPath
    );
  }
}

/* =========================================================
   FARM BACKGROUND - USE PHOTO AS-IS
   ========================================================= */

/*
 * POST:
 *
 * /api/video/background/photo
 *
 * This endpoint NEVER calls Gemini.
 */

router.post(
  '/background/photo',
  async (
    req,
    res
  ) => {
    let outputPath =
      null;

    try {
      const {
        backgroundImageBase64,
        mimeType,
        duration,
      } = req.body;

      console.log('');
      console.log(
        '=========================================='
      );
      console.log(
        '📷 FARM BACKGROUND: PHOTO AS-IS'
      );
      console.log(
        '=========================================='
      );
      console.log(
        'Gemini will NOT be used.'
      );

      if (
        !backgroundImageBase64
      ) {
        return res.status(400).json({
          success: false,

          message:
            'backgroundImageBase64 is required.',

          backgroundMode:
            'photo',

          geminiUsed:
            false,
        });
      }

      const durationSeconds =
        Math.max(
          1,
          Math.min(
            60,
            Number(
              duration
            ) || 8
          )
        );

      const timestamp =
        Date.now();

      const filename =
        `farm-background-${timestamp}.mp4`;

      outputPath =
        path.join(
          TMP_DIR,
          filename
        );

      await createStaticBackgroundVideo(
        backgroundImageBase64,
        mimeType ||
          'image/jpeg',
        outputPath,
        durationSeconds
      );

      /*
       * PUBLIC_API_URL should be:
       *
       * http://10.159.131.218:5001
       *
       * NOT:
       *
       * http://10.159.131.218:5001/api/video
       */

      const configuredBaseUrl =
        process.env.PUBLIC_API_URL
          ? process.env.PUBLIC_API_URL.replace(
              /\/$/,
              ''
            )
          : `${req.protocol}://${req.get('host')}`;

      const baseUrl =
        configuredBaseUrl.replace(
          /\/api\/video$/,
          ''
        );

      const videoUrl =
        `${baseUrl}/api/video/files/${filename}`;

      console.log('');
      console.log(
        '📷 Farm photo prepared successfully.'
      );
      console.log(
        `Filename: ${filename}`
      );
      console.log(
        `Video URL: ${videoUrl}`
      );
      console.log(
        'Gemini used: false'
      );
      console.log('');

      return res.json({
        success: true,

        message:
          'Farm photo prepared successfully without using Gemini.',

        filename,

        videoUrl,

        backgroundMode:
          'photo',

        geminiUsed:
          false,

        duration:
          durationSeconds,
      });

    } catch (error) {
      console.error('');
      console.error(
        '❌ STATIC FARM PHOTO ERROR'
      );
      console.error(
        '=========================================='
      );
      console.error(
        getErrorDetails(
          error
        )
      );

      safeUnlink(
        outputPath
      );

      return res.status(500).json({
        success: false,

        message:
          'Failed to prepare farm photo.',

        error:
          getErrorDetails(
            error
          ),

        backgroundMode:
          'photo',

        geminiUsed:
          false,
      });
    }
  }
);

/* =========================================================
   SERVE GENERATED VIDEO FILES
   ========================================================= */

/*
 * GET:
 *
 * /api/video/files/:filename
 */

router.get(
  '/files/:filename',
  (req, res) => {
    try {
      const filename =
        path.basename(
          req.params.filename
        );

      const filePath =
        path.join(
          TMP_DIR,
          filename
        );

      console.log(
        `Serving video file: ${filePath}`
      );

      if (
        !fs.existsSync(
          filePath
        )
      ) {
        return res.status(404).json({
          success: false,

          message:
            'Video file not found.',
        });
      }

      const stats =
        fs.statSync(
          filePath
        );

      if (
        stats.size === 0
      ) {
        return res.status(500).json({
          success: false,

          message:
            'Video file is empty.',
        });
      }

      res.setHeader(
        'Content-Type',
        'video/mp4'
      );

      res.setHeader(
        'Content-Length',
        stats.size
      );

      res.setHeader(
        'Accept-Ranges',
        'bytes'
      );

      return res.sendFile(
        filePath
      );

    } catch (error) {
      console.error(
        'Video file serving error:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          'Failed to serve video file.',

        error:
          error.message,
      });
    }
  }
);

/* =========================================================
   HEALTH TEST
   ========================================================= */

router.get(
  '/test',
  (req, res) => {
    res.json({
      success: true,

      message:
        'Video API is working.',

      backgroundRemoval:
        !!removeBackground,

      imglyAssets:
        !!imglyAssetPath,

      imglyAssetPath:
        imglyAssetPath || null,

      geminiConfigured:
        !!ai,

      geminiTextModels:
        GEMINI_TEXT_MODELS,

      ffmpegConfigured:
        !!ffmpegPath,
    });
  }
);

/* =========================================================
   GEMINI CONNECTION TEST
   ========================================================= */

router.get(
  '/gemini-test',
  async (
    req,
    res
  ) => {
    try {
      if (
        !process.env.GEMINI_API_KEY
      ) {
        return res.status(500).json({
          success: false,

          message:
            'GEMINI_API_KEY is missing from the backend .env file.',
        });
      }

      if (!ai) {
        return res.status(500).json({
          success: false,

          message:
            'Gemini client was not initialized.',
        });
      }

      const result =
        await generateGeminiContentWithFallback(
          {
            contents:
              'Reply with exactly: GEMINI_OK',
          }
        );

      const text =
        result?.response?.text ||
        '';

      return res.json({
        success: true,

        model:
          result.model,

        text,

        message:
          'Gemini connection is working.',
      });

    } catch (error) {
      console.error(
        'Gemini test error:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          'Gemini connection failed.',

        error:
          getErrorDetails(
            error
          ),
      });
    }
  }
);

/* =========================================================
   REMOVE CHARACTER BACKGROUND
   ========================================================= */

router.post(
  '/remove-background',
  async (
    req,
    res
  ) => {
    let inputPath =
      null;

    try {
      if (!removeBackground) {
        return res.status(500).json({
          success: false,

          message:
            'Background removal is not available on this server.',
        });
      }

      const {
        imageBase64,
        mimeType,
        characterName,
      } = req.body;

      if (!imageBase64) {
        return res.status(400).json({
          success: false,

          message:
            'imageBase64 is required.',
        });
      }

      console.log('');
      console.log(
        '=========================================='
      );
      console.log(
        'BACKGROUND REMOVAL'
      );
      console.log(
        `Character: ${
          characterName ||
          'Unknown'
        }`
      );
      console.log(
        '=========================================='
      );

      const imageData =
        cleanBase64(
          imageBase64
        );

      const buffer =
        Buffer.from(
          imageData,
          'base64'
        );

      if (
        !buffer.length
      ) {
        return res.status(400).json({
          success: false,

          message:
            'The supplied imageBase64 is empty or invalid.',
        });
      }

      const inputExtension =
        getImageExtension(
          mimeType
        );

      inputPath =
        path.join(
          TMP_DIR,
          `character-input-${Date.now()}.${inputExtension}`
        );

      fs.writeFileSync(
        inputPath,
        buffer
      );

      console.log(
        `Input image: ${inputPath}`
      );

      console.log(
        `Input size: ${buffer.length} bytes`
      );

      const config =
        getBackgroundRemovalConfig();

      console.log(
        'Starting IMG.LY background removal...'
      );

      const resultBlob =
        await removeBackground(
          new Blob(
            [buffer],
            {
              type:
                mimeType ||
                'image/jpeg',
            }
          ),
          config
        );

      const resultArrayBuffer =
        await resultBlob.arrayBuffer();

      const resultBuffer =
        Buffer.from(
          resultArrayBuffer
        );

      console.log(
        `Background removal produced ${resultBuffer.length} bytes.`
      );

      /* CLOUDINARY */

      if (
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
      ) {
        console.log(
          'Uploading transparent character to Cloudinary...'
        );

        try {
          const uploadResult =
            await new Promise(
              (
                resolve,
                reject
              ) => {
                const uploadStream =
                  cloudinary.uploader.upload_stream(
                    {
                      folder:
                        'agriventure/characters',

                      resource_type:
                        'image',

                      format:
                        'png',
                    },

                    (
                      error,
                      result
                    ) => {
                      if (error) {
                        reject(
                          error
                        );
                      } else {
                        resolve(
                          result
                        );
                      }
                    }
                  );

                uploadStream.end(
                  resultBuffer
                );
              }
            );

          safeUnlink(
            inputPath
          );

          inputPath =
            null;

          console.log(
            'Transparent character uploaded successfully.'
          );

          return res.json({
            success: true,

            message:
              'Background removed successfully.',

            url:
              uploadResult.secure_url,

            publicId:
              uploadResult.public_id,

            mimeType:
              'image/png',

            transparent:
              true,
          });

        } catch (uploadError) {
          console.warn(
            'Cloudinary upload failed; returning processed image as base64.'
          );

          console.warn(
            getErrorDetails(
              uploadError
            )
          );
        }
      }

      const base64Output =
        resultBuffer.toString(
          'base64'
        );

      safeUnlink(
        inputPath
      );

      inputPath =
        null;

      return res.json({
        success: true,

        message:
          'Background removed successfully.',

        url:
          `data:image/png;base64,${base64Output}`,

        mimeType:
          'image/png',

        transparent:
          true,
      });

    } catch (error) {
      console.error('');
      console.error(
        'BACKGROUND REMOVAL ERROR'
      );
      console.error(
        '=========================================='
      );
      console.error(
        getErrorDetails(
          error
        )
      );

      console.error(
        error
      );

      safeUnlink(
        inputPath
      );

      return res.status(500).json({
        success: false,

        message:
          'Failed to remove character background.',

        error:
          getErrorDetails(
            error
          ),
      });
    }
  }
);

/* =========================================================
   GEMINI CHARACTER IMAGE GENERATION
   ========================================================= */

router.post(
  '/animate',
  async (
    req,
    res
  ) => {
    try {
      if (!ai) {
        return res.status(500).json({
          success: false,

          message:
            'Gemini is not configured. Check GEMINI_API_KEY.',
        });
      }

      const {
        imageBase64,
        mimeType,
        characterName,
        prompt,
      } = req.body;

      if (!imageBase64) {
        return res.status(400).json({
          success: false,

          message:
            'imageBase64 is required.',
        });
      }

      const imageData =
        cleanBase64(
          imageBase64
        );

      const inputMimeType =
        mimeType ||
        'image/jpeg';

      console.log('');
      console.log(
        '=========================================='
      );
      console.log(
        'GEMINI CHARACTER ANIMATION'
      );
      console.log(
        `Character: ${
          characterName ||
          'Unknown'
        }`
      );
      console.log(
        '=========================================='
      );

      const animationPrompt =
        prompt ||
        `
Transform the provided real photograph into a
high-quality 3D animated character for an educational
farming video.

CHARACTER:

${characterName || 'Unknown'}

IDENTITY PRESERVATION:

- Keep the same person or animal.
- Preserve recognizable facial characteristics.
- Preserve the same clothing.
- Preserve the main clothing colors.
- Preserve the approximate age.
- Preserve the body proportions.
- Preserve the general pose.
- Preserve the character's overall identity.
- Do not replace the character with another person.
- Do not add another person.
- Do not add text.
- Do not add logos.
- Do not add watermarks.

ANIMATION STYLE:

- Friendly 3D animated character.
- Professional educational animation.
- Clean polished 3D rendering.
- Natural facial expression.
- Slightly stylized but recognizable.
- Smooth character design.
- Natural hands and fingers.
- Natural body proportions.
- Attractive farming education style.
- Suitable for TikTok and Facebook educational videos.

COMPOSITION:

- Keep the entire character visible if possible.
- Keep the character centered.
- Use a clean simple background.
- Make the character suitable for later background removal.
- Keep enough space around the body.
- Do not crop the head, hands or feet unnecessarily.

IMPORTANT:

This is an IMAGE transformation.

Do NOT create a video.

Create ONE finished animated character image.
`;

      const input = [
        {
          type:
            'text',

          text:
            animationPrompt,
        },

        {
          type:
            'image',

          mime_type:
            inputMimeType,

          data:
            imageData,
        },
      ];

      console.log(
        'Calling Gemini image model...'
      );

      const interaction =
        await ai.interactions.create({
          model:
            'gemini-3.1-flash-image',

          input,

          response_format: {
            type:
              'image',

            image_size:
              '1K',
          },
        });

      console.log(
        'Gemini image response received.'
      );

      const generatedImage =
        extractGeminiImage(
          interaction
        );

      if (
        !generatedImage ||
        !generatedImage.data
      ) {
        console.error(
          'Gemini did not return an image.'
        );

        console.error(
          JSON.stringify(
            interaction,
            null,
            2
          )
        );

        return res.status(500).json({
          success: false,

          message:
            'Gemini completed the request but did not return an image.',

          model:
            'gemini-3.1-flash-image',
        });
      }

      let finalBuffer =
        Buffer.from(
          generatedImage.data,
          'base64'
        );

      let finalMimeType =
        generatedImage.mimeType ||
        'image/png';

      let transparent =
        false;

      console.log(
        `Generated image size: ${finalBuffer.length} bytes`
      );

      /* REMOVE GENERATED BACKGROUND */

      if (
        removeBackground
      ) {
        try {
          console.log(
            'Removing generated character background...'
          );

          const generatedInputPath =
            path.join(
              TMP_DIR,
              `gemini-character-${Date.now()}.png`
            );

          fs.writeFileSync(
            generatedInputPath,
            finalBuffer
          );

          const config =
            getBackgroundRemovalConfig();

          const transparentBlob =
            await removeBackground(
              new Blob(
                [finalBuffer],
                {
                  type:
                    'image/png',
                }
              ),
              config
            );

          const transparentArrayBuffer =
            await transparentBlob.arrayBuffer();

          finalBuffer =
            Buffer.from(
              transparentArrayBuffer
            );

          finalMimeType =
            'image/png';

          transparent =
            true;

          safeUnlink(
            generatedInputPath
          );

          console.log(
            'Generated character background removed successfully.'
          );

        } catch (
          backgroundError
        ) {
          console.warn(
            'Generated image background removal failed.'
          );

          console.warn(
            getErrorDetails(
              backgroundError
            )
          );
        }
      }

      /* CLOUDINARY */

      if (
        process.env.CLOUDINARY_CLOUD_NAME &&
        process.env.CLOUDINARY_API_KEY &&
        process.env.CLOUDINARY_API_SECRET
      ) {
        console.log(
          'Uploading animated character to Cloudinary...'
        );

        const uploadResult =
          await new Promise(
            (
              resolve,
              reject
            ) => {
              const uploadStream =
                cloudinary.uploader.upload_stream(
                  {
                    folder:
                      'agriventure/characters/animated',

                    resource_type:
                      'image',

                    format:
                      'png',

                    transformation: [
                      {
                        quality:
                          'auto',
                      },
                    ],
                  },

                  (
                    error,
                    result
                  ) => {
                    if (error) {
                      reject(
                        error
                      );
                    } else {
                      resolve(
                        result
                      );
                    }
                  }
                );

              uploadStream.end(
                finalBuffer
              );
            }
          );

        return res.json({
          success: true,

          message:
            'Character animated successfully.',

          characterName,

          url:
            uploadResult.secure_url,

          publicId:
            uploadResult.public_id,

          mimeType:
            'image/png',

          transparent,

          model:
            'gemini-3.1-flash-image',
        });
      }

      /* BASE64 */

      const outputBase64 =
        finalBuffer.toString(
          'base64'
        );

      return res.json({
        success: true,

        message:
          'Character animated successfully.',

        characterName,

        url:
          `data:image/png;base64,${outputBase64}`,

        publicId:
          null,

        mimeType:
          'image/png',

        transparent,

        model:
          'gemini-3.1-flash-image',
      });

    } catch (error) {
      console.error(
        'GEMINI CHARACTER ANIMATION ERROR'
      );

      console.error(
        getErrorDetails(
          error
        )
      );

      return res.status(500).json({
        success: false,

        message:
          'Failed to animate character with Gemini.',

        error:
          getErrorDetails(
            error
          ),
      });
    }
  }
);

/* =========================================================
   CHARACTER ANALYSIS
   ========================================================= */

router.post(
  '/animate/analyze',
  async (
    req,
    res
  ) => {
    try {
      if (!ai) {
        return res.status(500).json({
          success: false,

          message:
            'Gemini is not configured. Check GEMINI_API_KEY.',
        });
      }

      const {
        imageBase64,
        mimeType,
        characterName,
      } = req.body;

      if (!imageBase64) {
        return res.status(400).json({
          success: false,

          message:
            'imageBase64 is required.',
        });
      }

      const imageData =
        cleanBase64(
          imageBase64
        );

      console.log(
        `Analyzing character with Gemini: ${
          characterName ||
          'Unknown'
        }`
      );

      const result =
        await generateGeminiContentWithFallback(
          {
            contents: [
              {
                role:
                  'user',

                parts: [
                  {
                    inlineData: {
                      mimeType:
                        mimeType ||
                        'image/jpeg',

                      data:
                        imageData,
                    },
                  },

                  {
                    text: `
Analyze this character image for a farming educational video.

Character name:
${
  characterName ||
  'Unknown'
}

Describe:

1. The character's appearance.
2. Clothing.
3. Approximate age group.
4. Pose.
5. Facial expression.
6. Possible role on a farm.
7. How the character could move naturally while explaining something.
8. Suitable subtle body movements.
9. Suitable hand gestures.
10. Suitable head movements.

Do NOT create a video.

Return a clear useful description for a future animation system.
`,
                  },
                ],
              },
            ],
          }
        );

      const description =
        result?.response?.text ||
        '';

      return res.json({
        success: true,

        characterName,

        description,

        model:
          result.model,
      });

    } catch (error) {
      console.error(
        'Character analysis error:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          'Gemini character analysis failed.',

        error:
          getErrorDetails(
            error
          ),
      });
    }
  }
);

/* =========================================================
   CHARACTER VALIDATION
   ========================================================= */

router.post(
  '/animate/validate',
  async (req, res) => {
    try {
      if (!ai) {
        return res.status(500).json({
          success: false,
          message:
            'Gemini is not configured. Check GEMINI_API_KEY.',
        });
      }

      const {
        imageBase64,
        mimeType,
        characterName,
      } = req.body;

      if (!imageBase64) {
        return res.status(400).json({
          success: false,
          message: 'imageBase64 is required.',
        });
      }

      const imageData = cleanBase64(imageBase64);

      const result =
        await generateGeminiContentWithFallback({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType:
                      mimeType || 'image/jpeg',
                    data: imageData,
                  },
                },
                {
                  text: `
Check whether this image is suitable for use as an
animated farming character.

Character:
${characterName || 'Unknown'}

Check:

- Is a person/animal visible?
- Is the subject reasonably clear?
- Is the body sufficiently visible?
- Is the pose usable for animation?
- Is the image likely to work after background removal?

Return JSON only:

{
  "valid": true,
  "subject": "person",
  "quality": "good",
  "reason": "short explanation"
}
`,
                },
              ],
            },
          ],
        });

      const text =
        result?.response?.text || '';

      return res.json({
        success: true,
        result: text,
        model: result.model,
      });
    } catch (error) {
      console.error(
        'Character validation error:',
        error
      );

      return res.status(500).json({
        success: false,
        message: 'Character validation failed.',
        error: getErrorDetails(error),
      });
    }
  }
);


/* =========================================================
   GENERATE ANIMATION SCRIPT
   ========================================================= */

router.post(
  '/animate/generate',
  async (req, res) => {
    try {
      if (!ai) {
        return res.status(500).json({
          success: false,
          message:
            'Gemini is not configured. Check GEMINI_API_KEY.',
        });
      }

      const {
        imageBase64,
        mimeType,
        characterName,
        durationSeconds,
      } = req.body;

      if (!imageBase64) {
        return res.status(400).json({
          success: false,
          message: 'imageBase64 is required.',
        });
      }

      const duration =
        Number(durationSeconds) || 5;

      const imageData =
        cleanBase64(imageBase64);

      console.log('');
      console.log(
        '=========================================='
      );
      console.log(
        'GENERATING ANIMATION SCRIPT'
      );
      console.log(
        `Character: ${
          characterName || 'Unknown'
        }`
      );
      console.log(
        `Duration: ${duration}s`
      );
      console.log(
        '=========================================='
      );

      const result =
        await generateGeminiContentWithFallback({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  inlineData: {
                    mimeType:
                      mimeType || 'image/jpeg',
                    data: imageData,
                  },
                },
                {
                  text: `
Create an animation plan for this farming character.

Character:
${characterName || 'Unknown'}

Duration:
${duration} seconds

The character should look natural and suitable for a
short educational farming video.

Use:

- subtle body movement
- natural head movement
- slight position changes
- gentle scale changes
- natural pauses
- occasional hand/arm gestures

Return ONLY valid JSON in this structure:

{
  "duration": ${duration},
  "keyframes": [
    {
      "time": 0,
      "x": 0.5,
      "y": 0.5,
      "scale": 1,
      "action": "standing"
    },
    {
      "time": 1,
      "x": 0.5,
      "y": 0.5,
      "scale": 1.02,
      "action": "gesture"
    }
  ]
}

Requirements:

- Coordinates must be between 0 and 1.
- Scale should normally be between 0.8 and 1.3.
- The first keyframe time must be 0.
- The final keyframe time must be ${duration}.
- Include enough keyframes to make movement feel natural.
- Do not move the character suddenly.
- Avoid extreme movements.
- Keep the character visible.
- Do not create a video.
- Do not include Markdown.
- Return JSON only.
`,
                },
              ],
            },
          ],
        });

      let text =
        result?.response?.text || '';

      text = text
        .replace(/^```json/i, '')
        .replace(/^```/i, '')
        .replace(/```$/i, '')
        .trim();

      let script;

      try {
        script = JSON.parse(text);
      } catch (parseError) {
        console.error(
          'Could not parse Gemini animation script:'
        );
        console.error(text);

        return res.status(500).json({
          success: false,
          message:
            'Gemini returned an invalid animation script.',
          rawResponse: text,
          model: result.model,
        });
      }

      if (
        !script ||
        !Array.isArray(script.keyframes) ||
        script.keyframes.length === 0
      ) {
        return res.status(500).json({
          success: false,
          message:
            'Gemini returned an animation script without valid keyframes.',
          model: result.model,
        });
      }

      return res.json({
        success: true,
        characterName,
        script,
        model: result.model,
      });
    } catch (error) {
      console.error(
        'Animation script error:',
        error
      );

      return res.status(500).json({
        success: false,
        message:
          'Failed to generate animation script.',
        error: getErrorDetails(error),
      });
    }
  }
);


/* =========================================================
   PIECEWISE FFMPEG EXPRESSION
   ========================================================= */

function buildPiecewiseExpr(
  keyframes,
  property,
  totalDuration,
  multiplier
) {
  if (
    !Array.isArray(keyframes) ||
    keyframes.length === 0
  ) {
    return '0';
  }

  const sorted = [...keyframes].sort(
    (a, b) =>
      Number(a.time) -
      Number(b.time)
  );

  const expressions = [];

  for (
    let i = 0;
    i < sorted.length - 1;
    i++
  ) {
    const current = sorted[i];
    const next = sorted[i + 1];

    const t1 = Math.max(
      0,
      Math.min(
        totalDuration,
        Number(current.time)
      )
    );

    const t2 = Math.max(
      0,
      Math.min(
        totalDuration,
        Number(next.time)
      )
    );

    const v1 =
      Number(current[property]) *
      multiplier;

    const v2 =
      Number(next[property]) *
      multiplier;

    if (
      !Number.isFinite(v1) ||
      !Number.isFinite(v2) ||
      t2 <= t1
    ) {
      continue;
    }

    const segmentDuration =
      Math.max(
        0.001,
        t2 - t1
      );

    const slope =
      (v2 - v1) /
      segmentDuration;

    expressions.push(
      `if(between(t,${t1},${t2}),` +
      `${v1}+(${slope})*(t-${t1})`
    );
  }

  const last =
    sorted[sorted.length - 1];

  let lastValue =
    Number(last[property]);

  if (
    !Number.isFinite(lastValue)
  ) {
    lastValue =
      property === 'scale'
        ? 1
        : 0.5;
  }

  lastValue *= multiplier;

  let expression =
    `${lastValue}`;

  for (
    let i =
      expressions.length - 1;
    i >= 0;
    i--
  ) {
    expression =
      expressions[i] +
      `,${expression})`;
  }

  return expression;
}


/* =========================================================
   DOWNLOAD FILE
   ========================================================= */

async function downloadFile(
  url,
  outputPath
) {
  if (!url) {
    throw new Error(
      'Download URL is missing.'
    );
  }

  console.log(
    `Downloading: ${url}`
  );

  const response =
    await axios.get(
      url,
      {
        responseType:
          'arraybuffer',
        timeout:
          120000,
      }
    );

  fs.writeFileSync(
    outputPath,
    response.data
  );

  return outputPath;
}


/* =========================================================
   RENDER / COMPOSITE CHARACTER
   ========================================================= */

router.post(
  '/animate/render',
  async (req, res) => {
    let backgroundPath = null;
    let backgroundImagePath = null;
    let characterPath = null;
    let outputPath = null;

    try {
      const {
        backgroundVideoBase64,
        backgroundVideoUrl,
        backgroundImageBase64,
        backgroundImageUrl,
        characterImageBase64,
        characterImageUrl,
        animationScript,
        durationSeconds,
        characterName,
      } = req.body;

      /* =====================================================
         VALIDATE BACKGROUND
         ===================================================== */

      if (
        !backgroundVideoBase64 &&
        !backgroundVideoUrl &&
        !backgroundImageBase64 &&
        !backgroundImageUrl
      ) {
        return res.status(400).json({
          success: false,
          message:
            'A background video or background image is required.',
        });
      }

      /* =====================================================
         VALIDATE CHARACTER
         ===================================================== */

      if (
        !characterImageBase64 &&
        !characterImageUrl
      ) {
        return res.status(400).json({
          success: false,
          message:
            'characterImageBase64 or characterImageUrl is required.',
        });
      }

      const timestamp =
        Date.now();

      const duration =
        Number(durationSeconds) || 5;

      /* =====================================================
         BACKGROUND
         ===================================================== */

      backgroundPath =
        path.join(
          TMP_DIR,
          `background-${timestamp}.mp4`
        );

      if (backgroundVideoBase64) {
        const videoData =
          cleanBase64(
            backgroundVideoBase64
          );

        fs.writeFileSync(
          backgroundPath,
          Buffer.from(
            videoData,
            'base64'
          )
        );
      } else if (backgroundVideoUrl) {
        await downloadFile(
          backgroundVideoUrl,
          backgroundPath
        );
      } else {
        backgroundImagePath =
          path.join(
            TMP_DIR,
            `background-image-${timestamp}.jpg`
          );

        if (backgroundImageBase64) {
          fs.writeFileSync(
            backgroundImagePath,
            Buffer.from(
              cleanBase64(
                backgroundImageBase64
              ),
              'base64'
            )
          );
        } else {
          await downloadFile(
            backgroundImageUrl,
            backgroundImagePath
          );
        }
      }

      /* =====================================================
         CHARACTER
         ===================================================== */

      characterPath =
        path.join(
          TMP_DIR,
          `character-${timestamp}.png`
        );

      if (characterImageBase64) {
        const characterData =
          cleanBase64(
            characterImageBase64
          );

        fs.writeFileSync(
          characterPath,
          Buffer.from(
            characterData,
            'base64'
          )
        );
      } else {
        await downloadFile(
          characterImageUrl,
          characterPath
        );
      }

      /* =====================================================
         ANIMATION SCRIPT
         ===================================================== */

      let script =
        animationScript;

      if (
        typeof script === 'string'
      ) {
        try {
          script =
            JSON.parse(script);
        } catch {
          script = null;
        }
      }

      if (
        !script ||
        !Array.isArray(
          script.keyframes
        )
      ) {
        console.log(
          'No valid animation script supplied. Using default animation.'
        );

        script = {
          duration,
          keyframes: [
            {
              time: 0,
              x: 0.5,
              y: 0.5,
              scale: 1,
              action:
                'standing',
            },
            {
              time:
                duration * 0.5,
              x: 0.505,
              y: 0.495,
              scale: 1.02,
              action:
                'gesture',
            },
            {
              time: duration,
              x: 0.5,
              y: 0.5,
              scale: 1,
              action:
                'standing',
            },
          ],
        };
      }

      const keyframes =
        script.keyframes;

      const xExpr =
        buildPiecewiseExpr(
          keyframes,
          'x',
          duration,
          1
        );

      const yExpr =
        buildPiecewiseExpr(
          keyframes,
          'y',
          duration,
          1
        );

      const scaleExpr =
        buildPiecewiseExpr(
          keyframes,
          'scale',
          duration,
          1
        );

      console.log(
        'X expression:',
        xExpr
      );

      console.log(
        'Y expression:',
        yExpr
      );

      console.log(
        'Scale expression:',
        scaleExpr
      );

      /* =====================================================
         OUTPUT
         ===================================================== */

      outputPath =
        path.join(
          TMP_DIR,
          `character-video-${timestamp}.mp4`
        );

      const backgroundFilter =
        backgroundImagePath
          ? `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
            `crop=1080:1920,` +
            `zoompan=z='min(zoom+0.0007,1.08)':` +
            `x='iw/2-(iw/zoom/2)':` +
            `y='ih/2-(ih/zoom/2)':` +
            `d=1:s=1080x1920:fps=30,` +
            `trim=duration=${duration},` +
            `setpts=PTS-STARTPTS[bg];`
          : `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,` +
            `crop=1080:1920,` +
            `setpts=PTS-STARTPTS[bg];`;

      const filterComplex =
        backgroundFilter +
        `[1:v]format=rgba,` +
        `eq=saturation=1.06:contrast=1.03:brightness=-0.01,` +
        `scale=w='iw*(${scaleExpr})':h=-1:eval=frame[char];` +
        `[bg][char]overlay=` +
        `x='(W-w)*(${xExpr})':` +
        `y='(H-h)*(${yExpr})':` +
        `format=auto[out]`;

      console.log(
        'FFmpeg filter:',
        filterComplex
      );

      const args = [
        '-y',

        '-i',
        backgroundImagePath ||
          backgroundPath,

        '-loop',
        '1',

        '-i',
        characterPath,

        '-filter_complex',
        filterComplex,

        '-map',
        '[out]',

        '-t',
        String(duration),

        '-c:v',
        'libx264',

        '-pix_fmt',
        'yuv420p',

        '-movflags',
        '+faststart',

        outputPath,
      ];

      console.log(
        'Running FFmpeg...'
      );

      await new Promise(
        (
          resolve,
          reject
        ) => {
          execFile(
            ffmpegPath,
            args,
            {
              maxBuffer:
                1024 *
                1024 *
                20,
            },
            (
              error,
              stdout,
              stderr
            ) => {
              if (error) {
                console.error(
                  'FFmpeg error:',
                  error
                );

                console.error(
                  'FFmpeg stderr:',
                  stderr
                );

                reject(
                  new Error(
                    `FFmpeg rendering failed: ${error.message}\n${stderr}`
                  )
                );

                return;
              }

              console.log(
                'FFmpeg rendering completed.'
              );

              resolve();
            }
          );
        }
      );

      /* =====================================================
         LOCAL FILE RESPONSE
         ===================================================== */

      const filename =
        path.basename(
          outputPath
        );

      const configuredBaseUrl =
        process.env.PUBLIC_API_URL
          ? process.env.PUBLIC_API_URL.replace(
              /\/$/,
              ''
            )
          : `${req.protocol}://${req.get('host')}`;

      const baseUrl =
        configuredBaseUrl.replace(
          /\/api\/video$/,
          ''
        );

      const videoUrl =
        `${baseUrl}/api/video/files/${filename}`;

      console.log(
        '=========================================='
      );

      console.log(
        'CHARACTER VIDEO READY'
      );

      console.log(
        'Video URL:',
        videoUrl
      );

      console.log(
        'Storage: Local'
      );

      console.log(
        'Cloudinary: Disabled'
      );

      console.log(
        '=========================================='
      );

      /*
       * IMPORTANT:
       * Do NOT delete outputPath here.
       *
       * The frontend needs to access:
       *
       * /api/video/files/:filename
       *
       * so the file must remain in TMP_DIR.
       */

      return res.json({
        success: true,
        message:
          'Character video rendered successfully.',
        characterName,
        videoUrl,
        filename,
        duration,
        storage: 'local',
        cloudinaryUsed: false,
      });
    } catch (error) {
      console.error(
        'Character render error:',
        error
      );

      safeUnlink(
        backgroundPath
      );

      safeUnlink(
        backgroundImagePath
      );

      safeUnlink(
        characterPath
      );

      safeUnlink(
        outputPath
      );

      return res.status(500).json({
        success: false,
        message:
          'Failed to render character video.',
        error:
          getErrorDetails(error),
      });
    }
  }
);


/* =========================================================
   EXPORT ROUTER
   ========================================================= */

module.exports = router;