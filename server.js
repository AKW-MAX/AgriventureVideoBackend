const express = require('express');
const cors = require('cors');
const path = require('path');
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
// DEBUG: POSTER ROUTES
// ======================================================

console.log('');
console.log('==========================================');
console.log('🔎 POSTER ROUTER REGISTERED ROUTES');
console.log('==========================================');

console.log(
  '📁 Poster router file:',
  require.resolve('./routes/poster')
);

if (posterRoutes && posterRoutes.stack) {
  posterRoutes.stack.forEach((layer) => {
    if (layer.route) {
      const methods = Object.keys(
        layer.route.methods
      )
        .map((method) => method.toUpperCase())
        .join(',');

      console.log(
        `${methods} ${layer.route.path}`
      );
    }
  });
} else {
  console.log(
    '⚠️ Could not inspect poster router.'
  );
}

console.log('==========================================');


// ======================================================
// DEBUG: VIDEO ROUTES
// ======================================================

console.log('');
console.log('==========================================');
console.log('🔎 VIDEO ROUTER REGISTERED ROUTES');
console.log('==========================================');

if (videoRoutes && videoRoutes.stack) {
  videoRoutes.stack.forEach((layer) => {
    if (layer.route) {
      const methods = Object.keys(
        layer.route.methods
      )
        .map((method) => method.toUpperCase())
        .join(',');

      console.log(
        `${methods} ${layer.route.path}`
      );
    }
  });
}

console.log('==========================================');


// ======================================================
// CORS
// ======================================================

app.use(cors());


// ======================================================
// BODY PARSING
// ======================================================
//
// Large limits are required because the mobile app can
// send Base64 images.
//

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
// STATIC POSTER FILES
// ======================================================
//
// Generated posters are stored in:
//
// public/posters
//
// They can then be accessed through:
//
// http://YOUR-IP:5001/posters/file.png
//

const POSTERS_DIRECTORY = path.join(
  __dirname,
  'public',
  'posters'
);

app.use(
  '/posters',
  express.static(
    POSTERS_DIRECTORY
  )
);

console.log('');
console.log('🖼️ Poster files directory:');
console.log(
  POSTERS_DIRECTORY
);

console.log('');
console.log('🌐 Poster URL:');
console.log(
  '/posters/<filename>.png'
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
  'Test:       GET /api/poster/test'
);
console.log(
  'Generate:   POST /api/poster/generate'
);
console.log('==========================================');


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
console.log('==========================================');


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
console.log('==========================================');


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
      server: 'Agriventure Video Backend',
      port:
        process.env.PORT || 5001,
    });
  }
);


// ======================================================
// POSTER TEST
// ======================================================
//
// This is an additional server-level test.
//
// IMPORTANT:
// The actual poster router should ALSO have:
//
// router.get('/test', ...)
//
// Therefore both of these should work:
//
// GET /api/poster/test
//
// The request should normally be handled by
// routes/poster.js before reaching this fallback.
//

app.get(
  '/api/poster/server-test',
  (req, res) => {
    res.json({
      success: true,
      message:
        'Poster API server mount is working.',
      route:
        '/api/poster/server-test',
      method: 'GET',
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
      method: 'GET',
    });
  }
);


// ======================================================
// BACKGROUND PHOTO TEST
// ======================================================
//
// This only confirms that the server knows the endpoint.
// Actual processing should be handled by videoRoutes.
//

app.get(
  '/api/video/background/photo',
  (req, res) => {
    res.json({
      success: true,
      message:
        'Background photo endpoint exists on this server.',
      route:
        '/api/video/background/photo',
      methodExpected: 'POST',
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
      status: 'online',
      message:
        'Agriventure backend is healthy.',
      timestamp:
        new Date().toISOString(),
    });
  }
);


// ======================================================
// 404 HANDLER
// ======================================================
//
// IMPORTANT:
// This MUST remain AFTER all routes.
//

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
    console.log('==========================================');
    console.log('');

    res.status(404).json({
      success: false,
      message: 'Route not found',
      method: req.method,
      path: req.originalUrl,
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
    console.error(
      '=========================================='
    );
    console.error(
      '❌ SERVER ERROR'
    );
    console.error(
      '=========================================='
    );

    console.error(
      'Message:',
      err?.message
    );

    console.error(
      'Stack:',
      err?.stack
    );

    console.error(
      '=========================================='
    );
    console.error('');

    if (res.headersSent) {
      return next(err);
    }

    res.status(
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

const PORT =
  process.env.PORT || 5001;

app.listen(
  PORT,
  '0.0.0.0',
  () => {
    console.log('');
    console.log(
      '=========================================='
    );
    console.log(
      '🌾 AGRIVENTURE VIDEO BACKEND'
    );
    console.log(
      '=========================================='
    );

    console.log(
      `🚀 Server running on port: ${PORT}`
    );

    console.log('');

    console.log(
      `Local:   http://localhost:${PORT}`
    );

    console.log(
      `Network: http://0.0.0.0:${PORT}`
    );

    console.log('');

    console.log(
      '=========================================='
    );
    console.log(
      '🎨 POSTER API'
    );
    console.log(
      '=========================================='
    );

    console.log(
      `Test:`
    );

    console.log(
      `http://localhost:${PORT}/api/poster/test`
    );

    console.log('');

    console.log(
      `Server test:`
    );

    console.log(
      `http://localhost:${PORT}/api/poster/server-test`
    );

    console.log('');

    console.log(
      `Generate:`
    );

    console.log(
      `POST http://localhost:${PORT}/api/poster/generate`
    );

    console.log('');

    console.log(
      '=========================================='
    );
    console.log(
      '👨‍🌾 CHARACTER API'
    );
    console.log(
      '=========================================='
    );

    console.log(
      `http://localhost:${PORT}/api/character`
    );

    console.log('');

    console.log(
      '=========================================='
    );
    console.log(
      '🎬 VIDEO API'
    );
    console.log(
      '=========================================='
    );

    console.log(
      `http://localhost:${PORT}/api/video`
    );

    console.log('');

    console.log(
      `Video test:`
    );

    console.log(
      `http://localhost:${PORT}/api/video/test-server`
    );

    console.log('');

    console.log(
      '=========================================='
    );
    console.log(
      '🖼️ POSTER FILES'
    );
    console.log(
      '=========================================='
    );

    console.log(
      `http://localhost:${PORT}/posters/`
    );

    console.log('');

    console.log(
      '=========================================='
    );
    console.log(
      '❤️ HEALTH CHECK'
    );
    console.log(
      '=========================================='
    );

    console.log(
      `http://localhost:${PORT}/api/health`
    );

    console.log('');

    console.log(
      '=========================================='
    );
    console.log(
      '✅ SERVER READY'
    );
    console.log(
      '=========================================='
    );
    console.log('');
  }
);