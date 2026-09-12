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
  if (value === undefined || value === null) {
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
  const color = normalizeColor(hex).slice(1);

  return {
    r: parseInt(color.slice(0, 2), 16),
    g: parseInt(color.slice(2, 4), 16),
    b: parseInt(color.slice(4, 6), 16),
  };
}

function rgba(hex, alpha) {
  const rgb = hexToRgb(hex);

  return `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
}

// ======================================================
// TEXT WRAPPING
// ======================================================

function wrapText(text, width, fontSize) {
  const value = cleanText(text);

  if (!value) {
    return [];
  }

  const averageCharWidth = Math.max(
    fontSize * 0.52,
    7
  );

  const maxChars = Math.max(
    8,
    Math.floor(width / averageCharWidth)
  );

  const words = value.split(/\s+/);

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
          word.slice(i, i + maxChars)
        );
      }

      continue;
    }

    const candidate = line
      ? `${line} ${word}`
      : word;

    if (candidate.length <= maxChars) {
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

function truncateLines(lines, maxLines) {
  if (lines.length <= maxLines) {
    return lines;
  }

  const result = lines.slice(0, maxLines);

  result[maxLines - 1] =
    `${result[maxLines - 1]
      .replace(/[.,;:!?-]+$/, '')}…`;

  return result;
}

// ======================================================
// SVG TEXT BLOCK
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
    lineHeight = Math.round(fontSize * 1.35),
    maxLines = 4,
    anchor = 'start',
    family = 'Arial, Helvetica, sans-serif',
  } = options;

  const lines = truncateLines(
    wrapText(text, width, fontSize),
    maxLines
  );

  return lines
    .map(
      (line, index) => `
        <text
          x="${x}"
          y="${y + index * lineHeight}"
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

function dataUriToBuffer(dataUri) {
  if (!dataUri) {
    return null;
  }

  const match = String(dataUri).match(
    /^data:([^;]+);base64,(.+)$/s
  );

  if (!match) {
    return null;
  }

  try {
    return Buffer.from(match[2], 'base64');
  } catch (error) {
    console.log(
      '⚠️ Base64 conversion failed:',
      error.message
    );

    return null;
  }
}

// ======================================================
// REMOVE WHITE / VERY LIGHT BACKGROUND
//
// This is intended for normal product photos with a
// white/light background.
// ======================================================

async function removeProductBackground(inputBuffer) {
  try {
    const image = sharp(inputBuffer)
      .ensureAlpha();

    const metadata = await image.metadata();

    const width = metadata.width || 1000;
    const height = metadata.height || 1000;

    const raw = await image
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

      // Very bright pixels are probably white background.
      const brightness =
        (r + g + b) / 3;

      const maxChannel =
        Math.max(r, g, b);

      const minChannel =
        Math.min(r, g, b);

      const saturation =
        maxChannel - minChannel;

      // Strong white/light background detection.
      const isWhiteBackground =
        brightness >= 238 &&
        saturation <= 25;

      // Also remove very light gray background.
      const isLightGray =
        brightness >= 225 &&
        saturation <= 15;

      if (
        isWhiteBackground ||
        isLightGray
      ) {
        raw[i + 3] = 0;
      }
    }

    return await sharp(raw, {
      raw: {
        width,
        height,
        channels: 4,
      },
    })
      .png()
      .toBuffer();

  } catch (error) {
    console.log(
      '⚠️ Background removal failed:',
      error.message
    );

    // Return original image if removal fails.
    return inputBuffer;
  }
}

// ======================================================
// PRODUCT IMAGE PROCESSING
// ======================================================

async function processProductImage(
  inputBuffer,
  width,
  height
) {
  try {
    // First remove transparent/empty borders.
    const trimmed = await sharp(inputBuffer)
      .ensureAlpha()
      .trim({
        threshold: 18,
      })
      .png()
      .toBuffer();

    // Remove common white background.
    const backgroundRemoved =
      await removeProductBackground(trimmed);

    // Trim again after removing the background.
    const finalTrimmed = await sharp(
      backgroundRemoved
    )
      .ensureAlpha()
      .trim({
        threshold: 8,
      })
      .png()
      .toBuffer();

    // Resize while preserving transparency.
    return await sharp(finalTrimmed)
      .resize(width, height, {
        fit: 'contain',
        position: 'centre',
        withoutEnlargement: false,
      })
      .png()
      .toBuffer();

  } catch (error) {
    console.log(
      '⚠️ Product image processing failed:',
      error.message
    );

    return await sharp(inputBuffer)
      .resize(width, height, {
        fit: 'contain',
        position: 'centre',
      })
      .png()
      .toBuffer();
  }
}

