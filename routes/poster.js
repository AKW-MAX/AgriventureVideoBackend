const express = require('express');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const router = express.Router();

console.log('==========================================');
console.log('🎨 POSTER ROUTER LOADED');
console.log('Poster route file:', __filename);
console.log('==========================================');

// ======================================================
// OUTPUT DIRECTORY
// ======================================================

const OUTPUT_DIR = path.join(
  __dirname,
  '..',
  'public',
  'posters'
);

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ======================================================
// POSTER SIZES
// ======================================================

const SIZES = {
  square: {
    width: 1080,
    height: 1080,
  },

  portrait: {
    width: 1080,
    height: 1350,
  },

  story: {
    width: 1080,
    height: 1920,
  },

  landscape: {
    width: 1920,
    height: 1080,
  },
};

// ======================================================
// AVAILABLE TEMPLATES
// ======================================================

const TEMPLATES = new Set([
  'modernFarm',
  'boldProduct',
  'premiumAgri',
  'pestControl',
  'promotion',
  'productInfo',
  'socialMedia',
  'minimal',
]);

// ======================================================
// BASIC HELPERS
// ======================================================

function cleanText(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return '';
  }

  return String(value).trim();
}

// ======================================================
// XML ESCAPING
// ======================================================

function escapeXml(value) {
  return cleanText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ======================================================
// SAFE FILE NAME
// ======================================================

function safeFileName(value) {
  return cleanText(value)
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

// ======================================================
// COLOR HELPERS
// ======================================================

function normalizeColor(value) {
  const color = cleanText(value);

  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color;
  }

  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return (
      '#' +
      color[1] + color[1] +
      color[2] + color[2] +
      color[3] + color[3]
    );
  }

  return '#2E7D32';
}

function hexToRgb(hex) {
  const color =
    normalizeColor(hex).slice(1);

  return {
    r: parseInt(
      color.slice(0, 2),
      16
    ),

    g: parseInt(
      color.slice(2, 4),
      16
    ),

    b: parseInt(
      color.slice(4, 6),
      16
    ),
  };
}

function rgba(hex, alpha) {
  const rgb = hexToRgb(hex);

  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

// ======================================================
// TEXT WRAPPING
// ======================================================

function wrapText(
  text,
  width,
  fontSize
) {
  const value = cleanText(text);

  if (!value) {
    return [];
  }

  const averageCharWidth =
    Math.max(
      fontSize * 0.52,
      7
    );

  const maxChars =
    Math.max(
      8,
      Math.floor(
        width /
        averageCharWidth
      )
    );

  const words =
    value.split(/\s+/);

  const lines = [];

  let line = '';

  for (const word of words) {
    if (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = '';
      }

      for (
        let i = 0;
        i < word.length;
        i += maxChars
      ) {
        lines.push(
          word.slice(
            i,
            i + maxChars
          )
        );
      }

      continue;
    }

    const candidate =
      line
        ? `${line} ${word}`
        : word;

    if (
      candidate.length <=
      maxChars
    ) {
      line = candidate;
    } else {
      if (line) {
        lines.push(line);
      }

      line = word;
    }
  }

  if (line) {
    lines.push(line);
  }

  return lines;
}

// ======================================================
// TRUNCATE LINES
// ======================================================

function truncateLines(
  lines,
  maxLines
) {
  if (
    !maxLines ||
    lines.length <= maxLines
  ) {
    return lines;
  }

  const result =
    lines.slice(0, maxLines);

  if (result.length) {
    result[result.length - 1] =
      `${result[result.length - 1]
        .replace(/[.,;:!?-]+$/, '')}…`;
  }

  return result;
}

// ======================================================
// TEXT BLOCK
// ======================================================

function textBlock(
  text,
  x,
  y,
  width,
  fontSize,
  fill,
  options = {}
) {
  const {
    weight = '400',
    lineHeight =
      Math.round(
        fontSize * 1.35
      ),
    maxLines = 4,
    anchor = 'start',
    family =
      'Arial, Helvetica, sans-serif',
  } = options;

  const lines =
    truncateLines(
      wrapText(
        text,
        width,
        fontSize
      ),
      maxLines
    );

  return lines
    .map(
      (line, index) => `
        <text
          x="${x}"
          y="${
            y +
            index * lineHeight
          }"
          font-family="${family}"
          font-size="${fontSize}px"
          font-weight="${weight}"
          fill="${fill}"
          text-anchor="${anchor}"
        >${escapeXml(line)}</text>
      `
    )
    .join('');
}

// ======================================================
// DATA URI -> BUFFER
// ======================================================

function dataUriToBuffer(
  dataUri
) {
  if (!dataUri) {
    return null;
  }

  const match =
    String(dataUri).match(
      /^data:([^;]+);base64,(.+)$/s
    );

  if (!match) {
    return null;
  }

  try {
    return Buffer.from(
      match[2],
      'base64'
    );
  } catch (error) {
    console.log(
      '⚠️ Base64 conversion failed:',
      error.message
    );

    return null;
  }
}

// ======================================================
// COLOR DISTANCE
// ======================================================

function colorDistance(
  r1,
  g1,
  b1,
  r2,
  g2,
  b2
) {
  return Math.sqrt(
    Math.pow(r1 - r2, 2) +
    Math.pow(g1 - g2, 2) +
    Math.pow(b1 - b2, 2)
  );
}

// ======================================================
// EDGE BACKGROUND REMOVAL
//
// Removes background ONLY when it is connected to the
// outer edges.
//
// This is important because we do NOT want to simply
// remove every black pixel from the product.
// ======================================================

