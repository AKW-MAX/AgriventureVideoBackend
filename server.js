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

// Make sure the posters directory exists
if (!fs.existsSync(POSTERS_DIRECTORY)) {
  fs.mkdirSync(
    POSTERS_DIRECTORY,
    {
      recursive: true,
    }
  );

  console.log(
    '📁 Created posters directory:',
    POSTERS_DIRECTORY
  );
}

// ======================================================
// DEBUG: ENVIRONMENT
// ======================================================

console.log('');
console.log('==========================================');
console.log('🌾 AGRIVENTURE BACKEND STARTING');
console.log('==========================================');

console.log(
  'NODE_ENV:',
  process.env.NODE_ENV || '(not set)'
);

console.log(
  'PORT:',
  process.env.PORT || 5001
);

console.log(
  'PUBLIC_BASE_URL:',
  process.env.PUBLIC_BASE_URL || '(NOT SET)'
);

console.log(
  'POSTERS_DIRECTORY:',
  POSTERS_DIRECTORY
);

console.log(
  'POSTERS_DIRECTORY EXISTS:',
  fs.existsSync(POSTERS_DIRECTORY)
);

console.log('==========================================');
console.log('');

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

if (
  posterRoutes &&
  posterRoutes.stack
) {
  posterRoutes.stack.forEach(
    (layer) => {
      if (layer.route) {
        const methods =
          Object.keys(
            layer.route.methods
          )
            .map(
              (method) =>
                method.toUpperCase()
            )
            .join(',');

        console.log(
          `${methods} ${layer.route.path}`
        );
      }
    }
  );
} else {
  console.log(
    '⚠️ Could not inspect poster router.'
  );
}

console.log(
  '=========================================='
);

// ======================================================
// DEBUG: VIDEO ROUTES
// ======================================================

console.log('');
console.log('==========================================');
console.log('🔎 VIDEO ROUTER REGISTERED ROUTES');
console.log('==========================================');

if (
  videoRoutes &&
  videoRoutes.stack
) {
  videoRoutes.stack.forEach(
    (layer) => {
      if (layer.route) {
        const methods =
          Object.keys(
            layer.route.methods
          )
            .map(
              (method) =>
                method.toUpperCase()
            )
            .join(',');

        console.log(
          `${methods} ${layer.route.path}`
        );
      }
    }
  );
}

console.log(
  '=========================================='
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
  fs.existsSync(
    POSTERS_DIRECTORY
  )
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

console.log(
  '=========================================='
);

// ======================================================
// POSTER FILE DEBUG ROUTE
// ======================================================
//
// Example:
//
// GET /posters-test
//
// This lets us see exactly what files Render has.
//
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

      res.json({
        success: true,

        directory:
          POSTERS_DIRECTORY,

        exists,

        fileCount:
          files.length,

        files,

        publicBaseUrl:
          process.env.PUBLIC_BASE_URL ||
          null,
      });
    } catch (error) {
      console.error(
        '❌ POSTERS TEST ERROR:',
        error
      );

      res.status(500).json({
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
//
// Example:
//
// /poster-file-test/my-file.png
//
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
  'Generate: POST /api/poster/generate'
);

console.log(
  '==========================================');

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
  '==========================================');

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
  '==========================================');

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

      port:
        process.env.PORT || 5001,

      protocol:
        req.protocol,

      secure:
        req.secure,

      publicBaseUrl:
        process.env.PUBLIC_BASE_URL ||
        null,
    });
  }
);

// ======================================================
// POSTER SERVER TEST
// ======================================================

app.get(
  '/api/poster/server-test',
  (req, res) => {
    res.json({
      success: true,

      message:
        'Poster API server mount is working.',

      route:
        '/api/poster/server-test',

      method:
        'GET',

      protocol:
        req.protocol,

      secure:
        req.secure,

      postersDirectory:
        POSTERS_DIRECTORY,

      postersDirectoryExists:
        fs.existsSync(
          POSTERS_DIRECTORY
        ),

      publicBaseUrl:
        process.env.PUBLIC_BASE_URL ||
        null,
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
    });
  }
);

// ======================================================
// BACKGROUND PHOTO TEST
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

      protocol:
        req.protocol,

      secure:
        req.secure,

      postersDirectory:
        POSTERS_DIRECTORY,

      postersDirectoryExists:
        fs.existsSync(
          POSTERS_DIRECTORY
        ),

      publicBaseUrl:
        process.env.PUBLIC_BASE_URL ||
        null,
    });
  }
);

// ======================================================
// 404 HANDLER
// ======================================================

app.use(
  (req, res) => {
    console.log('');
    console.log(
      '=========================================='
    );

    console.log(
      '❌ 404 ROUTE NOT FOUND'
    );

    console.log(
      '=========================================='
    );

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

    console.log(
      '=========================================='
    );

    console.log('');

    res.status(404).json({
      success: false,

      message:
        'Route not found',

      method:
        req.method,

      path:
        req.originalUrl,
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
      'PUBLIC_BASE_URL:',
      process.env.PUBLIC_BASE_URL ||
        '(NOT SET)'
    );

    console.log('');

    console.log(
      'Poster directory:'
    );

    console.log(
      POSTERS_DIRECTORY
    );

    console.log('');

    console.log(
      'Posters directory exists:'
    );

    console.log(
      fs.existsSync(
        POSTERS_DIRECTORY
      )
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
      `GET /api/poster/test`
    );

    console.log(
      `GET /api/poster/server-test`
    );

    console.log(
      `POST /api/poster/generate`
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
      `GET /posters/<filename>.png`
    );

    console.log(
      `GET /posters-test`
    );

    console.log(
      `GET /poster-file-test/<filename>`
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
      `GET /api/health`
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