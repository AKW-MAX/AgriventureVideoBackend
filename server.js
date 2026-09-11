const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

// ======================================================
// ROUTES
// ======================================================

const posterRoutes = require('./routes/poster');
const characterRoutes = require('./routes/character');
const videoRoutes = require('./routes/video');

// ======================================================
// APP
// ======================================================

const app = express();

// ======================================================
// RENDER / HTTPS PROXY
// ======================================================

app.set('trust proxy', 1);

// ======================================================
// DIRECTORIES
// ======================================================

const POSTERS_DIRECTORY = path.join(
  __dirname,
  'public',
  'posters'
);

if (!fs.existsSync(POSTERS_DIRECTORY)) {
  fs.mkdirSync(POSTERS_DIRECTORY, {
    recursive: true,
  });

  console.log(
    '📁 Created posters directory:',
    POSTERS_DIRECTORY
  );
}

// ======================================================
// ENVIRONMENT
// ======================================================

const PORT = process.env.PORT || 5001;

const PUBLIC_BASE_URL =
  process.env.PUBLIC_BASE_URL ||
  `http://localhost:${PORT}`;

// ======================================================
// STARTUP INFORMATION
// ======================================================

console.log('');
console.log('==========================================');
console.log('🌾 AGRIVENTURE VIDEO BACKEND STARTING');
console.log('==========================================');

console.log('NODE_ENV:', process.env.NODE_ENV || '(not set)');
console.log('PORT:', PORT);
console.log('PUBLIC_BASE_URL:', PUBLIC_BASE_URL);

console.log('POSTERS_DIRECTORY:', POSTERS_DIRECTORY);

console.log(
  'POSTERS_DIRECTORY EXISTS:',
  fs.existsSync(POSTERS_DIRECTORY)
);

console.log(
  'SERVER FILE:',
  __filename
);

console.log('==========================================');
console.log('');

// ======================================================
// DEBUG ROUTER HELPER
// ======================================================

function printRouterRoutes(name, router, filePath) {
  console.log('');
  console.log('==========================================');
  console.log(`🔎 ${name.toUpperCase()} ROUTER REGISTERED ROUTES`);
  console.log('==========================================');

  try {
    console.log(
      `📁 ${name} router file:`,
      require.resolve(filePath)
    );
  } catch (error) {
    console.log(
      `⚠️ Could not resolve ${name} router file:`,
      error.message
    );
  }

  if (!router || !router.stack) {
    console.log(
      `⚠️ Could not inspect ${name} router.`
    );

    console.log('==========================================');
    return;
  }

  let routeCount = 0;

  router.stack.forEach((layer) => {
    if (layer.route) {
      routeCount++;

      const methods =
        Object.keys(layer.route.methods)
          .map((method) => method.toUpperCase())
          .join(',');

      console.log(
        `${methods} ${layer.route.path}`
      );
    }
  });

  console.log(
    `Total ${name} routes:`,
    routeCount
  );

  console.log('==========================================');
}

// ======================================================
// PRINT ROUTER INFORMATION
// ======================================================

printRouterRoutes(
  'Poster',
  posterRoutes,
  './routes/poster'
);

printRouterRoutes(
  'Character',
  characterRoutes,
  './routes/character'
);

printRouterRoutes(
  'Video',
  videoRoutes,
  './routes/video'
);

// ======================================================
// CORS
// ======================================================

app.use(cors());

// ======================================================
// BODY PARSING
// ======================================================

app.use(
  express.json({
    limit: '50mb',
  })
);

app.use(
  express.urlencoded({
    extended: true,
    limit: '50mb',
  })
);

// ======================================================
// REQUEST LOGGER
// ======================================================

app.use((req, res, next) => {
  console.log(
    `➡️ ${req.method} ${req.originalUrl}`
  );

  next();
});

// ======================================================
// STATIC POSTER FILES
// ======================================================

console.log('');
console.log('==========================================');
console.log('🖼️ POSTER STATIC FILE SERVER');
console.log('==========================================');

console.log(
  'Directory:',
  POSTERS_DIRECTORY
);

console.log(
  'Exists:',
  fs.existsSync(POSTERS_DIRECTORY)
);

app.use(
  '/posters',
  express.static(
    POSTERS_DIRECTORY,
    {
      fallthrough: true,
      index: false,
      maxAge: '1h',
    }
  )
);

