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
// TEXT HELPERS
// ======================================================

function cleanText(value) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim();
}


function escapeXml(value) {
  return cleanText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}


function safeFileName(value) {
  return cleanText(value)
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}


// ======================================================
// COLOUR HELPERS
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

  const namedColors = {
    green: '#2E7D32',
    darkgreen: '#1B5E20',
    'dark-green': '#1B5E20',
    lightgreen: '#8BC34A',
    'light-green': '#8BC34A',
    yellow: '#F9A825',
    orange: '#FF8F00',
    red: '#D32F2F',
    black: '#000000',
    white: '#FFFFFF',
    blue: '#1976D2',
    brown: '#795548',
    purple: '#7B1FA2',
    teal: '#00897B',
  };

  const named = namedColors[color.toLowerCase()];

  if (named) {
    return named;
  }

  return '#2E7D32';
}


function hexToRgb(hex) {
  const c = normalizeColor(hex).slice(1);

  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}


function rgba(hex, alpha) {
  const c = hexToRgb(hex);

  return `rgba(${c.r},${c.g},${c.b},${alpha})`;
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
    fontSize * 0.53,
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


function truncateLines(lines, maxLines) {
  if (lines.length <= maxLines) {
    return lines;
  }

  if (maxLines <= 0) {
    return [];
  }

  const result = lines.slice(0, maxLines);

  result[maxLines - 1] =
    `${result[maxLines - 1]
      .replace(/[.,;:!?-]+$/, '')}…`;

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
    lineHeight = Math.round(fontSize * 1.35),
    maxLines = 4,
    anchor = 'start',
    family = 'Arial, Helvetica, sans-serif',
    letterSpacing = 0,
  } = options;

  const lines = truncateLines(
    wrapText(text, width, fontSize),
    maxLines
  );

  return lines
    .map((line, i) => `
      <text
        x="${x}"
        y="${y + i * lineHeight}"
        font-family="${family}"
        font-size="${fontSize}px"
        font-weight="${weight}"
        fill="${fill}"
        text-anchor="${anchor}"
        letter-spacing="${letterSpacing}px"
      >
        ${escapeXml(line)}
      </text>
    `)
    .join('');
}


// ======================================================
// BASE64 IMAGE CONVERTER
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
// ARRAY / BENEFIT NORMALIZER
// ======================================================

function normalizeList(value) {

  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map(item => cleanText(item))
      .filter(Boolean)
      .slice(0, 4);
  }

  return cleanText(value)
    .split(/\n|,/)
    .map(item => cleanText(item))
    .filter(Boolean)
    .slice(0, 4);
}


// ======================================================
// REMOVE WHITE BACKGROUND
// ======================================================

async function removeWhiteBackground(buffer) {

  const image =
    sharp(buffer)
      .ensureAlpha();

  const metadata =
    await image.metadata();

  if (
    !metadata.width ||
    !metadata.height
  ) {
    return buffer;
  }

  const { data, info } =
    await image
      .raw()
      .toBuffer({
        resolveWithObject: true,
      });

  for (
    let i = 0;
    i < data.length;
    i += info.channels
  ) {

    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    const max =
      Math.max(r, g, b);

    const min =
      Math.min(r, g, b);

    const brightness =
      (r + g + b) / 3;

    const difference =
      max - min;

    /*
     * Strong white background.
     */
    if (
      brightness >= 245 &&
      difference <= 18
    ) {

      data[i + 3] = 0;

    }

    /*
     * Softer white background.
     */
    else if (
      brightness >= 228 &&
      difference <= 24
    ) {

      const alpha =
        Math.round(
          ((245 - brightness) / 17) * 255
        );

      data[i + 3] =
        Math.max(
          0,
          Math.min(
            255,
            alpha
          )
        );
    }
  }

  return sharp(
    data,
    {
      raw: {
        width: info.width,
        height: info.height,
        channels: 4,
      },
    }
  )
    .trim({
      background: {
        r: 255,
        g: 255,
        b: 255,
        alpha: 0,
      },
      threshold: 8,
    })
    .png()
    .toBuffer();
}


// ======================================================
// PRODUCT IMAGE PROCESSING
// ======================================================