async function removeEdgeBackground(
  inputBuffer
) {
  try {
    const prepared =
      sharp(inputBuffer)
        .ensureAlpha();

    const metadata =
      await prepared.metadata();

    const width =
      metadata.width || 1000;

    const height =
      metadata.height || 1000;

    const raw =
      await prepared
        .raw()
        .toBuffer();

    const channels = 4;

    // --------------------------------------------------
    // Sample the four corners.
    // --------------------------------------------------

    const corners = [
      [
        raw[0],
        raw[1],
        raw[2],
      ],

      [
        raw[
          (width - 1) *
            channels
        ],
        raw[
          (width - 1) *
            channels + 1
        ],
        raw[
          (width - 1) *
            channels + 2
        ],
      ],

      [
        raw[
          ((height - 1) *
            width) *
            channels
        ],
        raw[
          ((height - 1) *
            width) *
            channels + 1
        ],
        raw[
          ((height - 1) *
            width) *
            channels + 2
        ],
      ],

      [
        raw[
          ((height - 1) *
            width +
            (width - 1)) *
            channels
        ],
        raw[
          ((height - 1) *
            width +
            (width - 1)) *
            channels + 1
        ],
        raw[
          ((height - 1) *
            width +
            (width - 1)) *
            channels + 2
        ],
      ],
    ];

    // --------------------------------------------------
    // Determine whether the corners represent a
    // white/light or black/dark background.
    // --------------------------------------------------

    const brightnessValues =
      corners.map(
        ([r, g, b]) =>
          (r + g + b) / 3
      );

    const averageBrightness =
      brightnessValues.reduce(
        (sum, value) =>
          sum + value,
        0
      ) /
      brightnessValues.length;

    const brightCorners =
      brightnessValues.filter(
        value => value >= 180
      ).length;

    const darkCorners =
      brightnessValues.filter(
        value => value <= 80
      ).length;

    let backgroundMode =
      'none';

    if (brightCorners >= 2) {
      backgroundMode =
        'light';
    } else if (
      darkCorners >= 2
    ) {
      backgroundMode =
        'dark';
    }

    if (
      backgroundMode ===
      'none'
    ) {
      return inputBuffer;
    }

    // --------------------------------------------------
    // Choose the average corner color.
    // --------------------------------------------------

    const selectedCorners =
      corners.filter(
        ([r, g, b]) => {
          const brightness =
            (r + g + b) / 3;

          if (
            backgroundMode ===
            'light'
          ) {
            return (
              brightness >= 170
            );
          }

          return (
            brightness <= 100
          );
        }
      );

    const sourceCorners =
      selectedCorners.length
        ? selectedCorners
        : corners;

    const bgColor =
      sourceCorners.reduce(
        (acc, color) => ({
          r:
            acc.r + color[0],
          g:
            acc.g + color[1],
          b:
            acc.b + color[2],
        }),
        {
          r: 0,
          g: 0,
          b: 0,
        }
      );

    bgColor.r /=
      sourceCorners.length;

    bgColor.g /=
      sourceCorners.length;

    bgColor.b /=
      sourceCorners.length;

    // --------------------------------------------------
    // Flood fill from the outer edge.
    //
    // Only connected background pixels are removed.
    // This protects black/white product details.
    // --------------------------------------------------

    const totalPixels =
      width * height;

    const visited =
      new Uint8Array(
        totalPixels
      );

    const queueX = [];
    const queueY = [];

    function addPixel(
      x,
      y
    ) {
      if (
        x < 0 ||
        y < 0 ||
        x >= width ||
        y >= height
      ) {
        return;
      }

      const index =
        y * width + x;

      if (
        visited[index]
      ) {
        return;
      }

      visited[index] = 1;

      queueX.push(x);
      queueY.push(y);
    }

    // Add all four edges.
    for (
      let x = 0;
      x < width;
      x++
    ) {
      addPixel(x, 0);
      addPixel(
        x,
        height - 1
      );
    }

    for (
      let y = 0;
      y < height;
      y++
    ) {
      addPixel(0, y);
      addPixel(
        width - 1,
        y
      );
    }

    let queueIndex = 0;

    const threshold =
      backgroundMode ===
      'light'
        ? 55
        : 55;

    while (
      queueIndex <
      queueX.length
    ) {
      const x =
        queueX[queueIndex];

      const y =
        queueY[queueIndex];

      queueIndex++;

      const pixelIndex =
        (y * width + x) *
        channels;

      const r =
        raw[pixelIndex];

      const g =
        raw[pixelIndex + 1];

      const b =
        raw[pixelIndex + 2];

      const alpha =
        raw[pixelIndex + 3];

      if (alpha === 0) {
        continue;
      }

      const distance =
        colorDistance(
          r,
          g,
          b,
          bgColor.r,
          bgColor.g,
          bgColor.b
        );

      let isBackground =
        distance <= threshold;

      if (
        backgroundMode ===
        'light'
      ) {
        const brightness =
          (r + g + b) / 3;

        const saturation =
          Math.max(r, g, b) -
          Math.min(r, g, b);

        if (
          brightness >= 215 &&
          saturation <= 55
        ) {
          isBackground = true;
        }
      }

      if (
        backgroundMode ===
        'dark'
      ) {
        const brightness =
          (r + g + b) / 3;

        const saturation =
          Math.max(r, g, b) -
          Math.min(r, g, b);

        if (
          brightness <= 70 &&
          saturation <= 55
        ) {
          isBackground = true;
        }
      }

      if (!isBackground) {
        continue;
      }

      raw[pixelIndex + 3] =
        0;

      addPixel(x + 1, y);
      addPixel(x - 1, y);
      addPixel(x, y + 1);
      addPixel(x, y - 1);
    }

    return await sharp(
      raw,
      {
        raw: {
          width,
          height,
          channels: 4,
        },
      }
    )
      .png()
      .toBuffer();

  } catch (error) {
    console.log(
      '⚠️ Edge background removal failed:',
      error.message
    );

    return inputBuffer;
  }
}

// ======================================================
// REMOVE WHITE / LIGHT BACKGROUND
// ======================================================

async function removeLightBackground(
  inputBuffer
) {
  try {
    const image =
      sharp(inputBuffer)
        .ensureAlpha();

    const metadata =
      await image.metadata();

    const width =
      metadata.width || 1000;

    const height =
      metadata.height || 1000;

    const raw =
      await image
        .raw()
        .toBuffer();

    const channels = 4;

    for (
      let i = 0;
      i < raw.length;
      i += channels
    ) {
      const r = raw[i];
      const g = raw[i + 1];
      const b = raw[i + 2];

      const brightness =
        (r + g + b) / 3;

      const saturation =
        Math.max(r, g, b) -
        Math.min(r, g, b);

      const isWhite =
        brightness >= 242 &&
        saturation <= 35;

      const isLightGray =
        brightness >= 228 &&
        saturation <= 22;

      if (
        isWhite ||
        isLightGray
      ) {
        raw[i + 3] = 0;
      }
    }

    return await sharp(
      raw,
      {
        raw: {
          width,
          height,
          channels: 4,
        },
      }
    )
      .png()
      .toBuffer();

  } catch (error) {
    console.log(
      '⚠️ Light background removal failed:',
      error.message
    );

    return inputBuffer;
  }
}

// ======================================================
// PRODUCT IMAGE PROCESSING
//
// IMPORTANT:
//
// We do NOT resize the original image with "contain"
// before trimming.
//
// That was one of the reasons black margins survived.
//
// Instead:
//
// 1. Decode
// 2. Remove edge background
// 3. Remove light background
// 4. Trim transparent pixels
// 5. Resize the actual product
// 6. Put it on a transparent canvas
// ======================================================