console.log(
  'Public route: /posters/<filename>.png'
);

console.log('==========================================');
console.log('');

// ======================================================
// ROOT TEST
// ======================================================

app.get(
  '/',
  (req, res) => {
    res.json({
      success: true,

      message:
        'Agriventure Video Backend is running.',

      server:
        'Agriventure Video Backend',

      version:
        '1.0.0',

      port:
        PORT,

      protocol:
        req.protocol,

      secure:
        req.secure,

      publicBaseUrl:
        PUBLIC_BASE_URL,

      routes: {
        poster:
          '/api/poster',

        character:
          '/api/character',

        video:
          '/api/video',

        health:
          '/api/health',
      },
    });
  }
);

// ======================================================
// POSTER FILE DEBUG
// ======================================================

app.get(
  '/posters-test',
  (req, res) => {
    try {
      const exists =
        fs.existsSync(
          POSTERS_DIRECTORY
        );

      let files = [];

      if (exists) {
        files =
          fs.readdirSync(
            POSTERS_DIRECTORY
          );
      }

      return res.json({
        success: true,

        directory:
          POSTERS_DIRECTORY,

        exists,

        fileCount:
          files.length,

        files,

        publicBaseUrl:
          PUBLIC_BASE_URL,
      });
    } catch (error) {
      console.error(
        '❌ POSTERS TEST ERROR:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          error.message,
      });
    }
  }
);

// ======================================================
// INDIVIDUAL POSTER FILE TEST
// ======================================================

app.get(
  '/poster-file-test/:filename',
  (req, res) => {
    try {
      const filename =
        path.basename(
          req.params.filename
        );

      const filePath =
        path.join(
          POSTERS_DIRECTORY,
          filename
        );

      const exists =
        fs.existsSync(filePath);

      console.log('');
      console.log(
        '🖼️ POSTER FILE TEST'
      );

      console.log(
        'Filename:',
        filename
      );

      console.log(
        'Path:',
        filePath
      );

      console.log(
        'Exists:',
        exists
      );

      if (!exists) {
        return res.status(404).json({
          success: false,

          message:
            'Poster file does not exist.',

          filename,

          filePath,
        });
      }

      const stats =
        fs.statSync(filePath);

      return res.json({
        success: true,

        filename,

        filePath,

        size:
          stats.size,

        created:
          stats.birthtime,

        modified:
          stats.mtime,
      });
    } catch (error) {
      console.error(
        '❌ POSTER FILE TEST ERROR:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          error.message,
      });
    }
  }
);

// ======================================================
// POSTER API
// ======================================================

app.use(
  '/api/poster',
  posterRoutes
);

console.log('');
console.log('==========================================');
console.log('🎨 POSTER API');
console.log('==========================================');

console.log(
  'Mounted at: /api/poster'
);

console.log(
  'Test: GET /api/poster/test'
);

console.log(
  'Server test: GET /api/poster/server-test'
);

console.log(
  'Generate: POST /api/poster/generate'
);

console.log('==========================================');
console.log('');

// ======================================================
// CHARACTER API
// ======================================================

app.use(
  '/api/character',
  characterRoutes
);

console.log('');
console.log('==========================================');
console.log('👨‍🌾 CHARACTER API');
console.log('==========================================');

console.log(
  'Mounted at: /api/character'
);

console.log(
  'Test: GET /api/character/test'
);

console.log(
  'Gemini test: GET /api/character/gemini-test'
);

console.log(
  'Background removal: POST /api/character/remove-background'
);

console.log(
  'Animation: POST /api/character/animate'
);

console.log(
  'Animation analyze: POST /api/character/animate/analyze'
);

console.log(
  'Animation validate: POST /api/character/animate/validate'
);

console.log(
  'Animation generate: POST /api/character/animate/generate'
);

console.log(
  'Animation render: POST /api/character/animate/render'
);

console.log('==========================================');
console.log('');

// ======================================================
// VIDEO API
// ======================================================

app.use(
  '/api/video',
  videoRoutes
);

console.log('');
console.log('==========================================');
console.log('🎬 VIDEO API');
console.log('==========================================');

console.log(
  'Mounted at: /api/video'
);

console.log(
  'Video server test: GET /api/video/test-server'
);

console.log(
  'Background test: GET /api/video/background/test'
);

console.log(
  'Background photo: POST /api/video/background/photo'
);