// ======================================================
// LAYOUT
// ======================================================

function layoutFor(size, template) {
  const {
    width,
    height,
  } = SIZES[size];

  const margin = Math.round(
    Math.min(width, height) * 0.055
  );

  let headerH;

  if (size === 'story') {
    headerH = 285;
  } else if (size === 'landscape') {
    headerH = 205;
  } else {
    headerH = 230;
  }

  let footerH;

  if (size === 'story') {
    footerH = 135;
  } else if (size === 'landscape') {
    footerH = 105;
  } else {
    footerH = 105;
  }

  const contentY =
    headerH + 10;

  const contentBottom =
    height - footerH;

  const contentH =
    Math.max(
      320,
      contentBottom - contentY
    );

  let leftRatio = 0.55;

  if (template === 'productInfo') {
    leftRatio = 0.47;
  }

  if (template === 'minimal') {
    leftRatio = 0.53;
  }

  if (template === 'boldProduct') {
    leftRatio = 0.50;
  }

  if (size === 'landscape') {
    leftRatio =
      template === 'productInfo'
        ? 0.46
        : 0.54;
  }

  const gap = Math.round(
    Math.min(width, height) * 0.022
  );

  const innerW =
    width - margin * 2;

  const leftW =
    Math.round(
      (innerW - gap) * leftRatio
    );

  const rightW =
    innerW -
    gap -
    leftW;

  return {
    margin,
    headerH,
    footerH,
    contentY,
    contentH,

    leftX: margin,
    leftW,

    rightX:
      margin +
      leftW +
      gap,

    rightW,

    footerY:
      height - footerH,
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
    bg: '#F5F8F4',
    panel: '#FFFFFF',
    text: '#172017',
    muted: '#586158',
    accent: theme,
    accentSoft: rgba(theme, 0.10),
    border: '#DDE6DC',
    footer: rgba(theme, 0.10),
    white: '#FFFFFF',
  };

  if (template === 'boldProduct') {
    return {
      bg: theme,
      panel: '#FFFFFF',
      text: '#123016',
      muted: '#EAF5EA',
      accent: '#FFFFFF',
      accentSoft:
        'rgba(255,255,255,0.14)',
      border:
        'rgba(255,255,255,0.20)',
      footer:
        'rgba(0,0,0,0.20)',
      white: '#FFFFFF',
    };
  }

  if (template === 'premiumAgri') {
    return {
      bg: '#0E2613',
      panel: '#16371C',
      text: '#FFFFFF',
      muted: '#D7E8D9',
      accent: theme,
      accentSoft:
        rgba(theme, 0.16),
      border:
        rgba(theme, 0.40),
      footer: '#091A0D',
      white: '#FFFFFF',
    };
  }

  if (template === 'pestControl') {
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

  if (template === 'promotion') {
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

  if (template === 'productInfo') {
    return {
      bg: '#F3F7F3',
      panel: '#FFFFFF',
      text: '#1C281D',
      muted: '#5C675D',
      accent: theme,
      accentSoft: rgba(theme, 0.09),
      border: '#D7E1D7',
      footer: '#E8EFE8',
      white: '#FFFFFF',
    };
  }

  if (template === 'socialMedia') {
    return {
      bg: '#F0F7F1',
      panel: '#FFFFFF',
      text: '#17301B',
      muted: '#5D6B60',
      accent: theme,
      accentSoft: rgba(theme, 0.11),
      border: '#D5E4D7',
      footer: '#DFECE0',
      white: '#FFFFFF',
    };
  }

  if (template === 'minimal') {
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
// BACKGROUND SVG
// ======================================================

function backgroundSvg(
  width,
  height,
  template,
  colors,
  theme
) {
  let svg = '';

  svg += `
    <rect
      width="${width}"
      height="${height}"
      fill="${colors.bg}"
    />
  `;

  // ----------------------------------------------------
  // MODERN FARM
  // ----------------------------------------------------

  if (template === 'modernFarm') {
    svg += `
      <circle
        cx="${width * 0.90}"
        cy="${height * 0.12}"
        r="${Math.min(width, height) * 0.10}"
        fill="${theme}"
        opacity="0.10"
      />
    `;

    svg += `
      <path
        d="
          M0 ${height * 0.90}
          C${width * 0.18} ${height * 0.74},
           ${width * 0.36} ${height * 0.95},
           ${width * 0.56} ${height * 0.83}
          C${width * 0.75} ${height * 0.70},
           ${width * 0.88} ${height * 0.88},
           ${width} ${height * 0.77}
          V${height}
          H0
          Z
        "
        fill="${rgba(theme, 0.10)}"
      />
    `;
  }

  // ----------------------------------------------------
  // BOLD PRODUCT
  // ----------------------------------------------------

  if (template === 'boldProduct') {
    svg += `
      <circle
        cx="${width * 0.88}"
        cy="${height * 0.12}"
        r="${Math.min(width, height) * 0.25}"
        fill="#FFFFFF"
        opacity="0.10"
      />
    `;

    svg += `
      <circle
        cx="${width * 0.06}"
        cy="${height * 0.94}"
        r="${Math.min(width, height) * 0.20}"
        fill="#FFFFFF"
        opacity="0.08"
      />
    `;
  }

  // ----------------------------------------------------
  // PREMIUM
  // ----------------------------------------------------

  if (template === 'premiumAgri') {
    svg += `
      <rect
        x="22"
        y="22"
        width="${width - 44}"
        height="${height - 44}"
        rx="32"
        fill="none"
        stroke="${theme}"
        stroke-width="4"
        opacity="0.65"
      />
    `;

    svg += `
      <circle
        cx="${width - 75}"
        cy="75"
        r="18"
        fill="${theme}"
      />
    `;
  }

  // ----------------------------------------------------
  // PEST CONTROL
  // ----------------------------------------------------

  if (template === 'pestControl') {
    const topH =
      Math.round(height * 0.22);

    svg += `
      <rect
        x="0"
        y="0"
        width="${width}"
        height="${topH}"
        fill="${theme}"
      />
    `;

    svg += `
      <path
        d="
          M0 ${topH}
          Q${width * 0.25} ${topH - 45}
           ${width * 0.50} ${topH}
          T${width} ${topH}
          V0
          H0
          Z
        "
        fill="${theme}"
        opacity="0.92"
      />
    `;
  }

  // ----------------------------------------------------
  // PROMOTION
  // ----------------------------------------------------

  if (template === 'promotion') {
    const topH =
      Math.round(height * 0.20);

    svg += `
      <rect
        x="0"
        y="0"
        width="${width}"
        height="${topH}"
        fill="${theme}"
      />
    `;

    svg += `
      <circle
        cx="${width * 0.90}"
        cy="${height * 0.10}"
        r="${Math.min(width, height) * 0.15}"
        fill="#FFFFFF"
        opacity="0.12"
      />
    `;
  }

  // ----------------------------------------------------
  // PRODUCT INFO
  // ----------------------------------------------------

  if (template === 'productInfo') {
    const side =
      Math.round(width * 0.21);

    svg += `
      <rect
        x="0"
        y="0"
        width="${side}"
        height="${height}"
        fill="${theme}"
      />
    `;

    svg += `
      <rect
        x="${side}"
        y="0"
        width="14"
        height="${height}"
        fill="${rgba(theme, 0.12)}"
      />
    `;
  }

  // ----------------------------------------------------
  // SOCIAL MEDIA
  // ----------------------------------------------------

  if (template === 'socialMedia') {
    const topH =
      Math.round(height * 0.135);

    svg += `
      <rect
        x="0"
        y="0"
        width="${width}"
        height="${topH}"
        fill="${theme}"
      />
    `;

    svg += `
      <circle
        cx="${width * 0.92}"
        cy="${height * 0.07}"
        r="${Math.min(width, height) * 0.13}"
        fill="#FFFFFF"
        opacity="0.10"
      />
    `;
  }

  return svg;
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
  location
) {
  const x =
    layout.margin;

  let svg = '';

  const businessSize =
    height >= 1800
      ? 52
      : width >= 1800
        ? 48
        : 44;

  // ----------------------------------------------------
  // PRODUCT INFO
  // ----------------------------------------------------

  if (template === 'productInfo') {
    svg += `
      <text
        x="${x}"
        y="${layout.headerH * 0.52}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="24px"
        font-weight="900"
        fill="#FFFFFF"
        letter-spacing="1"
      >
        AGRIVENTURE
      </text>
    `;

    svg += `
      <text
        x="${x}"
        y="${layout.headerH * 0.52 + 40}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="15px"
        font-weight="700"
        fill="#E8F5E9"
        letter-spacing="2"
      >
        PRODUCT INFORMATION
      </text>
    `;

    return svg;
  }

  // ----------------------------------------------------
  // PEST CONTROL
  // ----------------------------------------------------

  if (template === 'pestControl') {
    svg += `
      <text
        x="${x}"
        y="55"
        font-family="Arial, Helvetica, sans-serif"
        font-size="16px"
        font-weight="900"
        fill="#FFFFFF"
        letter-spacing="3"
      >
        PEST CONTROL
      </text>
    `;

    svg += textBlock(
      businessName,
      x,
      112,
      width * 0.70,
      businessSize,
      '#FFFFFF',
      {
        weight: '900',
        maxLines: 2,
        lineHeight:
          businessSize * 1.05,
      }
    );

    if (location) {
      svg += textBlock(
        location,
        x,
        190,
        width * 0.62,
        18,
        '#F3FFF4',
        {
          maxLines: 1,
        }
      );
    }

    return svg;
  }

  // ----------------------------------------------------
  // PROMOTION
  // ----------------------------------------------------

  if (template === 'promotion') {
    svg += textBlock(
      businessName,
      x,
      115,
      width * 0.70,
      businessSize,
      '#FFFFFF',
      {
        weight: '900',
        maxLines: 2,
        lineHeight:
          businessSize * 1.05,
      }
    );

    if (location) {
      svg += textBlock(
        location,
        x,
        195,
        width * 0.60,
        18,
        '#FFFFFF',
        {
          maxLines: 1,
        }
      );
    }

    return svg;
  }

  // ----------------------------------------------------
  // DARK TEMPLATES
  // ----------------------------------------------------

  const dark =
    template === 'boldProduct' ||
    template === 'premiumAgri';

  const color =
    dark
      ? '#FFFFFF'
      : colors.text;

  const muted =
    dark
      ? '#DCEBDD'
      : colors.muted;

  const headerY =
    template === 'socialMedia'
      ? 100
      : layout.margin + businessSize;

  // Bigger company name.
  svg += textBlock(
    businessName,
    x,
    headerY,
    width * 0.70,
    businessSize,
    color,
    {
      weight: '900',
      maxLines: 2,
      lineHeight:
        businessSize * 1.05,
    }
  );

  if (location) {
    svg += textBlock(
      location,
      x,
      headerY +
        businessSize * 1.55,
      width * 0.62,
      18,
      muted,
      {
        maxLines: 1,
      }
    );
  }

  return svg;
}

// ======================================================
// FIELD BLOCK
// ======================================================

function fieldBlock(
  label,
  value,
  x,
  y,
  width,
  colors,
  options = {}
) {
  const {
    labelSize = 14,
    valueSize = 20,
    maxLines = 3,
    labelColor = colors.accent,
    valueColor = colors.text,
    lineGap = 25,
    valueLineHeight =
      Math.round(valueSize * 1.27),
  } = options;

  if (!cleanText(value)) {
    return {
      svg: '',
      height: 0,
    };
  }

  const lines =
    truncateLines(
      wrapText(
        value,
        width,
        valueSize
      ),
      maxLines
    );

  let svg = '';

  // Label.
  svg += `
    <text
      x="${x}"
      y="${y}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${labelSize}px"
      font-weight="900"
      fill="${labelColor}"
      letter-spacing="1"
    >
      ${escapeXml(label)}
    </text>
  `;

  // Value.
  lines.forEach(
    (line, index) => {
      svg += `
        <text
          x="${x}"
          y="${
            y +
            lineGap +
            index *
              valueLineHeight
          }"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${valueSize}px"
          font-weight="500"
          fill="${valueColor}"
        >
          ${escapeXml(line)}
        </text>
      `;
    }
  );

  const height =
    lineGap +
    lines.length *
      valueLineHeight +
    18;

  return {
    svg,
    height,
  };
}

// ======================================================
// CONTENT
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
  const {
    productName,
    description,
    activeIngredient,
    targetPests,
    crops,
    usage,
    promoText,
  } = fields;

  const dark =
    template === 'boldProduct' ||
    template === 'premiumAgri';

  const titleColor =
    dark
      ? '#FFFFFF'
      : colors.accent;

  const textColor =
    dark
      ? '#F3F8F3'
      : colors.text;

  const muted =
    dark
      ? '#DCEBDD'
      : colors.text;

  const border =
    dark
      ? 'rgba(255,255,255,0.18)'
      : colors.border;

  const panel =
    colors.panel;

  const p = 30;

  let svg = '';

  // ====================================================
  // PANELS
  // ====================================================

  svg += `
    <rect
      x="${layout.leftX}"
      y="${layout.contentY}"
      width="${layout.leftW}"
      height="${layout.contentH}"
      rx="28"
      fill="${panel}"
      stroke="${border}"
      stroke-width="2"
    />
  `;

  svg += `
    <rect
      x="${layout.rightX}"
      y="${layout.contentY}"
      width="${layout.rightW}"
      height="${layout.contentH}"
      rx="28"
      fill="${panel}"
      stroke="${border}"
      stroke-width="2"
    />
  `;

  // ====================================================
  // PRODUCT NAME
  // ====================================================

  const titleSize =
    height >= 1800
      ? 50
      : width >= 1800
        ? 48
        : 44;

  const detailWidth =
    layout.leftW -
    p * 2;

  const titleLines =
    truncateLines(
      wrapText(
        productName,
        detailWidth,
        titleSize
      ),
      3
    );

  titleLines.forEach(
    (line, index) => {
      svg += `
        <text
          x="${layout.leftX + p}"
          y="${
            layout.contentY +
            62 +
            index *
              titleSize *
              1.06
          }"
          font-family="Arial, Helvetica, sans-serif"
          font-size="${titleSize}px"
          font-weight="900"
          fill="${titleColor}"
        >
          ${escapeXml(line)}
        </text>
      `;
    }
  );

  // ====================================================
  // CONTENT HEIGHT
  // ====================================================

  const titleHeight =
    titleLines.length *
    titleSize *
    1.06;

  let y =
    layout.contentY +
    62 +
    titleHeight +
    24;

  // ====================================================
  // DESCRIPTION
  //
  // DESCRIPTION GETS MORE SPACE.
  // ====================================================

  if (description) {
    const descriptionSize =
      height >= 1800
        ? 23
        : 21;

    const descriptionLines =
      height >= 1800
        ? 6
        : 5;

    const result =
      fieldBlock(
        'DESCRIPTION',
        description,
        layout.leftX + p,
        y,
        detailWidth,
        colors,
        {
          labelSize:
            height >= 1800
              ? 15
              : 14,

          valueSize:
            descriptionSize,

          maxLines:
            descriptionLines,

          labelColor:
            titleColor,

          valueColor:
            textColor,

          lineGap: 27,

          valueLineHeight:
            Math.round(
              descriptionSize * 1.28
            ),
        }
      );

    svg += result.svg;

    y += result.height + 8;
  }

  // ====================================================
  // ACTIVE INGREDIENT
  // ====================================================

  if (activeIngredient) {
    const result =
      fieldBlock(
        'ACTIVE INGREDIENT',
        activeIngredient,
        layout.leftX + p,
        y,
        detailWidth,
        colors,
        {
          labelSize: 13,
          valueSize:
            height >= 1800
              ? 20
              : 18,
          maxLines: 2,
          labelColor: titleColor,
          valueColor: textColor,
          lineGap: 23,
        }
      );

    svg += result.svg;

    y += result.height + 5;
  }

  // ====================================================
  // TARGETS
  // ====================================================

  if (targetPests) {
    const result =
      fieldBlock(
        'TARGET PESTS / DISEASES',
        targetPests,
        layout.leftX + p,
        y,
        detailWidth,
        colors,
        {
          labelSize: 13,
          valueSize:
            height >= 1800
              ? 20
              : 18,
          maxLines: 2,
          labelColor: titleColor,
          valueColor: textColor,
          lineGap: 23,
        }
      );

    svg += result.svg;

    y += result.height + 5;
  }

  // ====================================================
  // CROPS
  // ====================================================

  if (crops) {
    const result =
      fieldBlock(
        'TARGET CROPS',
        crops,
        layout.leftX + p,
        y,
        detailWidth,
        colors,
        {
          labelSize: 13,
          valueSize:
            height >= 1800
              ? 20
              : 18,
          maxLines: 2,
          labelColor: titleColor,
          valueColor: textColor,
          lineGap: 23,
        }
      );

    svg += result.svg;

    y += result.height + 5;
  }

  // ====================================================
  // USAGE
  //
  // USAGE USES THE LOWER PART OF THE PANEL.
  // ====================================================

  if (usage) {
    const usageY =
      Math.min(
        y,
        layout.contentY +
          layout.contentH -
          205
      );

    const usageSize =
      height >= 1800
        ? 21
        : 19;

    const usageLines =
      height >= 1800
        ? 5
        : 4;

    const result =
      fieldBlock(
        'USAGE / APPLICATION',
        usage,
        layout.leftX + p,
        usageY,
        detailWidth,
        colors,
        {
          labelSize: 14,
          valueSize: usageSize,
          maxLines: usageLines,
          labelColor: titleColor,
          valueColor: textColor,
          lineGap: 25,
          valueLineHeight:
            Math.round(
              usageSize * 1.28
            ),
        }
      );

    svg += result.svg;
  }

  // ====================================================
  // PRODUCT IMAGE CARD
  // ====================================================

  const imagePad = 22;

  const imageCardX =
    layout.rightX +
    imagePad;

  const imageCardY =
    layout.contentY +
    imagePad;

  const imageCardW =
    layout.rightW -
    imagePad * 2;

  const imageCardH =
    Math.round(
      layout.contentH * 0.70
    );

  svg += `
    <rect
      x="${imageCardX}"
      y="${imageCardY}"
      width="${imageCardW}"
      height="${imageCardH}"
      rx="24"
      fill="#FFFFFF"
      stroke="${rgba(theme, 0.10)}"
      stroke-width="2"
    />
  `;

  // Small product label.
  svg += `
    <text
      x="${imageCardX + 22}"
      y="${imageCardY + 34}"
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
  // PRODUCT IMAGE AREA
  // ====================================================

  const imageAreaTop =
    imageCardY + 48;

  const imageAreaHeight =
    imageCardH - 58;

  // Invisible SVG placeholder.
  // Actual transparent product image is composited
  // later by Sharp.
  svg += `
    <rect
      x="${imageCardX + 8}"
      y="${imageAreaTop}"
      width="${imageCardW - 16}"
      height="${imageAreaHeight}"
      fill="#FFFFFF"
      opacity="0"
    />
  `;

  // ====================================================
  // LOWER RIGHT INFORMATION
  // ====================================================

  const infoY =
    imageCardY +
    imageCardH +
    34;

  if (promoText) {
    const promoH =
      Math.min(
        125,
        Math.max(
          88,
          layout.contentH * 0.16
        )
      );

    const promoY =
      Math.min(
        infoY,
        layout.contentY +
          layout.contentH -
          promoH -
          18
      );

    svg += `
      <rect
        x="${layout.rightX + 18}"
        y="${promoY}"
        width="${layout.rightW - 36}"
        height="${promoH}"
        rx="20"
        fill="${theme}"
      />
    `;

    svg += textBlock(
      promoText,
      layout.rightX + 36,
      promoY + 38,
      layout.rightW - 72,
      22,
      '#FFFFFF',
      {
        weight: '900',
        maxLines: 3,
        lineHeight: 29,
      }
    );
  }

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

        template,
        size,
      } = req.body || {};

      // ==================================================
      // NORMALIZE INPUT
      // ==================================================

      const finalBusinessName =
        cleanText(businessName);

      const finalProductName =
        cleanText(productName);

      const finalThemeColor =
        normalizeColor(themeColor);

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
        '📢 PRODUCT POSTER GENERATION'
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
      // Do NOT put an XML declaration before <svg>.
      // This avoids the GLib/XML declaration error.
      // ==================================================

      let svg = `
        <svg
          width="${width}"
          height="${height}"
          viewBox="0 0 ${width} ${height}"
          xmlns="http://www.w3.org/2000/svg"
        >
      `;

      svg += '<defs>';

      svg += `
        <filter
          id="shadow"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feDropShadow
            dx="0"
            dy="6"
            stdDeviation="8"
            flood-opacity="0.16"
          />
        </filter>
      `;

      svg += '</defs>';

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
        cleanText(location)
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
            cleanText(description),

          activeIngredient:
            cleanText(activeIngredient),

          targetPests:
            cleanText(targetPests),

          crops:
            cleanText(crops),

          usage:
            cleanText(usage),

          promoText:
            cleanText(promoText),
        },
        finalThemeColor
      );

      // ==================================================
      // FOOTER
      // ==================================================

      const footerY =
        layout.footerY;

      svg += `
        <rect
          x="0"
          y="${footerY}"
          width="${width}"
          height="${height - footerY}"
          fill="${colors.footer}"
        />
      `;

      const contacts = [];

      if (cleanText(phone)) {
        contacts.push(
          `Tel: ${cleanText(phone)}`
        );
      }

      if (cleanText(email)) {
        contacts.push(
          `Email: ${cleanText(email)}`
        );
      }

      if (contacts.length) {
        svg += textBlock(
          contacts.join(
            '   •   '
          ),
          width / 2,
          footerY + 42,
          width -
            layout.margin * 2,
          18,
          colors.text,
          {
            weight: '700',
            maxLines: 2,
            lineHeight: 25,
            anchor: 'middle',
          }
        );
      }

      svg += `
        <text
          x="${width / 2}"
          y="${height - 18}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="12px"
          font-weight="600"
          fill="${colors.muted}"
          text-anchor="middle"
        >
          Agricultural Product
        </text>
      `;

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
        dataUriToBuffer(logo);

      if (logoBuffer) {
        try {
          const logoBox =
            finalSize === 'story'
              ? 165
              : 140;

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
                  width -
                  layout.margin -
                  logoBox,
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
      //
      // BIGGER THAN THE OLD VERSION.
      // BACKGROUND IS REMOVED.
      // ==================================================

      const productBuffer =
        dataUriToBuffer(
          productImage
        );

      if (productBuffer) {
        try {
          const imagePad = 22;

          const cardW =
            Math.max(
              200,
              layout.rightW -
                imagePad * 2 -
                16
            );

          const imageCardH =
            Math.round(
              layout.contentH * 0.70
            );

          const cardH =
            Math.max(
              240,
              imageCardH - 58
            );

          console.log(
            '📦 Processing product image...'
          );

          console.log(
            'Product image area:',
            `${cardW}x${cardH}`
          );

          const processed =
            await processProductImage(
              productBuffer,
              cardW,
              cardH
            );

          const metadata =
            await sharp(
              processed
            ).metadata();

          const actualW =
            metadata.width ||
            cardW;

          const actualH =
            metadata.height ||
            cardH;

          // Center product image in card.
          const left =
            Math.round(
              layout.rightX +
              imagePad +
              8 +
              (cardW -
                actualW) /
                2
            );

          const top =
            Math.round(
              layout.contentY +
              imagePad +
              48 +
              (cardH -
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
            '✅ Product image processed'
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