async function processProductImage(
  buffer,
  width,
  height
) {

  let transparent =
    await removeWhiteBackground(buffer);

  /*
   * Trim transparent / empty edges.
   */
  try {

    transparent =
      await sharp(transparent)
        .trim({
          background: {
            r: 0,
            g: 0,
            b: 0,
            alpha: 0,
          },
          threshold: 5,
        })
        .png()
        .toBuffer();

  } catch (error) {

    console.log(
      '⚠️ Transparent trim skipped:',
      error.message
    );
  }

  /*
   * Give the product almost the entire
   * image area.
   */
  return sharp(transparent)
    .resize(
      width,
      height,
      {
        fit: 'contain',
        position: 'centre',
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
}


// ======================================================
// LAYOUT
// ======================================================

function layoutFor(size) {

  const {
    width,
    height,
  } = SIZES[size];

  const shortest =
    Math.min(width, height);

  const margin =
    Math.round(shortest * 0.055);

  /*
   * Footer.
   */
  const footerH =
    size === 'story'
      ? 145
      : size === 'landscape'
        ? 125
        : 120;

  /*
   * Header.
   */
  const headerH =
    size === 'story'
      ? 275
      : size === 'landscape'
        ? 220
        : 225;

  /*
   * Content begins after header.
   */
  const contentY =
    headerH;

  const contentBottom =
    height - footerH;

  const contentH =
    Math.max(
      400,
      contentBottom - contentY
    );

  return {
    margin,
    headerH,
    footerH,
    contentY,
    contentBottom,
    contentH,
    footerY: height - footerH,
  };
}


// ======================================================
// TEMPLATE COLOURS
// ======================================================

function templateColors(
  template,
  theme
) {

  const light = {

    bg: '#F5F8F4',

    panel: '#FFFFFF',

    text: '#182018',

    muted: '#657065',

    accent: theme,

    accentSoft:
      rgba(theme, 0.10),

    border: '#DDE6DD',

    footer:
      rgba(theme, 0.12),

    white: '#FFFFFF',
  };


  if (template === 'boldProduct') {

    return {
      ...light,

      bg: theme,

      panel: '#FFFFFF',

      text: '#173019',

      muted: '#E7F3E8',

      accent: '#FFFFFF',

      accentSoft:
        'rgba(255,255,255,0.13)',

      border:
        'rgba(255,255,255,0.18)',

      footer:
        'rgba(0,0,0,0.22)',

      white: '#FFFFFF',
    };
  }


  if (template === 'premiumAgri') {

    return {
      ...light,

      bg: '#102A16',

      panel: '#17391E',

      text: '#FFFFFF',

      muted: '#D8E9DA',

      accent: theme,

      accentSoft:
        rgba(theme, 0.17),

      border:
        rgba(theme, 0.40),

      footer: '#0A1E0E',

      white: '#FFFFFF',
    };
  }


  if (template === 'pestControl') {

    return {
      ...light,

      bg: '#FFF8ED',

      panel: '#FFFFFF',

      text: '#302719',

      muted: '#70675B',

      accent: theme,

      accentSoft: '#FFF0D5',

      border: '#E8D7B7',

      footer: '#F6E5C8',
    };
  }


  if (template === 'promotion') {

    return {
      ...light,

      bg: '#FFFDF7',

      panel: '#FFFFFF',

      text: '#25251F',

      muted: '#6D6A60',

      accent: theme,

      accentSoft: '#FFF1D1',

      border: '#E6DEC8',

      footer: '#F4EACF',
    };
  }


  if (template === 'socialMedia') {

    return {
      ...light,

      bg: '#F1F7F1',

      panel: '#FFFFFF',

      text: '#17301B',

      muted: '#5D6A60',

      accent: theme,

      accentSoft:
        rgba(theme, 0.11),

      border: '#D7E5D8',

      footer: '#E0EEE1',
    };
  }


  if (template === 'minimal') {

    return {
      ...light,

      bg: '#FFFFFF',

      panel: '#FFFFFF',

      text: '#171A17',

      muted: '#666B66',

      accent: theme,

      accentSoft: '#F1F3F1',

      border: '#E1E5E1',

      footer: '#F5F6F5',
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
      x="0"
      y="0"
      width="${width}"
      height="${height}"
      fill="${colors.bg}"
    />
  `;


  /*
   * Large soft background shape.
   */
  svg += `
    <circle
      cx="${width * 0.94}"
      cy="${height * 0.08}"
      r="${Math.min(width, height) * 0.22}"
      fill="${theme}"
      opacity="0.06"
    />
  `;


  if (template === 'boldProduct') {

    svg += `
      <circle
        cx="${width * 0.90}"
        cy="${height * 0.12}"
        r="${Math.min(width, height) * 0.27}"
        fill="#FFFFFF"
        opacity="0.10"
      />

      <circle
        cx="${width * 0.04}"
        cy="${height * 0.90}"
        r="${Math.min(width, height) * 0.22}"
        fill="#FFFFFF"
        opacity="0.07"
      />
    `;
  }


  if (template === 'premiumAgri') {

    svg += `
      <rect
        x="22"
        y="22"
        width="${width - 44}"
        height="${height - 44}"
        rx="28"
        fill="none"
        stroke="${theme}"
        stroke-width="4"
        opacity="0.55"
      />
    `;
  }


  if (template === 'pestControl') {

    svg += `
      <circle
        cx="${width * 0.90}"
        cy="${height * 0.10}"
        r="${Math.min(width, height) * 0.18}"
        fill="${theme}"
        opacity="0.08"
      />
    `;
  }


  if (template === 'promotion') {

    svg += `
      <circle
        cx="${width * 0.90}"
        cy="${height * 0.12}"
        r="${Math.min(width, height) * 0.18}"
        fill="${theme}"
        opacity="0.08"
      />
    `;
  }


  if (template === 'socialMedia') {

    svg += `
      <circle
        cx="${width * 0.92}"
        cy="${height * 0.10}"
        r="${Math.min(width, height) * 0.16}"
        fill="${theme}"
        opacity="0.08"
      />
    `;
  }


  if (template === 'modernFarm') {

    svg += `
      <path
        d="
          M0 ${height * 0.86}
          C ${width * .18} ${height * .76},
            ${width * .36} ${height * .93},
            ${width * .55} ${height * .83}
          C ${width * .74} ${height * .72},
            ${width * .88} ${height * .88},
            ${width} ${height * .78}
          V${height}
          H0Z
        "
        fill="${rgba(theme, 0.08)}"
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
  location,
  promoText
) {

  const dark =
    template === 'boldProduct' ||
    template === 'premiumAgri';

  const textColor =
    dark
      ? '#FFFFFF'
      : colors.text;

  const mutedColor =
    dark
      ? '#DCEBDD'
      : colors.muted;

  const margin =
    layout.margin;

  const businessSize =
    height >= 1800
      ? 62
      : width >= 1800
        ? 58
        : 52;

  let svg = '';


  // ====================================================
  // SMALL BRAND LINE
  // ====================================================

  svg += `
    <rect
      x="${margin}"
      y="${margin - 12}"
      width="78"
      height="7"
      rx="3.5"
      fill="${colors.accent}"
    />
  `;


  // ====================================================
  // BUSINESS NAME
  // ====================================================

  svg += textBlock(
    businessName,
    margin,
    margin + businessSize,
    width * 0.62,
    businessSize,
    textColor,
    {
      weight: '900',
      maxLines: 2,
      lineHeight:
        Math.round(
          businessSize * 1.0
        ),
      family:
        'Trebuchet MS, Arial, Helvetica, sans-serif',
      letterSpacing: 0.2,
    }
  );


  // ====================================================
  // LOCATION
  // ====================================================

  if (location) {

    svg += textBlock(
      location,
      margin,
      margin +
        businessSize * 2.05,
      width * 0.50,
      18,
      mutedColor,
      {
        weight: '600',
        maxLines: 1,
      }
    );
  }


  // ====================================================
  // OFFER BADGE TOP RIGHT
  // ====================================================

  if (promoText) {

    const badgeW =
      Math.min(
        260,
        width * 0.25
      );

    const badgeH =
      height >= 1800
        ? 94
        : 82;

    const badgeX =
      width -
      margin -
      badgeW;

    const badgeY =
      margin - 4;


    svg += `
      <g filter="url(#shadow)">

        <rect
          x="${badgeX}"
          y="${badgeY}"
          width="${badgeW}"
          height="${badgeH}"
          rx="${badgeH / 2}"
          fill="${colors.accent}"
        />

        <circle
          cx="${badgeX + 34}"
          cy="${badgeY + badgeH / 2}"
          r="21"
          fill="#FFFFFF"
          opacity="0.20"
        />

        <text
          x="${badgeX + 34}"
          y="${badgeY + badgeH / 2 + 7}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="20px"
          font-weight="900"
          fill="#FFFFFF"
          text-anchor="middle"
        >
          %
        </text>

      </g>
    `;


    svg += textBlock(
      promoText,
      badgeX + 66,
      badgeY + 35,
      badgeW - 80,
      17,
      '#FFFFFF',
      {
        weight: '900',
        maxLines: 2,
        lineHeight: 21,
      }
    );
  }


  // ====================================================
  // SEPARATOR
  // ====================================================

  svg += `
    <line
      x1="${margin}"
      y1="${layout.headerH - 20}"
      x2="${width - margin}"
      y2="${layout.headerH - 20}"
      stroke="${dark
        ? 'rgba(255,255,255,0.16)'
        : colors.border}"
      stroke-width="2"
    />
  `;


  return svg;
}


// ======================================================
// PRODUCT TITLE
// ======================================================

function drawProductTitle(
  width,
  y,
  productName,
  colors,
  dark
) {

  const titleColor =
    dark
      ? '#FFFFFF'
      : colors.text;

  const accentColor =
    dark
      ? colors.accent
      : colors.accent;

  const titleSize =
    width >= 1800
      ? 54
      : 48;

  let svg = '';


  svg += `
    <rect
      x="${width * 0.055}"
      y="${y - 18}"
      width="10"
      height="70"
      rx="5"
      fill="${accentColor}"
    />
  `;


  svg += textBlock(
    productName,
    width * 0.075,
    y + 30,
    width * 0.84,
    titleSize,
    titleColor,
    {
      weight: '900',
      maxLines: 2,
      lineHeight:
        Math.round(titleSize * 1.03),
      family:
        'Trebuchet MS, Arial, Helvetica, sans-serif',
    }
  );


  return svg;
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
  dark
) {

  const headingColor =
    dark
      ? colors.accent
      : colors.accent;

  const bodyColor =
    dark
      ? '#F1F8F2'
      : colors.text;

  let svg = '';


  svg += `
    <rect
      x="${x}"
      y="${y}"
      width="${width}"
      height="${height}"
      rx="24"
      fill="${dark
        ? 'rgba(255,255,255,0.08)'
        : '#FFFFFF'}"
      stroke="${dark
        ? 'rgba(255,255,255,0.16)'
        : colors.border}"
      stroke-width="2"
      filter="url(#softShadow)"
    />

    <rect
      x="${x}"
      y="${y}"
      width="9"
      height="${height}"
      rx="4.5"
      fill="${colors.accent}"
    />

    <text
      x="${x + 28}"
      y="${y + 38}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="15px"
      font-weight="900"
      fill="${headingColor}"
      letter-spacing="1.5px"
    >
      DESCRIPTION
    </text>
  `;


  if (description) {

    svg += textBlock(
      description,
      x + 28,
      y + 78,
      width - 56,
      24,
      bodyColor,
      {
        weight: '500',
        maxLines: 6,
        lineHeight: 33,
      }
    );

  } else {

    svg += textBlock(
      'Product information',
      x + 28,
      y + 78,
      width - 56,
      24,
      bodyColor,
      {
        weight: '500',
        maxLines: 1,
      }
    );
  }


  return svg;
}


// ======================================================
// BENEFIT / INFORMATION CARD
// ======================================================

function benefitCard(
  x,
  y,
  width,
  height,
  text,
  colors,
  dark
) {

  const bodyColor =
    dark
      ? '#FFFFFF'
      : colors.text;

  const cardFill =
    dark
      ? 'rgba(255,255,255,0.08)'
      : '#FFFFFF';

  const cardBorder =
    dark
      ? 'rgba(255,255,255,0.15)'
      : colors.border;

  const circleX =
    x + 25;

  const circleY =
    y + height / 2;


  let svg = `
    <rect
      x="${x}"
      y="${y}"
      width="${width}"
      height="${height}"
      rx="18"
      fill="${cardFill}"
      stroke="${cardBorder}"
      stroke-width="2"
    />

    <circle
      cx="${circleX}"
      cy="${circleY}"
      r="15"
      fill="${colors.accent}"
    />

    <path
      d="
        M ${circleX - 7} ${circleY}
        L ${circleX - 2} ${circleY + 5}
        L ${circleX + 8} ${circleY - 7}
      "
      fill="none"
      stroke="#FFFFFF"
      stroke-width="4"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  `;


  svg += textBlock(
    text,
    x + 50,
    y + height / 2 + 7,
    width - 68,
    17,
    bodyColor,
    {
      weight: '700',
      maxLines: 2,
      lineHeight: 20,
    }
  );


  return svg;
}


// ======================================================
// BENEFITS SECTION
// ======================================================

function drawBenefits(
  x,
  y,
  width,
  height,
  benefits,
  colors,
  dark
) {

  if (!benefits.length) {
    return '';
  }

  let svg = '';


  svg += `
    <text
      x="${x}"
      y="${y + 18}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="14px"
      font-weight="900"
      fill="${dark ? colors.accent : colors.accent}"
      letter-spacing="1.4px"
    >
      KEY INFORMATION
    </text>
  `;


  const gap = 14;

  const cardW =
    (width - gap) / 2;

  const cardH =
    (height - 14) / 2;


  const items = benefits.slice(0, 4);


  const positions = [
    [x, y + 32],
    [x + cardW + gap, y + 32],
    [x, y + 32 + cardH + gap],
    [x + cardW + gap, y + 32 + cardH + gap],
  ];


  items.forEach((item, index) => {

    const [cardX, cardY] =
      positions[index];

    svg += benefitCard(
      cardX,
      cardY,
      cardW,
      cardH,
      item,
      colors,
      dark
    );
  });


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
  dark
) {

  if (!usage) {
    return '';
  }


  const headingColor =
    dark
      ? colors.accent
      : colors.accent;

  const bodyColor =
    dark
      ? '#F4FAF4'
      : colors.text;


  let svg = `

    <rect
      x="${x}"
      y="${y}"
      width="${width}"
      height="${height}"
      rx="24"
      fill="${dark
        ? 'rgba(255,255,255,0.08)'
        : colors.accentSoft}"
      stroke="${dark
        ? 'rgba(255,255,255,0.15)'
        : rgba(colors.accent, 0.18)}"
      stroke-width="2"
    />

    <rect
      x="${x + 18}"
      y="${y + 18}"
      width="7"
      height="${height - 36}"
      rx="3.5"
      fill="${colors.accent}"
    />

    <text
      x="${x + 42}"
      y="${y + 40}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="15px"
      font-weight="900"
      fill="${headingColor}"
      letter-spacing="1.5px"
    >
      USAGE / MIXING
    </text>
  `;


  svg += textBlock(
    usage,
    x + 42,
    y + 76,
    width - 72,
    21,
    bodyColor,
    {
      weight: '600',
      maxLines: 6,
      lineHeight: 28,
    }
  );


  return svg;
}


// ======================================================
// OFFER / PRICE BOX
// ======================================================

function drawOfferBox(
  x,
  y,
  width,
  height,
  price,
  promoText,
  colors,
  dark
) {

  const offerText =
    cleanText(price) ||
    cleanText(promoText);

  if (!offerText) {
    return '';
  }


  const bodyColor =
    dark
      ? '#FFFFFF'
      : colors.text;


  let svg = `

    <rect
      x="${x}"
      y="${y}"
      width="${width}"
      height="${height}"
      rx="24"
      fill="${colors.accent}"
      filter="url(#softShadow)"
    />

    <text
      x="${x + 28}"
      y="${y + 31}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="13px"
      font-weight="900"
      fill="#FFFFFF"
      opacity="0.85"
      letter-spacing="1.3px"
    >
      PRICE / OFFER
    </text>
  `;


  svg += textBlock(
    offerText,
    x + 28,
    y + 66,
    width - 56,
    25,
    '#FFFFFF',
    {
      weight: '900',
      maxLines: 2,
      lineHeight: 30,
    }
  );


  return svg;
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
  fields
) {

  const {
    productName,
    description,
    activeIngredient,
    targetPests,
    crops,
    usage,
    promoText,
    benefits,
    price,
  } = fields;


  const dark =
    template === 'boldProduct' ||
    template === 'premiumAgri';


  const margin =
    layout.margin;


  const innerW =
    width -
    margin * 2;


  /*
   * The design is deliberately a single
   * vertical flow rather than the old
   * left/right layout.
   */


  let svg = '';


  // ====================================================
  // PRODUCT TITLE
  // ====================================================

  const titleY =
    layout.contentY + 36;


  svg += drawProductTitle(
    width,
    titleY,
    productName,
    colors,
    dark
  );


  // ====================================================
  // PRODUCT IMAGE AREA
  // ====================================================

  /*
   * Calculate available space depending
   * on poster orientation.
   */

  let imageH;

  if (height >= 1800) {
    imageH = 400;
  } else if (height > width) {
    imageH = 300;
  } else {
    imageH = 270;
  }


  const imageY =
    titleY +
    80;


  /*
   * Image background is intentionally
   * very subtle. The actual product image
   * is composited over this area later.
   */

  svg += `
    <rect
      x="${margin}"
      y="${imageY}"
      width="${innerW}"
      height="${imageH}"
      rx="28"
      fill="${dark
        ? 'rgba(255,255,255,0.05)'
        : '#FFFFFF'}"
      stroke="${dark
        ? 'rgba(255,255,255,0.10)'
        : colors.border}"
      stroke-width="2"
    />

    <text
      x="${width / 2}"
      y="${imageY + imageH / 2 + 8}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="17px"
      font-weight="700"
      fill="${dark
        ? 'rgba(255,255,255,0.18)'
        : 'rgba(60,80,60,0.18)'}"
      text-anchor="middle"
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
    22;


  /*
   * Give description a substantial
   * amount of space.
   */

  let descriptionH;

  if (height >= 1800) {
    descriptionH = 205;
  } else if (height > width) {
    descriptionH = 180;
  } else {
    descriptionH = 175;
  }


  svg += drawDescriptionBox(
    margin,
    descriptionY,
    innerW,
    descriptionH,
    description,
    colors,
    dark
  );


  // ====================================================
  // BENEFITS / INFORMATION
  // ====================================================

  const infoY =
    descriptionY +
    descriptionH +
    18;


  /*
   * If the user supplies real benefits,
   * use them.
   *
   * Otherwise use product information
   * already supplied to the API.
   */

  let finalBenefits =
    Array.isArray(benefits)
      ? benefits
          .map(item => cleanText(item))
          .filter(Boolean)
          .slice(0, 4)
      : [];


  if (!finalBenefits.length) {

    const fallback = [];

    if (activeIngredient) {
      fallback.push(
        `Active: ${activeIngredient}`
      );
    }

    if (targetPests) {
      fallback.push(
        `Targets: ${targetPests}`
      );
    }

    if (crops) {
      fallback.push(
        `Crops: ${crops}`
      );
    }

    if (usage) {
      fallback.push(
        'Clear usage guidance'
      );
    }

    finalBenefits =
      fallback.slice(0, 4);
  }


  const benefitsH =
    finalBenefits.length
      ? 130
      : 0;


  if (finalBenefits.length) {

    svg += drawBenefits(
      margin,
      infoY,
      innerW,
      benefitsH,
      finalBenefits,
      colors,
      dark
    );
  }


  // ====================================================
  // USAGE
  // ====================================================

  const usageY =
    infoY +
    benefitsH +
    (finalBenefits.length ? 18 : 0);


  /*
   * Use the remaining space efficiently.
   * This prevents the large empty bottom
   * space that existed in the old version.
   */

  const reservedOfferH =
    price || promoText
      ? 82
      : 0;


  const usageAvailable =
    layout.contentBottom -
    usageY -
    reservedOfferH -
    16;


  const usageH =
    usage
      ? Math.max(
          105,
          Math.min(
            175,
            usageAvailable
          )
        )
      : 0;


  if (usage) {

    svg += drawUsageBox(
      margin,
      usageY,
      innerW,
      usageH,
      usage,
      colors,
      dark
    );
  }


  // ====================================================
  // PRICE / OFFER
  // ====================================================

  const offerY =
    layout.contentBottom -
    reservedOfferH;


  if (reservedOfferH) {

    svg += drawOfferBox(
      margin,
      offerY,
      innerW,
      reservedOfferH,
      price,
      promoText,
      colors,
      dark
    );
  }


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
  email,
  location,
  template
) {

  const footerY =
    layout.footerY;

  const footerH =
    layout.footerH;

  const dark =
    template === 'boldProduct' ||
    template === 'premiumAgri';

  const textColor =
    dark
      ? '#FFFFFF'
      : colors.text;

  const mutedColor =
    dark
      ? '#DCEBDD'
      : colors.muted;


  let svg = '';


  svg += `
    <rect
      x="0"
      y="${footerY}"
      width="${width}"
      height="${footerH}"
      fill="${colors.footer}"
    />
  `;


  /*
   * Three-column footer.
   */

  const margin =
    layout.margin;

  const innerW =
    width -
    margin * 2;

  const columnW =
    innerW / 3;


  const columns = [
    {
      title: 'CALL',
      value: phone,
    },
    {
      title: 'WHATSAPP',
      value: phone,
    },
    {
      title: 'LOCATION',
      value: location || email,
    },
  ];


  columns.forEach((column, index) => {

    const centerX =
      margin +
      columnW * index +
      columnW / 2;


    if (index > 0) {

      svg += `
        <line
          x1="${margin + columnW * index}"
          y1="${footerY + 22}"
          x2="${margin + columnW * index}"
          y2="${height - 22}"
          stroke="${dark
            ? 'rgba(255,255,255,0.14)'
            : colors.border}"
          stroke-width="2"
        />
      `;
    }


    svg += `
      <text
        x="${centerX}"
        y="${footerY + 35}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="13px"
        font-weight="900"
        fill="${colors.accent}"
        text-anchor="middle"
        letter-spacing="1.4px"
      >
        ${escapeXml(column.title)}
      </text>
    `;


    if (column.value) {

      svg += textBlock(
        column.value,
        centerX,
        footerY + 65,
        columnW - 35,
        17,
        textColor,
        {
          weight: '700',
          maxLines: 2,
          lineHeight: 21,
          anchor: 'middle',
        }
      );

    } else {

      svg += `
        <text
          x="${centerX}"
          y="${footerY + 65}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="15px"
          font-weight="600"
          fill="${mutedColor}"
          text-anchor="middle"
        >
          —
        </text>
      `;
    }
  });


  /*
   * Email gets a very small secondary
   * line when there is room.
   */

  if (
    email &&
    footerH >= 120
  ) {

    svg += `
      <text
        x="${width / 2}"
        y="${height - 10}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="11px"
        font-weight="600"
        fill="${mutedColor}"
        text-anchor="middle"
      >
        ${escapeXml(email)}
      </text>
    `;
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

      method:
        'GET',
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

        /*
         * Optional newer fields.
         * They do NOT break the existing API.
         */
        benefits,
        price,

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
        TEMPLATES.has(requestedTemplate)
          ? requestedTemplate
          : 'modernFarm';

      const requestedSize =
        cleanText(size);

      const finalSize =
        SIZES[requestedSize]
          ? requestedSize
          : 'square';


      const finalBenefits =
        normalizeList(benefits);


      const finalPrice =
        cleanText(price);


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


      // ==================================================
      // COLOURS
      // ==================================================

      const colors =
        templateColors(
          finalTemplate,
          finalThemeColor
        );


      // ==================================================
      // LAYOUT
      // ==================================================

      const layout =
        layoutFor(
          finalSize
        );


      // ==================================================
      // SVG START
      // ==================================================

      let svg = `
        <svg
          width="${width}"
          height="${height}"
          viewBox="0 0 ${width} ${height}"
          xmlns="http://www.w3.org/2000/svg"
        >
      `;


      // ==================================================
      // SVG DEFINITIONS
      // ==================================================

      svg += '<defs>';

      /*
       * Main shadow.
       */
      svg += `
        <filter
          id="shadow"
          x="-30%"
          y="-30%"
          width="160%"
          height="160%"
        >
          <feDropShadow
            dx="0"
            dy="5"
            stdDeviation="7"
            flood-opacity="0.16"
          />
        </filter>
      `;


      /*
       * Softer shadow for cards.
       */
      svg += `
        <filter
          id="softShadow"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feDropShadow
            dx="0"
            dy="3"
            stdDeviation="5"
            flood-opacity="0.08"
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

          benefits:
            finalBenefits,

          price:
            finalPrice,
        }
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
        cleanText(email),
        cleanText(location),
        finalTemplate
      );


      // ==================================================
      // CLOSE SVG
      // ==================================================

      svg += '</svg>';


      // ==================================================
      // CREATE BASE IMAGE
      // ==================================================

      let image =
        sharp(
          Buffer.from(svg)
        )
          .png();


      // ==================================================
      // LOGO
      // ==================================================

      const logoBuffer =
        dataUriToBuffer(logo);


      if (logoBuffer) {

        try {

          const logoBox =
            finalSize === 'story'
              ? 155
              : 125;


          let processedLogo =
            logoBuffer;


          /*
           * Try to remove white logo background.
           * If the logo is already transparent,
           * this will preserve it.
           */

          try {

            processedLogo =
              await removeWhiteBackground(
                logoBuffer
              );

          } catch (logoRemoveError) {

            console.log(
              '⚠️ Logo background removal skipped:',
              logoRemoveError.message
            );
          }


          const logoProcessed =
            await sharp(processedLogo)
              .resize(
                logoBox,
                logoBox,
                {
                  fit: 'contain',
                  position: 'centre',
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


          /*
           * TOP LEFT logo.
           */

          image =
            image.composite([
              {
                input: logoProcessed,

                top:
                  layout.margin,

                left:
                  layout.margin,
              },
            ]);


          console.log(
            '✅ Logo added'
          );

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

          /*
           * Must match the SVG product area.
           */

          const titleY =
            layout.contentY + 36;


          const imageY =
            titleY + 80;


          let imageH;

          if (height >= 1800) {
            imageH = 400;
          } else if (height > width) {
            imageH = 300;
          } else {
            imageH = 270;
          }


          const imageAreaX =
            layout.margin + 18;


          const imageAreaY =
            imageY + 15;


          const imageAreaW =
            width -
            layout.margin * 2 -
            36;


          const imageAreaH =
            imageH -
            30;


          /*
           * Product should use nearly the
           * entire image area.
           */

          const productW =
            Math.round(
              imageAreaW * 0.98
            );


          const productH =
            Math.round(
              imageAreaH * 0.98
            );


          const processed =
            await processProductImage(
              productBuffer,
              productW,
              productH
            );


          /*
           * Since processed already has the
           * exact requested dimensions, center it.
           */

          const left =
            Math.round(
              imageAreaX +
              (imageAreaW -
                productW) / 2
            );


          const top =
            Math.round(
              imageAreaY +
              (imageAreaH -
                productH) / 2
            );


          image =
            image.composite([
              {
                input: processed,

                top,

                left,
              },
            ]);


          console.log(
            '✅ Product image background removed and added'
          );

        } catch (error) {

          console.log(
            '⚠️ Product image processing failed:',
            error.message
          );
        }
      }


      // ==================================================
      // FILE NAME
      // ==================================================

      const timestamp =
        Date.now();


      const filename =
        `${
          safeFileName(
            finalBusinessName
          ) || 'business'
        }-${
          safeFileName(
            finalProductName
          ) || 'product'
        }-${timestamp}.png`;


      const outputPath =
        path.join(
          OUTPUT_DIR,
          filename
        );


      // ==================================================
      // SAVE
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
      // PUBLIC URL
      // ==================================================

      const baseUrl =
        `${req.protocol}://${req.get('host')}`;

      const posterUrl =
        `${baseUrl}/posters/${filename}`;


      // ==================================================
      // LOGGING
      // ==================================================

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
        '🏢 Business:',
        finalBusinessName
      );

      console.log(
        '📦 Product:',
        finalProductName
      );

      console.log(
        '🎨 Theme:',
        finalThemeColor
      );

      console.log(
        '📐 Size:',
        finalSize
      );

      console.log(
        '🎨 Template:',
        finalTemplate
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

        themeColor:
          finalThemeColor,
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