console.log(
  'Background generate: POST /api/video/background/generate'
);

console.log('==========================================');
console.log('');

// ======================================================
// CHARACTER SERVER TEST
// ======================================================
//
// This route is intentionally outside characterRoutes.
// It proves that this exact server.js is deployed.
//
// ======================================================

app.get(
  '/api/character/server-test',
  (req, res) => {
    res.json({
      success: true,

      message:
        'Character API server mount is working.',

      route:
        '/api/character/server-test',

      method:
        'GET',

      characterRouterLoaded:
        !!characterRoutes,

      characterRouterStack:
        !!(
          characterRoutes &&
          characterRoutes.stack
        ),

      characterRouterFile:
        require.resolve(
          './routes/character'
        ),

      protocol:
        req.protocol,

      secure:
        req.secure,

      timestamp:
        new Date().toISOString(),
    });
  }
);

// ======================================================
// BACKGROUND REMOVAL SERVER TEST
// ======================================================
//
// This does NOT process an image.
// It only confirms that this server knows
// the expected endpoint.
//
// Actual processing remains:
//
// POST /api/character/remove-background
//
// ======================================================

app.get(
  '/api/character/remove-background-test',
  (req, res) => {
    res.json({
      success: true,

      message:
        'Background removal endpoint is available for POST requests.',

      route:
        '/api/character/remove-background',

      methodExpected:
        'POST',

      router:
        '/api/character',

      handler:
        'routes/character.js',

      timestamp:
        new Date().toISOString(),
    });
  }
);

// ======================================================
// VIDEO SERVER TEST
// ======================================================

app.get(
  '/api/video/test-server',
  (req, res) => {
    res.json({
      success: true,

      message:
        'Video API is connected correctly.',

      route:
        '/api/video/test-server',

      method:
        'GET',

      protocol:
        req.protocol,

      secure:
        req.secure,

      timestamp:
        new Date().toISOString(),
    });
  }
);

// ======================================================
// BACKGROUND PHOTO GET TEST
// ======================================================
//
// Actual processing is POST.
// This GET route only confirms the server is alive.
//
// ======================================================

app.get(
  '/api/video/background/photo',
  (req, res) => {
    res.json({
      success: true,

      message:
        'Background photo endpoint exists on this server.',

      route:
        '/api/video/background/photo',

      methodExpected:
        'POST',

      note:
        'Use POST for actual photo processing.',
    });
  }
);

// ======================================================
// HEALTH CHECK
// ======================================================

app.get(
  '/api/health',
  (req, res) => {
    res.json({
      success: true,

      status:
        'online',

      message:
        'Agriventure backend is healthy.',

      timestamp:
        new Date().toISOString(),

      serverFile:
        __filename,

      protocol:
        req.protocol,

      secure:
        req.secure,

      port:
        PORT,

      postersDirectory:
        POSTERS_DIRECTORY,

      postersDirectoryExists:
        fs.existsSync(
          POSTERS_DIRECTORY
        ),

      publicBaseUrl:
        PUBLIC_BASE_URL,

      routes: {
        poster:
          '/api/poster',

        character:
          '/api/character',

        video:
          '/api/video',
      },
    });
  }
);

// ======================================================
// API ROUTES SUMMARY
// ======================================================

app.get(
  '/api/routes',
  (req, res) => {
    res.json({
      success: true,

      message:
        'Agriventure API routes',

      routes: {
        root:
          'GET /',

        health:
          'GET /api/health',

        posterTest:
          'GET /api/poster/test',

        posterServerTest:
          'GET /api/poster/server-test',

        posterGenerate:
          'POST /api/poster/generate',

        characterTest:
          'GET /api/character/test',

        characterServerTest:
          'GET /api/character/server-test',

        characterGeminiTest:
          'GET /api/character/gemini-test',

        characterRemoveBackground:
          'POST /api/character/remove-background',

        characterRemoveBackgroundTest:
          'GET /api/character/remove-background-test',

        characterAnimate:
          'POST /api/character/animate',

        characterAnalyze:
          'POST /api/character/animate/analyze',

        characterValidate:
          'POST /api/character/animate/validate',

        characterGenerate:
          'POST /api/character/animate/generate',

        characterRender:
          'POST /api/character/animate/render',

        videoServerTest:
          'GET /api/video/test-server',

        videoBackgroundTest:
          'GET /api/video/background/test',

        videoBackgroundPhoto:
          'POST /api/video/background/photo',

        videoBackgroundGenerate:
          'POST /api/video/background/generate',

        posterFiles:
          'GET /posters/<filename>.png',
      },
    });
  }
);