async function processProductImage(
  inputBuffer,
  width,
  height
) {
  try {
    console.log(
      '🖼️ Starting advanced product image processing...'
    );

    // --------------------------------------------------
    // Initial trim.
    // --------------------------------------------------

    let working =
      await sharp(inputBuffer)
        .ensureAlpha()
        .trim({
          threshold: 12,
        })
        .png()
        .toBuffer();

    // --------------------------------------------------
    // Remove edge-connected black/white background.
    // --------------------------------------------------

    working =
      await removeEdgeBackground(
        working
      );

    // --------------------------------------------------
    // Remove remaining light background.
    // --------------------------------------------------

    working =
      await removeLightBackground(
        working
      );

    // --------------------------------------------------
    // Trim again.
    //
    // This is what removes the now-transparent
    // black/white border.
    // --------------------------------------------------

    working =
      await sharp(working)
        .ensureAlpha()
        .trim({
          threshold: 5,
        })
        .png()
        .toBuffer();

    const metadata =
      await sharp(
        working
      ).metadata();

    const sourceW =
      metadata.width || width;

    const sourceH =
      metadata.height || height;

    console.log(
      'Product after background removal:',
      `${sourceW}x${sourceH}`
    );

    // --------------------------------------------------
    // Product should occupy approximately 90% of the
    // available area.
    // --------------------------------------------------

    const targetW =
      Math.max(
        100,
        Math.round(
          width * 0.90
        )
      );

    const targetH =
      Math.max(
        100,
        Math.round(
          height * 0.90
        )
      );

    // --------------------------------------------------
    // Scale the actual product.
    //
    // "inside" keeps proportions without reintroducing
    // the original image's empty space.
    // --------------------------------------------------

    const resized =
      await sharp(working)
        .resize({
          width: targetW,
          height: targetH,
          fit: 'inside',
          withoutEnlargement: false,
          kernel: sharp.kernel.lanczos3,
        })
        .png()
        .toBuffer();

    const resizedMeta =
      await sharp(
        resized
      ).metadata();

    const finalW =
      resizedMeta.width ||
      targetW;

    const finalH =
      resizedMeta.height ||
      targetH;

    // --------------------------------------------------
    // Put product onto a transparent canvas that is
    // exactly the image area.
    // --------------------------------------------------

    const left =
      Math.round(
        (width - finalW) / 2
      );

    const top =
      Math.round(
        (height - finalH) / 2
      );

    const canvas =
      await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: {
            r: 255,
            g: 255,
            b: 255,
            alpha: 0,
          },
        },
      })
        .composite([
          {
            input: resized,
            left,
            top,
          },
        ])
        .png()
        .toBuffer();

    console.log(
      '✅ Product image finished:',
      `${finalW}x${finalH}`,
      'inside',
      `${width}x${height}`
    );

    return canvas;

  } catch (error) {
    console.log(
      '⚠️ Product image processing failed:',
      error.message
    );

    // Safe fallback.
    return await sharp(
      inputBuffer
    )
      .ensureAlpha()
      .resize({
        width,
        height,
        fit: 'inside',
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();
  }
}

// ======================================================
// LAYOUT
// ======================================================

function layoutFor(
  size,
  template
) {
  const {
    width,
    height,
  } = SIZES[size];

  const margin =
    Math.round(
      Math.min(
        width,
        height
      ) * 0.045
    );

  let headerH;

  if (size === 'story') {
    headerH = 270;
  } else if (
    size === 'landscape'
  ) {
    headerH = 190;
  } else {
    headerH = 210;
  }

  let footerH;

  if (size === 'story') {
    footerH = 150;
  } else if (
    size === 'landscape'
  ) {
    footerH = 115;
  } else {
    footerH = 115;
  }

  const contentY =
    headerH;

  const contentBottom =
    height -
    footerH -
    10;

  const contentH =
    Math.max(
      400,
      contentBottom -
      contentY
    );

  return {
    margin,
    headerH,
    footerH,
    contentY,
    contentH,

    contentX: margin,

    contentW:
      width -
      margin * 2,

    footerY:
      height -
      footerH,
  };
}

// ======================================================
// TEMPLATE COLORS
// ======================================================

function templateColors(
  template,
  theme
) {
  const light = {
    bg: '#F4F8F3',
    panel: '#FFFFFF',
    text: '#172017',
    muted: '#586158',
    accent: theme,
    accentSoft:
      rgba(theme, 0.10),
    border: '#DDE6DC',
    footer:
      rgba(theme, 0.12),
    white: '#FFFFFF',
  };

  if (
    template ===
    'boldProduct'
  ) {
    return {
      bg: theme,
      panel: '#FFFFFF',
      text: '#123016',
      muted: '#EAF5EA',
      accent: theme,
      accentSoft:
        'rgba(46,125,50,0.10)',
      border:
        'rgba(255,255,255,0.30)',
      footer:
        'rgba(0,0,0,0.22)',
      white: '#FFFFFF',
    };
  }

  if (
    template ===
    'premiumAgri'
  ) {
    return {
      bg: '#102815',
      panel: '#183C1F',
      text: '#FFFFFF',
      muted: '#D7E8D9',
      accent: theme,
      accentSoft:
        rgba(theme, 0.17),
      border:
        rgba(theme, 0.38),
      footer: '#091A0D',
      white: '#FFFFFF',
    };
  }

  if (
    template ===
    'pestControl'
  ) {
    return {
      bg: '#FFF8EC',
      panel: '#FFFFFF',
      text: '#292219',
      muted: '#6A6257',
      accent: theme,
      accentSoft: '#FFF0D3',
      border: '#E7D7B9',
      footer: '#F5E6CA',
      white: '#FFFFFF',
    };
  }

  if (
    template ===
    'promotion'
  ) {
    return {
      bg: '#FFFDF7',
      panel: '#FFFFFF',
      text: '#24241F',
      muted: '#68665D',
      accent: theme,
      accentSoft: '#FFF1D1',
      border: '#E7DFC9',
      footer: '#F4EBD2',
      white: '#FFFFFF',
    };
  }

  if (
    template ===
    'productInfo'
  ) {
    return {
      bg: '#F3F7F3',
      panel: '#FFFFFF',
      text: '#1C281D',
      muted: '#5C675D',
      accent: theme,
      accentSoft:
        rgba(theme, 0.09),
      border: '#D7E1D7',
      footer: '#E8EFE8',
      white: '#FFFFFF',
    };
  }

  if (
    template ===
    'socialMedia'
  ) {
    return {
      bg: '#F0F7F1',
      panel: '#FFFFFF',
      text: '#17301B',
      muted: '#5D6B60',
      accent: theme,
      accentSoft:
        rgba(theme, 0.11),
      border: '#D5E4D7',
      footer: '#DFECE0',
      white: '#FFFFFF',
    };
  }

  if (
    template ===
    'minimal'
  ) {
    return {
      bg: '#FFFFFF',
      panel: '#FFFFFF',
      text: '#171A17',
      muted: '#626762',
      accent: theme,
      accentSoft: '#F1F3F1',
      border: '#E1E5E1',
      footer: '#F5F6F5',
      white: '#FFFFFF',
    };
  }

  return light;
}

// ======================================================
// BACKGROUND
// ======================================================

function backgroundSvg(
  width,
  height,
  template,
  colors,
  theme
) {
  let svg = `
    <rect
      width="${width}"
      height="${height}"
      fill="${colors.bg}"
    />
  `;

  // ----------------------------------------------------
  // MODERN FARM
  // ----------------------------------------------------

  if (
    template ===
    'modernFarm'
  ) {
    svg += `
      <circle
        cx="${width * 0.90}"
        cy="${height * 0.09}"
        r="${Math.min(width, height) * 0.11}"
        fill="${theme}"
        opacity="0.09"
      />

      <path
        d="
          M0 ${height * 0.94}
          C${width * 0.20} ${height * 0.82},
           ${width * 0.38} ${height * 0.97},
           ${width * 0.57} ${height * 0.87}
          C${width * 0.77} ${height * 0.76},
           ${width * 0.88} ${height * 0.91},
           ${width} ${height * 0.82}
          V${height}
          H0
          Z
        "
        fill="${rgba(theme, 0.08)}"
      />
    `;
  }

  // ----------------------------------------------------
  // BOLD PRODUCT
  // ----------------------------------------------------

  if (
    template ===
    'boldProduct'
  ) {
    svg += `
      <circle
        cx="${width * 0.92}"
        cy="${height * 0.10}"
        r="${Math.min(width, height) * 0.22}"
        fill="#FFFFFF"
        opacity="0.10"
      />

      <circle
        cx="${width * 0.05}"
        cy="${height * 0.90}"
        r="${Math.min(width, height) * 0.18}"
        fill="#FFFFFF"
        opacity="0.07"
      />
    `;
  }

  // ----------------------------------------------------
  // PREMIUM
  // ----------------------------------------------------

  if (
    template ===
    'premiumAgri'
  ) {
    svg += `
      <rect
        x="20"
        y="20"
        width="${width - 40}"
        height="${height - 40}"
        rx="34"
        fill="none"
        stroke="${theme}"
        stroke-width="4"
        opacity="0.65"
      />
    `;
  }

  // ----------------------------------------------------
  // PEST CONTROL
  // ----------------------------------------------------

  if (
    template ===
    'pestControl'
  ) {
    const topH =
      Math.round(
        height * 0.19
      );

    svg += `
      <rect
        x="0"
        y="0"
        width="${width}"
        height="${topH}"
        fill="${theme}"
      />

      <circle
        cx="${width * 0.92}"
        cy="${topH * 0.40}"
        r="${Math.min(width, height) * 0.12}"
        fill="#FFFFFF"
        opacity="0.12"
      />
    `;
  }

  // ----------------------------------------------------
  // PROMOTION
  // ----------------------------------------------------

  if (
    template ===
    'promotion'
  ) {
    const topH =
      Math.round(
        height * 0.18
      );

    svg += `
      <rect
        x="0"
        y="0"
        width="${width}"
        height="${topH}"
        fill="${theme}"
      />

      <circle
        cx="${width * 0.90}"
        cy="${height * 0.08}"
        r="${Math.min(width, height) * 0.13}"
        fill="#FFFFFF"
        opacity="0.12"
      />
    `;
  }

  // ----------------------------------------------------
  // PRODUCT INFO
  // ----------------------------------------------------

  if (
    template ===
    'productInfo'
  ) {
    const side =
      Math.round(
        width * 0.075
      );

    svg += `
      <rect
        x="0"
        y="0"
        width="${side}"
        height="${height}"
        fill="${theme}"
      />
    `;
  }

  // ----------------------------------------------------
  // SOCIAL MEDIA
  // ----------------------------------------------------

  if (
    template ===
    'socialMedia'
  ) {
    const topH =
      Math.round(
        height * 0.12
      );

    svg += `
      <rect
        x="0"
        y="0"
        width="${width}"
        height="${topH}"
        fill="${theme}"
      />

      <circle
        cx="${width * 0.92}"
        cy="${topH * 0.50}"
        r="${Math.min(width, height) * 0.10}"
        fill="#FFFFFF"
        opacity="0.10"
      />
    `;
  }

  return svg;
}

// ======================================================
// OFFER BADGE
// ======================================================

function drawOfferBadge(
  width,
  height,
  theme,
  promoText
) {
  if (!cleanText(promoText)) {
    return '';
  }

  const badgeW =
    height >= 1800
      ? 245
      : 205;

  const badgeH =
    height >= 1800
      ? 92
      : 78;

  const x =
    width -
    badgeW -
    Math.round(
      Math.min(width, height) *
      0.045
    );

  const y =
    Math.round(
      Math.min(width, height) *
      0.045
    );

  return `
    <g>
      <rect
        x="${x}"
        y="${y}"
        width="${badgeW}"
        height="${badgeH}"
        rx="${badgeH / 2}"
        fill="${theme}"
      />

      <text
        x="${x + badgeW / 2}"
        y="${y + badgeH * 0.39}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="${
          height >= 1800
            ? 18
            : 15
        }px"
        font-weight="700"
        fill="#FFFFFF"
        text-anchor="middle"
        letter-spacing="2"
      >
        SPECIAL OFFER
      </text>

      <text
        x="${x + badgeW / 2}"
        y="${y + badgeH * 0.70}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="${
          height >= 1800
            ? 25
            : 21
        }px"
        font-weight="900"
        fill="#FFFFFF"
        text-anchor="middle"
      >
        ${escapeXml(
          cleanText(
            promoText
          ).slice(0, 24)
        )}
      </text>
    </g>
  `;
}

// ======================================================
// HEADER
// ======================================================

function drawHeader(
  width,
  height,
  layout,
  template,
  colors,
  businessName,
  location,
  promoText
) {
  let svg = '';

  const x =
    layout.margin;

  const dark =
    template ===
      'boldProduct' ||
    template ===
      'premiumAgri';

  const textColor =
    dark
      ? '#FFFFFF'
      : colors.text;

  const muted =
    dark
      ? '#DCEBDD'
      : colors.muted;

  const businessSize =
    height >= 1800
      ? 62
      : width >= 1800
        ? 58
        : 54;

  // ----------------------------------------------------
  // COMPANY NAME
  // ----------------------------------------------------

  svg += textBlock(
    businessName,
    x,
    layout.margin +
      businessSize,
    width * 0.68,
    businessSize,
    textColor,
    {
      weight: '900',
      maxLines: 2,
      lineHeight:
        businessSize * 1.02,
      family:
        'Arial, Helvetica, sans-serif',
    }
  );

  // ----------------------------------------------------
  // AGRICULTURAL LABEL
  // ----------------------------------------------------

  svg += `
    <text
      x="${x}"
      y="${
        layout.margin +
        businessSize * 1.70
      }"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${
        height >= 1800
          ? 17
          : 14
      }px"
      font-weight="800"
      fill="${muted}"
      letter-spacing="3"
    >
      AGRICULTURAL SOLUTIONS
    </text>
  `;

  // ----------------------------------------------------
  // LOCATION
  // ----------------------------------------------------

  if (location) {
    svg += `
      <text
        x="${x}"
        y="${
          layout.margin +
          businessSize * 1.98
        }"
        font-family="Arial, Helvetica, sans-serif"
        font-size="17px"
        font-weight="600"
        fill="${muted}"
      >
        ${escapeXml(location)}
      </text>
    `;
  }

  // ----------------------------------------------------
  // OFFER BADGE
  // ----------------------------------------------------

  svg += drawOfferBadge(
    width,
    height,
    colors.accent,
    promoText
  );

  return svg;
}

// ======================================================
// DESCRIPTION FITTING
//
// Finds the largest font that allows as much text as
// possible inside the description area.
// ======================================================

function fitDescription(
  text,
  width,
  height,
  preferredSize,
  minimumSize
) {
  let selectedSize =
    minimumSize;

  let selectedLines =
    wrapText(
      text,
      width,
      minimumSize
    );

  for (
    let size =
      preferredSize;
    size >= minimumSize;
    size -= 1
  ) {
    const lines =
      wrapText(
        text,
        width,
        size
      );

    const lineHeight =
      Math.round(
        size * 1.34
      );

    const needed =
      lines.length *
      lineHeight;

    if (
      needed <= height
    ) {
      selectedSize =
        size;

      selectedLines =
        lines;

      break;
    }
  }

  const lineHeight =
    Math.round(
      selectedSize * 1.34
    );

  const maxLines =
    Math.max(
      1,
      Math.floor(
        height /
        lineHeight
      )
    );

  selectedLines =
    truncateLines(
      selectedLines,
      maxLines
    );

  return {
    fontSize:
      selectedSize,

    lineHeight,

    lines:
      selectedLines,
  };
}

// ======================================================
// DESCRIPTION BOX
// ======================================================

function drawDescriptionBox(
  x,
  y,
  width,
  height,
  description,
  colors,
  textColor,
  accent,
  dark
) {
  if (!cleanText(description)) {
    return '';
  }

  const boxPadding =
    Math.round(
      Math.min(
        width,
        height
      ) * 0.055
    );

  const labelSize =
    height >= 500
      ? 17
      : 14;

  const textAreaHeight =
    Math.max(
      80,
      height -
      boxPadding * 2 -
      55
    );

  const fit =
    fitDescription(
      description,
      width -
        boxPadding * 2,
      textAreaHeight,
      height >= 800
        ? 30
        : 27,
      23
    );

  let svg = `
    <rect
      x="${x}"
      y="${y}"
      width="${width}"
      height="${height}"
      rx="26"
      fill="${
        dark
          ? colors.accentSoft
          : colors.accentSoft
      }"
      stroke="${accent}"
      stroke-width="2"
    />

    <rect
      x="${x + 22}"
      y="${y + 18}"
      width="6"
      height="${
        height - 36
      }"
      rx="3"
      fill="${accent}"
    />

    <text
      x="${x + boxPadding + 8}"
      y="${y + boxPadding + 2}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${labelSize}px"
      font-weight="900"
      fill="${accent}"
      letter-spacing="2"
    >
      DESCRIPTION
    </text>
  `;

  fit.lines.forEach(
    (line, index) => {
      svg += `
        <text
          x="${x + boxPadding + 8}"
          y="${
            y +
            boxPadding +
            42 +
            index *
              fit.lineHeight
          }"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${fit.fontSize}px"
          font-weight="600"
          fill="${textColor}"
        >
          ${escapeXml(line)}
        </text>
      `;
    }
  );

  return svg;
}

// ======================================================
// BENEFITS
// ======================================================

function getBenefits(
  fields
) {
  const benefits = [];

  if (
    cleanText(
      fields.activeIngredient
    )
  ) {
    benefits.push(
      `Active: ${cleanText(
        fields.activeIngredient
      )}`
    );
  }

  if (
    cleanText(
      fields.targetPests
    )
  ) {
    benefits.push(
      `Targets: ${cleanText(
        fields.targetPests
      )}`
    );
  }

  if (
    cleanText(
      fields.crops
    )
  ) {
    benefits.push(
      `Crops: ${cleanText(
        fields.crops
      )}`
    );
  }

  if (
    cleanText(
      fields.benefit1
    )
  ) {
    benefits.push(
      cleanText(
        fields.benefit1
      )
    );
  }

  if (
    cleanText(
      fields.benefit2
    )
  ) {
    benefits.push(
      cleanText(
        fields.benefit2
      )
    );
  }

  if (
    cleanText(
      fields.benefit3
    )
  ) {
    benefits.push(
      cleanText(
        fields.benefit3
      )
    );
  }

  if (
    cleanText(
      fields.benefit4
    )
  ) {
    benefits.push(
      cleanText(
        fields.benefit4
      )
    );
  }

  return benefits.slice(
    0,
    4
  );
}

// ======================================================
// BENEFITS BOX
// ======================================================

function drawBenefits(
  x,
  y,
  width,
  height,
  benefits,
  colors,
  textColor,
  accent
) {
  if (
    !benefits ||
    !benefits.length
  ) {
    return '';
  }

  const gap = 18;

  const columnW =
    (width - gap) / 2;

  const rowH =
    Math.max(
      62,
      (height - 16) / 2
    );

  let svg = `
    <text
      x="${x}"
      y="${y + 22}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="14px"
      font-weight="900"
      fill="${accent}"
      letter-spacing="2"
    >
      KEY BENEFITS
    </text>
  `;

  benefits.forEach(
    (benefit, index) => {
      const column =
        index % 2;

      const row =
        Math.floor(
          index / 2
        );

      const itemX =
        x +
        column *
          (columnW + gap);

      const itemY =
        y +
        38 +
        row *
          rowH;

      svg += `
        <rect
          x="${itemX}"
          y="${itemY}"
          width="${columnW}"
          height="${rowH - 10}"
          rx="18"
          fill="${colors.accentSoft}"
        />

        <circle
          cx="${itemX + 28}"
          cy="${itemY + 27}"
          r="14"
          fill="${accent}"
        />

        <text
          x="${itemX + 28}"
          y="${itemY + 33}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="18px"
          font-weight="900"
          fill="#FFFFFF"
          text-anchor="middle"
        >
          ✓
        </text>
      `;

      const lines =
        wrapText(
          benefit,
          columnW - 65,
          17
        );

      const limited =
        truncateLines(
          lines,
          2
        );

      limited.forEach(
        (line, lineIndex) => {
          svg += `
            <text
              x="${itemX + 52}"
              y="${
                itemY +
                25 +
                lineIndex * 21
              }"
              font-family="Arial, Helvetica, sans-serif"
              font-size="17px"
              font-weight="700"
              fill="${textColor}"
            >
              ${escapeXml(line)}
            </text>
          `;
        }
      );
    }
  );

  return svg;
}

// ======================================================
// USAGE BOX
// ======================================================

function drawUsageBox(
  x,
  y,
  width,
  height,
  usage,
  colors,
  textColor,
  accent,
  dark
) {
  if (!cleanText(usage)) {
    return '';
  }

  const padding = 28;

  const titleSize =
    height >= 230
      ? 17
      : 14;

  const availableHeight =
    height -
    padding * 2 -
    45;

  const fit =
    fitDescription(
      usage,
      width -
        padding * 2,
      availableHeight,
      height >= 300
        ? 27
        : 24,
      21
    );

  let svg = `
    <rect
      x="${x}"
      y="${y}"
      width="${width}"
      height="${height}"
      rx="26"
      fill="${dark
        ? colors.accentSoft
        : colors.panel}"
      stroke="${accent}"
      stroke-width="2"
    />

    <rect
      x="${x}"
      y="${y}"
      width="${width}"
      height="8"
      rx="4"
      fill="${accent}"
    />

    <text
      x="${x + padding}"
      y="${y + padding + 8}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${titleSize}px"
      font-weight="900"
      fill="${accent}"
      letter-spacing="2"
    >
      USAGE / MIXING INSTRUCTIONS
    </text>
  `;

  fit.lines.forEach(
    (line, index) => {
      svg += `
        <text
          x="${x + padding}"
          y="${
            y +
            padding +
            55 +
            index *
              fit.lineHeight
          }"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${fit.fontSize}px"
          font-weight="600"
          fill="${textColor}"
        >
          ${escapeXml(line)}
        </text>
      `;
    }
  );

  return svg;
}

// ======================================================
// PRICE / OFFER
// ======================================================

function drawPriceOffer(
  x,
  y,
  width,
  height,
  promoText,
  accent
) {
  if (!cleanText(promoText)) {
    return '';
  }

  return `
    <rect
      x="${x}"
      y="${y}"
      width="${width}"
      height="${height}"
      rx="24"
      fill="${accent}"
    />

    <text
      x="${x + 28}"
      y="${y + 35}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="14px"
      font-weight="800"
      fill="#FFFFFF"
      letter-spacing="2"
    >
      OFFER
    </text>

    <text
      x="${x + 28}"
      y="${y + 72}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${
        height >= 120
          ? 29
          : 24
      }px"
      font-weight="900"
      fill="#FFFFFF"
    >
      ${escapeXml(
        cleanText(
          promoText
        )
      )}
    </text>
  `;
}

// ======================================================
// MAIN CONTENT
// ======================================================

function drawContent(
  width,
  height,
  layout,
  template,
  colors,
  fields,
  theme
) {
  const dark =
    template ===
      'boldProduct' ||
    template ===
      'premiumAgri';

  const textColor =
    dark
      ? '#F5FFF5'
      : colors.text;

  const accent =
    colors.accent;

  const panel =
    colors.panel;

  const border =
    dark
      ? 'rgba(255,255,255,0.18)'
      : colors.border;

  const contentX =
    layout.contentX;

  const contentY =
    layout.contentY;

  const contentW =
    layout.contentW;

  const contentH =
    layout.contentH;

  const gap = 22;

  const p = 26;

  let svg = '';

  // ====================================================
  // MAIN CONTENT PANEL
  // ====================================================

  svg += `
    <rect
      x="${contentX}"
      y="${contentY}"
      width="${contentW}"
      height="${contentH}"
      rx="32"
      fill="${panel}"
      stroke="${border}"
      stroke-width="2"
    />
  `;

  // ====================================================
  // PRODUCT TITLE
  // ====================================================

  const titleAreaX =
    contentX + p;

  const titleAreaW =
    contentW -
    p * 2;

  const titleSize =
    height >= 1800
      ? 54
      : 46;

  const titleLines =
    truncateLines(
      wrapText(
        fields.productName,
        titleAreaW * 0.72,
        titleSize
      ),
      2
    );

  titleLines.forEach(
    (line, index) => {
      svg += `
        <text
          x="${titleAreaX}"
          y="${
            contentY +
            60 +
            index *
              titleSize *
              1.03
          }"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${titleSize}px"
          font-weight="900"
          fill="${dark
            ? '#FFFFFF'
            : textColor}"
        >
          ${escapeXml(line)}
        </text>
      `;
    }
  );

  const titleHeight =
    titleLines.length *
    titleSize *
    1.03;

  const imageY =
    contentY +
    titleHeight +
    82;

  // ====================================================
  // PRODUCT IMAGE CARD
  // ====================================================

  const imageX =
    contentX + p;

  const imageW =
    contentW -
    p * 2;

  const imageH =
    Math.round(
      contentH *
      (height >= 1800
        ? 0.31
        : 0.29)
    );

  svg += `
    <rect
      x="${imageX}"
      y="${imageY}"
      width="${imageW}"
      height="${imageH}"
      rx="28"
      fill="#FFFFFF"
      stroke="${rgba(
        theme,
        0.15
      )}"
      stroke-width="2"
    />

    <rect
      x="${imageX + 18}"
      y="${imageY + 18}"
      width="${imageW - 36}"
      height="${imageH - 36}"
      rx="22"
      fill="#FFFFFF"
    />

    <text
      x="${imageX + 30}"
      y="${imageY + 34}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="13px"
      font-weight="900"
      fill="${theme}"
      letter-spacing="2"
    >
      PRODUCT
    </text>
  `;

  // ====================================================
  // DESCRIPTION
  // ====================================================

  const descriptionY =
    imageY +
    imageH +
    gap;

  const descriptionH =
    Math.round(
      contentH *
      (height >= 1800
        ? 0.22
        : 0.21)
    );

  svg += drawDescriptionBox(
    imageX,
    descriptionY,
    imageW,
    descriptionH,
    fields.description,
    colors,
    textColor,
    accent,
    dark
  );

  // ====================================================
  // BENEFITS
  // ====================================================

  const benefits =
    getBenefits(fields);

  const benefitsY =
    descriptionY +
    descriptionH +
    gap;

  const benefitsH =
    Math.round(
      contentH *
      (height >= 1800
        ? 0.13
        : 0.15)
    );

  svg += drawBenefits(
    imageX,
    benefitsY,
    imageW,
    benefitsH,
    benefits,
    colors,
    textColor,
    accent
  );

  // ====================================================
  // USAGE
  // ====================================================

  const usageY =
    benefitsY +
    benefitsH +
    gap;

  const usageBottom =
    contentY +
    contentH -
    p;

  const usageH =
    Math.max(
      100,
      usageBottom -
      usageY
    );

  svg += drawUsageBox(
    imageX,
    usageY,
    imageW,
    usageH,
    fields.usage,
    colors,
    textColor,
    accent,
    dark
  );

  return svg;
}

// ======================================================
// FOOTER
// ======================================================

function drawFooter(
  width,
  height,
  layout,
  colors,
  phone,
  location,
  email
) {
  const footerY =
    layout.footerY;

  const footerH =
    height -
    footerY;

  let svg = `
    <rect
      x="0"
      y="${footerY}"
      width="${width}"
      height="${footerH}"
      fill="${colors.footer}"
    />
  `;

  const items = [];

  if (phone) {
    items.push({
      label: 'CALL',
      value: phone,
    });
  }

  if (phone) {
    items.push({
      label: 'WHATSAPP',
      value: phone,
    });
  }

  if (location) {
    items.push({
      label: 'LOCATION',
      value: location,
    });
  }

  if (email && items.length < 3) {
    items.push({
      label: 'EMAIL',
      value: email,
    });
  }

  const count =
    Math.max(
      1,
      items.length
    );

  const columnW =
    width / count;

  items.forEach(
    (item, index) => {
      const centerX =
        columnW *
        index +
        columnW / 2;

      svg += `
        <text
          x="${centerX}"
          y="${footerY + 34}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="12px"
          font-weight="900"
          fill="${colors.accent}"
          text-anchor="middle"
          letter-spacing="2"
        >
          ${escapeXml(
            item.label
          )}
        </text>
      `;

      const valueLines =
        wrapText(
          item.value,
          columnW - 50,
          17
        );

      const lines =
        truncateLines(
          valueLines,
          2
        );

      lines.forEach(
        (line, lineIndex) => {
          svg += `
            <text
              x="${centerX}"
              y="${
                footerY +
                62 +
                lineIndex *
                  21
              }"
              font-family="Arial, Helvetica, sans-serif"
              font-size="17px"
              font-weight="700"
              fill="${colors.text}"
              text-anchor="middle"
            >
              ${escapeXml(line)}
            </text>
          `;
        }
      );
    }
  );

  return svg;
}

// ======================================================
// TEST ROUTE
// ======================================================

router.get(
  '/test',
  (req, res) => {
    res.status(200).json({
      success: true,
      message:
        'Poster API is connected correctly.',
      route:
        '/api/poster/test',
      method: 'GET',
    });
  }
);

// ======================================================
// GENERATE POSTER
// ======================================================

router.post(
  '/generate',
  async (req, res) => {
    try {
      const {
        businessName,
        logo,
        themeColor,
        location,
        phone,
        email,

        productName,
        productImage,
        description,
        activeIngredient,
        targetPests,
        crops,
        usage,
        promoText,

        benefit1,
        benefit2,
        benefit3,
        benefit4,

        template,
        size,
      } = req.body || {};

      // ==================================================
      // NORMALIZE
      // ==================================================

      const finalBusinessName =
        cleanText(
          businessName
        );

      const finalProductName =
        cleanText(
          productName
        );

      const finalThemeColor =
        normalizeColor(
          themeColor
        );

      const requestedTemplate =
        cleanText(template);

      const finalTemplate =
        TEMPLATES.has(
          requestedTemplate
        )
          ? requestedTemplate
          : 'modernFarm';

      const requestedSize =
        cleanText(size);

      const finalSize =
        SIZES[requestedSize]
          ? requestedSize
          : 'square';

      // ==================================================
      // VALIDATION
      // ==================================================

      if (!finalBusinessName) {
        return res.status(400).json({
          success: false,
          message:
            'Business name is required.',
        });
      }

      if (!finalProductName) {
        return res.status(400).json({
          success: false,
          message:
            'Product name is required.',
        });
      }

      // ==================================================
      // DIMENSIONS
      // ==================================================

      const {
        width,
        height,
      } = SIZES[finalSize];

      const colors =
        templateColors(
          finalTemplate,
          finalThemeColor
        );

      const layout =
        layoutFor(
          finalSize,
          finalTemplate
        );

      console.log(
        '=========================================='
      );

      console.log(
        '📢 NEW PRODUCT POSTER GENERATION'
      );

      console.log(
        'Business:',
        finalBusinessName
      );

      console.log(
        'Product:',
        finalProductName
      );

      console.log(
        'Template:',
        finalTemplate
      );

      console.log(
        'Size:',
        finalSize
      );

      console.log(
        'Dimensions:',
        `${width}x${height}`
      );

      console.log(
        'Theme:',
        finalThemeColor
      );

      console.log(
        '=========================================='
      );

      // ==================================================
      // SVG
      //
      // IMPORTANT:
      // There is intentionally NO XML declaration here.
      // ==================================================

      let svg = `
        <svg
          width="${width}"
          height="${height}"
          viewBox="0 0 ${width} ${height}"
          xmlns="http://www.w3.org/2000/svg"
        >
      `;

      svg += `
        <defs>
          <filter
            id="posterShadow"
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
          >
            <feDropShadow
              dx="0"
              dy="5"
              stdDeviation="7"
              flood-opacity="0.14"
            />
          </filter>
        </defs>
      `;

      // ==================================================
      // BACKGROUND
      // ==================================================

      svg += backgroundSvg(
        width,
        height,
        finalTemplate,
        colors,
        finalThemeColor
      );

      // ==================================================
      // HEADER
      // ==================================================

      svg += drawHeader(
        width,
        height,
        layout,
        finalTemplate,
        colors,
        finalBusinessName,
        cleanText(location),
        cleanText(promoText)
      );

      // ==================================================
      // CONTENT
      // ==================================================

      svg += drawContent(
        width,
        height,
        layout,
        finalTemplate,
        colors,
        {
          productName:
            finalProductName,

          description:
            cleanText(
              description
            ),

          activeIngredient:
            cleanText(
              activeIngredient
            ),

          targetPests:
            cleanText(
              targetPests
            ),

          crops:
            cleanText(crops),

          usage:
            cleanText(usage),

          promoText:
            cleanText(
              promoText
            ),

          benefit1:
            cleanText(
              benefit1
            ),

          benefit2:
            cleanText(
              benefit2
            ),

          benefit3:
            cleanText(
              benefit3
            ),

          benefit4:
            cleanText(
              benefit4
            ),
        },
        finalThemeColor
      );

      // ==================================================
      // FOOTER
      // ==================================================

      svg += drawFooter(
        width,
        height,
        layout,
        colors,
        cleanText(phone),
        cleanText(location),
        cleanText(email)
      );

      svg += '</svg>';

      // ==================================================
      // CREATE BASE IMAGE
      // ==================================================

      let image =
        sharp(
          Buffer.from(svg)
        ).png();

      // ==================================================
      // LOGO
      // ==================================================

      const logoBuffer =
        dataUriToBuffer(
          logo
        );

      if (logoBuffer) {
        try {
          const logoBox =
            finalSize === 'story'
              ? 180
              : 150;

          const logoProcessed =
            await sharp(
              logoBuffer
            )
              .ensureAlpha()
              .resize(
                logoBox,
                logoBox,
                {
                  fit: 'contain',
                  background: {
                    r: 255,
                    g: 255,
                    b: 255,
                    alpha: 0,
                  },
                }
              )
              .png()
              .toBuffer();

          image =
            image.composite([
              {
                input:
                  logoProcessed,

                top:
                  layout.margin,

                left:
                  layout.margin,
              },
            ]);

        } catch (error) {
          console.log(
            '⚠️ Logo processing failed:',
            error.message
          );
        }
      }

      // ==================================================
      // PRODUCT IMAGE
      // ==================================================

      const productBuffer =
        dataUriToBuffer(
          productImage
        );

      if (productBuffer) {
        try {
          // ------------------------------------------------
          // Must match the SVG product card.
          // ------------------------------------------------

          const contentX =
            layout.contentX;

          const contentY =
            layout.contentY;

          const contentW =
            layout.contentW;

          const p = 26;

          const imageX =
            contentX + p;

          const imageW =
            contentW -
            p * 2;

          const titleSize =
            height >= 1800
              ? 54
              : 46;

          const titleLines =
            truncateLines(
              wrapText(
                finalProductName,
                imageW * 0.72,
                titleSize
              ),
              2
            );

          const titleHeight =
            titleLines.length *
            titleSize *
            1.03;

          const imageY =
            contentY +
            titleHeight +
            82;

          const imageH =
            Math.round(
              layout.contentH *
              (height >= 1800
                ? 0.31
                : 0.29)
            );

          // ------------------------------------------------
          // Actual usable image area.
          // ------------------------------------------------

          const innerPadding = 28;

          const productAreaW =
            Math.max(
              200,
              imageW -
              innerPadding * 2
            );

          const productAreaH =
            Math.max(
              200,
              imageH -
              innerPadding * 2
            );

          console.log(
            '📦 Processing product image...'
          );

          console.log(
            'Product area:',
            `${productAreaW}x${productAreaH}`
          );

          const processed =
            await processProductImage(
              productBuffer,
              productAreaW,
              productAreaH
            );

          const metadata =
            await sharp(
              processed
            ).metadata();

          const actualW =
            metadata.width ||
            productAreaW;

          const actualH =
            metadata.height ||
            productAreaH;

          const left =
            Math.round(
              imageX +
              innerPadding +
              (productAreaW -
                actualW) /
                2
            );

          const top =
            Math.round(
              imageY +
              innerPadding +
              (productAreaH -
                actualH) /
                2
            );

          image =
            image.composite([
              {
                input:
                  processed,

                top,

                left,
              },
            ]);

          console.log(
            '✅ Product image added'
          );

          console.log(
            'Final product:',
            `${actualW}x${actualH}`
          );

        } catch (error) {
          console.log(
            '⚠️ Product image processing failed:',
            error.message
          );
        }
      }

      // ==================================================
      // OUTPUT FILE
      // ==================================================

      const timestamp =
        Date.now();

      const filename =
        `${
          safeFileName(
            finalBusinessName
          ) ||
          'business'
        }-${
          safeFileName(
            finalProductName
          ) ||
          'product'
        }-${timestamp}.png`;

      const outputPath =
        path.join(
          OUTPUT_DIR,
          filename
        );

      // ==================================================
      // WRITE PNG
      // ==================================================

      await image
        .resize(
          width,
          height
        )
        .png({
          compressionLevel: 9,
          quality: 100,
        })
        .toFile(
          outputPath
        );

      // ==================================================
      // URL
      // ==================================================

      const baseUrl =
        `${req.protocol}://${req.get('host')}`;

      const posterUrl =
        `${baseUrl}/posters/${filename}`;

      console.log(
        '=========================================='
      );

      console.log(
        '✅ POSTER GENERATED SUCCESSFULLY'
      );

      console.log(
        '📁 File:',
        outputPath
      );

      console.log(
        '🌐 URL:',
        posterUrl
      );

      console.log(
        '=========================================='
      );

      // ==================================================
      // RESPONSE
      // ==================================================

      return res.json({
        success: true,

        message:
          'Product poster generated successfully.',

        posterUrl,

        filename,

        width,

        height,

        template:
          finalTemplate,

        size:
          finalSize,
      });

    } catch (error) {
      console.error(
        '❌ POSTER GENERATION ERROR:',
        error
      );

      return res.status(500).json({
        success: false,

        message:
          error?.message ||
          'Failed to generate poster.',

        error:
          error?.message ||
          'Failed to generate poster.',
      });
    }
  }
);

// ======================================================
// EXPORT
// ======================================================

module.exports = router;