// ======================================================
// 404 HANDLER
// ======================================================

app.use(
  (req, res) => {
    console.log('');
    console.log('==========================================');
    console.log('❌ 404 ROUTE NOT FOUND');
    console.log('==========================================');

    console.log(
      'Method:',
      req.method
    );

    console.log(
      'Original URL:',
      req.originalUrl
    );

    console.log(
      'Path:',
      req.path
    );

    console.log(
      'Host:',
      req.get('host')
    );

    console.log(
      'Protocol:',
      req.protocol
    );

    console.log(
      'Secure:',
      req.secure
    );

    console.log('==========================================');
    console.log('');

    return res.status(404).json({
      success: false,

      message:
        'Route not found',

      method:
        req.method,

      path:
        req.originalUrl,

      hint:
        'Check the HTTP method and API path.',
    });
  }
);

// ======================================================
// GLOBAL ERROR HANDLER
// ======================================================

app.use(
  (
    err,
    req,
    res,
    next
  ) => {
    console.error('');
    console.error('==========================================');
    console.error('❌ SERVER ERROR');
    console.error('==========================================');

    console.error(
      'Message:',
      err?.message
    );

    console.error(
      'Stack:',
      err?.stack
    );

    console.error('==========================================');
    console.error('');

    if (res.headersSent) {
      return next(err);
    }

    return res.status(
      err?.status || 500
    ).json({
      success: false,

      message:
        err?.message ||
        'Internal server error.',

      error:
        err?.message ||
        'Internal server error.',
    });
  }
);

// ======================================================
// SERVER START
// ======================================================

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log('');
    console.log('==========================================');
    console.log('🌾 AGRIVENTURE VIDEO BACKEND');
    console.log('==========================================');

    console.log(
      `🚀 Server running on port: ${PORT}`
    );

    console.log(
      'Server file:',
      __filename
    );

    console.log(
      'PUBLIC_BASE_URL:',
      PUBLIC_BASE_URL
    );

    console.log('');
    console.log('==========================================');
    console.log('🎨 POSTER API');
    console.log('==========================================');

    console.log(
      'GET  /api/poster/test'
    );

    console.log(
      'GET  /api/poster/server-test'
    );

    console.log(
      'POST /api/poster/generate'
    );

    console.log('');
    console.log('==========================================');
    console.log('👨‍🌾 CHARACTER API');
    console.log('==========================================');

    console.log(
      'GET  /api/character/test'
    );

    console.log(
      'GET  /api/character/server-test'
    );

    console.log(
      'GET  /api/character/remove-background-test'
    );

    console.log(
      'GET  /api/character/gemini-test'
    );

    console.log(
      'POST /api/character/remove-background'
    );

    console.log(
      'POST /api/character/animate'
    );

    console.log(
      'POST /api/character/animate/analyze'
    );

    console.log(
      'POST /api/character/animate/validate'
    );

    console.log(
      'POST /api/character/animate/generate'
    );

    console.log(
      'POST /api/character/animate/render'
    );

    console.log('');
    console.log('==========================================');
    console.log('🎬 VIDEO API');
    console.log('==========================================');

    console.log(
      'GET  /api/video/test-server'
    );

    console.log(
      'GET  /api/video/background/test'
    );

    console.log(
      'GET  /api/video/background/photo'
    );

    console.log(
      'POST /api/video/background/photo'
    );

    console.log(
      'POST /api/video/background/generate'
    );

    console.log('');
    console.log('==========================================');
    console.log('🖼️ POSTER FILES');
    console.log('==========================================');

    console.log(
      'GET /posters/<filename>.png'
    );

    console.log(
      'GET /posters-test'
    );

    console.log(
      'GET /poster-file-test/<filename>'
    );

    console.log('');
    console.log('==========================================');
    console.log('❤️ HEALTH');
    console.log('==========================================');

    console.log(
      'GET /api/health'
    );

    console.log(
      'GET /api/routes'
    );

    console.log('');
    console.log('==========================================');
    console.log('✅ SERVER READY');
    console.log('==========================================');
    console.log('');
  }
);