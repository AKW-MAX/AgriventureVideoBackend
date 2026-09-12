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
  fs.mkdirSync(OUTPUT_DIR, {
    recursive: true,
  });
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
// COLOR HELPERS
// ======================================================

function normalizeColor(value) {
  const color = cleanText(value);

  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color;
  }

  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
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
      fontSize * 0.53,
      7
    );

  const maxChars = Math.max(
    8,
    Math.floor(
      width / averageCharWidth
    )
  );

  const words = value.split(/\s+/);

  const lines = [];

  let line = '';

  for (const word of words) {

    // Break unusually long words.
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
      candidate.length <= maxChars
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


function truncateLines(
  lines,
  maxLines
) {
  if (
    lines.length <= maxLines
  ) {
    return lines;
  }

  const result =
    lines.slice(0, maxLines);

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
    lineHeight =
      Math.round(fontSize * 1.35),
    maxLines = 4,
    anchor = 'start',
    family =
      'Arial, Helvetica, sans-serif',
    letterSpacing = 0,
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
      (line, i) => `
        <text
          x="${x}"
          y="${y + i * lineHeight}"
          font-family="${family}"
          font-size="${fontSize}px"
          font-weight="${weight}"
          letter-spacing="${letterSpacing}px"
          fill="${fill}"
          text-anchor="${anchor}"
        >
          ${escapeXml(line)}
        </text>
      `
    )
    .join('');
}


// ======================================================
// LABEL + VALUE
// ======================================================

function labelValue(
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
    valueSize = 19,
    maxLines = 2,
    gap = 22,
    valueLineHeight =
      Math.round(valueSize * 1.28),
  } = options;

  if (!cleanText(value)) {
    return {
      svg: '',
      height: 0,
    };
  }

  let svg = `
    <text
      x="${x}"
      y="${y}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${labelSize}px"
      font-weight="900"
      fill="${colors.label}"
      letter-spacing="0.6"
    >
      ${escapeXml(label)}
    </text>
  `;

  const valueY =
    y + gap;

  svg += textBlock(
    value,
    x,
    valueY,
    width,
    valueSize,
    colors.value,
    {
      maxLines,
      lineHeight: valueLineHeight,
      weight: '500',
    }
  );

  const lineCount =
    Math.min(
      wrapText(
        value,
        width,
        valueSize
      ).length,
      maxLines
    );

  const h =
    gap +
    lineCount * valueLineHeight +
    14;

  return {
    svg,
    height: h,
  };
}


// ======================================================
// DATA URI → BUFFER
// ======================================================

function dataUriToBuffer(dataUri) {

  if (!dataUri) {
    return null;
  }

  const match =
    String(dataUri).match(
      /^data:([^;]+);base64,(.+)$/s
    );

  if (!match) {
    console.log(
      '⚠️ Invalid data URI received.'
    );

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

  // Slightly smaller outer margin gives
  // the poster more usable space.
  const margin =
    Math.round(
      Math.min(
        width,
        height
      ) * 0.055
    );

  // More room for the company name.
  const headerH =
    size === 'story'
      ? 285
      : size === 'landscape'
        ? 230
        : 260;

  const footerH =
    size === 'story'
      ? 150
      : 120;

  const contentY =
    headerH + 10;

  const contentBottom =
    height - footerH;

  const contentH =
    Math.max(
      300,
      contentBottom - contentY
    );

  // Give the product image more width.
  let leftRatio = 0.48;

  if (
    template === 'productInfo'
  ) {
    leftRatio = 0.42;
  }

  if (
    template === 'minimal'
  ) {
    leftRatio = 0.47;
  }

  if (
    size === 'landscape'
  ) {
    leftRatio =
      template === 'productInfo'
        ? 0.44
        : 0.48;
  }

  const gap =
    Math.round(
      Math.min(
        width,
        height
      ) * 0.018
    );

  const innerW =
    width - margin * 2;

  const leftW =
    Math.round(
      (innerW - gap) *
        leftRatio
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
    bg: '#F4F8F4',
    panel: '#FFFFFF',
    text: '#202520',
    muted: '#626862',
    accent: theme,
    accentSoft:
      rgba(theme, 0.10),
    border: '#DDE7DD',
    footer:
      rgba(theme, 0.12),
    white: '#FFFFFF',
  };


  if (
    template ===
    'boldProduct'
  ) {

    return {
      ...light,

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


  if (
    template ===
    'premiumAgri'
  ) {

    return {
      ...light,

      bg: '#102B16',
      panel: '#173A1E',

      text: '#FFFFFF',
      muted: '#D7E8D9',

      accent: theme,

      accentSoft:
        rgba(theme, 0.16),

      border:
        rgba(theme, 0.45),

      footer: '#0B2010',

      white: '#FFFFFF',
    };
  }


  if (
    template ===
    'pestControl'
  ) {

    return {
      ...light,

      bg: '#FFF8ED',
      panel: '#FFFFFF',

      text: '#2C2418',
      muted: '#6F665A',

      accent: theme,

      accentSoft: '#FFF0D5',

      border: '#EAD9BA',

      footer: '#F6E5C8',
    };
  }


  if (
    template ===
    'promotion'
  ) {

    return {
      ...light,

      bg: '#FFFDF6',
      panel: '#FFFFFF',

      text: '#25251F',
      muted: '#6C6A5F',

      accent: theme,

      accentSoft: '#FFF1D2',

      border: '#E7DFC9',

      footer: '#F4EACF',
    };
  }


  if (
    template ===
    'socialMedia'
  ) {

    return {
      ...light,

      bg: '#F1F7F1',
      panel: '#FFFFFF',

      text: '#17301B',
      muted: '#5D6B60',

      accent: theme,

      accentSoft:
        rgba(theme, 0.11),

      border: '#D8E6D9',

      footer: '#E0EEE1',
    };
  }


  if (
    template ===
    'minimal'
  ) {

    return {
      ...light,

      bg: '#FFFFFF',
      panel: '#FFFFFF',

      text: '#171A17',
      muted: '#666B66',

      accent: '#202520',

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
      width="${width}"
      height="${height}"
      fill="${colors.bg}"
    />
  `;


  // ----------------------------------------------------
  // BOLD PRODUCT
  // ----------------------------------------------------

  if (
    template ===
    'boldProduct'
  ) {

    svg += `
      <circle
        cx="${width * 0.88}"
        cy="${height * 0.12}"
        r="${Math.min(width, height) * 0.25}"
        fill="#FFFFFF"
        opacity="0.10"
      />

      <circle
        cx="${width * 0.04}"
        cy="${height * 0.92}"
        r="${Math.min(width, height) * 0.22}"
        fill="#FFFFFF"
        opacity="0.07"
      />
    `;
  }


  // ----------------------------------------------------
  // PREMIUM AGRI
  // ----------------------------------------------------

  if (
    template ===
    'premiumAgri'
  ) {

    svg += `
      <rect
        x="24"
        y="24"
        width="${width - 48}"
        height="${height - 48}"
        rx="28"
        fill="none"
        stroke="${theme}"
        stroke-width="4"
        opacity="0.75"
      />

      <circle
        cx="${width - 80}"
        cy="80"
        r="18"
        fill="${theme}"
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

    svg += `
      <rect
        x="0"
        y="0"
        width="${width}"
        height="${Math.round(height * 0.22)}"
        fill="${theme}"
      />

      <path
        d="
          M0 ${height * 0.22}
          Q ${width * 0.25} ${height * 0.17}
            ${width * 0.5} ${height * 0.22}
          T ${width} ${height * 0.22}
          V0
          H0Z
        "
        fill="${theme}"
        opacity="0.9"
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

    svg += `
      <rect
        x="0"
        y="0"
        width="${width}"
        height="${Math.round(height * 0.18)}"
        fill="${theme}"
      />

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

  if (
    template ===
    'productInfo'
  ) {

    svg += `
      <rect
        x="0"
        y="0"
        width="${Math.round(width * 0.23)}"
        height="${height}"
        fill="${theme}"
      />

      <rect
        x="${Math.round(width * 0.23)}"
        y="0"
        width="${Math.round(width * 0.02)}"
        height="${height}"
        fill="${rgba(theme, 0.12)}"
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

    svg += `
      <rect
        x="0"
        y="0"
        width="${width}"
        height="${Math.round(height * 0.13)}"
        fill="${theme}"
      />

      <circle
        cx="${width * 0.93}"
        cy="${height * 0.08}"
        r="${Math.min(width, height) * 0.13}"
        fill="#FFFFFF"
        opacity="0.10"
      />
    `;
  }


  // ----------------------------------------------------
  // MODERN FARM
  // ----------------------------------------------------

  if (
    template ===
    'modernFarm'
  ) {

    svg += `
      <path
        d="
          M0 ${height * 0.84}
          C ${width * 0.18} ${height * 0.69},
            ${width * 0.36} ${height * 0.93},
            ${width * 0.56} ${height * 0.79}

          C ${width * 0.75} ${height * 0.66},
            ${width * 0.88} ${height * 0.87},
            ${width} ${height * 0.74}

          V${height}
          H0Z
        "
        fill="${rgba(theme, 0.12)}"
      />

      <circle
        cx="${width * 0.88}"
        cy="${height * 0.14}"
        r="${Math.min(width, height) * 0.075}"
        fill="${theme}"
        opacity="0.18"
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

  const dark =
    template ===
      'boldProduct' ||
    template ===
      'premiumAgri';

  // Larger company name.
  const businessSize =
    height >= 1800
      ? 64
      : width >= 1800
        ? 60
        : 56;

  let svg = '';


  // ----------------------------------------------------
  // PRODUCT INFO
  // ----------------------------------------------------

  if (
    template ===
    'productInfo'
  ) {

    svg += `
      <text
        x="${x}"
        y="${layout.headerH * 0.48}"
        font-family="Trebuchet MS, Arial, Helvetica, sans-serif"
        font-size="24px"
        font-weight="900"
        fill="#FFFFFF"
        letter-spacing="1.5"
      >
        AGRIVENTURE
      </text>

      <text
        x="${x}"
        y="${layout.headerH * 0.48 + 40}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="15px"
        font-weight="700"
        fill="#E8F5E9"
        letter-spacing="2"
      >
        PRODUCT INFO
      </text>
    `;

    return svg;
  }


  // ----------------------------------------------------
  // PEST CONTROL
  // ----------------------------------------------------

  if (
    template ===
    'pestControl'
  ) {

    svg += `
      <text
        x="${x}"
        y="48"
        font-family="Arial, Helvetica, sans-serif"
        font-size="17px"
        font-weight="900"
        fill="#FFFFFF"
        letter-spacing="2.5"
      >
        PEST CONTROL
      </text>
    `;

    svg += textBlock(
      businessName,
      x,
      105,
      width * 0.60,
      businessSize,
      '#FFFFFF',
      {
        weight: '900',
        maxLines: 2,
        lineHeight:
          businessSize * 1.05,
        family:
          'Trebuchet MS, Arial, Helvetica, sans-serif',
      }
    );

    if (location) {

      svg += textBlock(
        location,
        x,
        220,
        width * 0.58,
        18,
        '#F3FFF4',
        {
          weight: '600',
          maxLines: 1,
        }
      );
    }

    return svg;
  }


  // ----------------------------------------------------
  // STANDARD HEADER
  // ----------------------------------------------------

  const color =
    dark
      ? '#FFFFFF'
      : colors.text;

  const muted =
    dark
      ? '#DCEBDD'
      : colors.muted;


  const headerY =
    template ===
      'promotion'
      ? 112
      : layout.margin +
        businessSize;


  // Reserve space on the right for the logo.
  const companyWidth =
    Math.min(
      width * 0.62,
      width -
        layout.margin * 2 -
        180
    );


  svg += textBlock(
    businessName,
    x,
    headerY,
    companyWidth,
    businessSize,
    color,
    {
      weight: '900',
      maxLines: 2,
      lineHeight:
        businessSize * 1.05,
      family:
        'Trebuchet MS, Arial, Helvetica, sans-serif',
      letterSpacing: 0.3,
    }
  );


  // Accent underline.
  const lineY =
    headerY +
    businessSize * 1.18;

  svg += `
    <rect
      x="${x}"
      y="${lineY}"
      width="${Math.min(125, width * 0.12)}"
      height="7"
      rx="3.5"
      fill="${colors.accent}"
    />
  `;


  if (location) {

    svg += textBlock(
      location,
      x,
      lineY + 30,
      width * 0.58,
      18,
      muted,
      {
        weight: '600',
        maxLines: 1,
      }
    );
  }


  return svg;
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
    template ===
      'boldProduct' ||
    template ===
      'premiumAgri';


  const titleColor =
    dark
      ? '#FFFFFF'
      : colors.accent;


  const textColor =
    dark
      ? '#F2F8F2'
      : colors.text;


  const muted =
    dark
      ? '#DCEBDD'
      : colors.muted;


  const border =
    dark
      ? 'rgba(255,255,255,0.18)'
      : colors.border;


  const panel =
    colors.panel;


  const p = 22;


  let svg = '';


  // ----------------------------------------------------
  // PANELS
  // ----------------------------------------------------

  svg += `
    <rect
      x="${layout.leftX}"
      y="${layout.contentY}"
      width="${layout.leftW}"
      height="${layout.contentH}"
      rx="26"
      fill="${panel}"
      stroke="${border}"
      stroke-width="2"
    />

    <rect
      x="${layout.rightX}"
      y="${layout.contentY}"
      width="${layout.rightW}"
      height="${layout.contentH}"
      rx="26"
      fill="${panel}"
      stroke="${border}"
      stroke-width="2"
    />
  `;


  // ----------------------------------------------------
  // PRODUCT TITLE
  // ----------------------------------------------------

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


  svg += titleLines
    .map(
      (line, i) => `
        <text
          x="${layout.leftX + p}"
          y="${
            layout.contentY +
            58 +
            i *
              titleSize *
              1.06
          }"
          font-family="Trebuchet MS, Arial, Helvetica, sans-serif"
          font-size="${titleSize}px"
          font-weight="900"
          fill="${titleColor}"
        >
          ${escapeXml(line)}
        </text>
      `
    )
    .join('');


  let y =
    layout.contentY +
    58 +
    titleLines.length *
      titleSize *
      1.06 +
    24;


  // ----------------------------------------------------
  // DESCRIPTION SECTION
  // ----------------------------------------------------

  if (
    cleanText(description)
  ) {

    const descriptionSize =
      height >= 1800
        ? 23
        : 21;


    const descriptionWidth =
      detailWidth - 30;


    const descriptionLines =
      truncateLines(
        wrapText(
          description,
          descriptionWidth,
          descriptionSize
        ),
        4
      );


    const descriptionLineHeight =
      Math.round(
        descriptionSize * 1.32
      );


    const descriptionBoxH =
      Math.max(
        108,
        54 +
          descriptionLines.length *
            descriptionLineHeight
      );


    svg += `
      <rect
        x="${layout.leftX + p - 6}"
        y="${y}"
        width="${layout.leftW - (p - 6) * 2}"
        height="${descriptionBoxH}"
        rx="18"
        fill="${colors.accentSoft}"
      />

      <rect
        x="${layout.leftX + p - 6}"
        y="${y}"
        width="7"
        height="${descriptionBoxH}"
        rx="3.5"
        fill="${colors.accent}"
      />

      <text
        x="${layout.leftX + p + 14}"
        y="${y + 28}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="13px"
        font-weight="900"
        fill="${titleColor}"
        letter-spacing="1.4"
      >
        DESCRIPTION
      </text>
    `;


    svg += descriptionLines
      .map(
        (line, i) => `
          <text
            x="${layout.leftX + p + 14}"
            y="${
              y +
              58 +
              i *
                descriptionLineHeight
            }"
            font-family="Trebuchet MS, Arial, Helvetica, sans-serif"
            font-size="${descriptionSize}px"
            font-weight="600"
            fill="${textColor}"
          >
            ${escapeXml(line)}
          </text>
        `
      )
      .join('');


    y +=
      descriptionBoxH +
      18;
  }


  // ----------------------------------------------------
  // PROMOTION SPACE
  // ----------------------------------------------------

  let promoH = 0;

  if (
    cleanText(promoText)
  ) {

    promoH =
      Math.min(
        105,
        Math.max(
          76,
          layout.contentH *
            0.14
        )
      );
  }


  const detailsBottom =
    layout.contentY +
    layout.contentH -
    promoH -
    34;


  // ----------------------------------------------------
  // DETAILS
  // ----------------------------------------------------

  const details = [

    [
      'ACTIVE INGREDIENT',
      activeIngredient,
      2,
    ],

    [
      'TARGETS',
      targetPests,
      2,
    ],

    [
      'CROPS',
      crops,
      2,
    ],

    [
      'USAGE',
      usage,
      3,
    ],
  ];


  const detailSize =
    height >= 1800
      ? 20
      : 19;


  for (
    const [
      label,
      value,
      maxLines,
    ] of details
  ) {

    if (
      !cleanText(value)
    ) {
      continue;
    }


    if (
      y >
      detailsBottom - 60
    ) {
      break;
    }


    const result =
      labelValue(
        label,
        value,
        layout.leftX + p,
        y,
        detailWidth,
        {
          label:
            titleColor,

          value:
            muted === colors.muted
              ? '#414741'
              : muted,
        },
        {
          labelSize: 13,
          valueSize: detailSize,
          maxLines,
          gap: 21,
        }
      );


    svg += result.svg;

    y +=
      result.height +
      4;
  }


  // ----------------------------------------------------
  // PRODUCT IMAGE CARD
  // ----------------------------------------------------

  const imagePad = 10;


  const productCardX =
    layout.rightX +
    imagePad;


  const productCardY =
    layout.contentY +
    imagePad;


  const productCardW =
    layout.rightW -
    imagePad * 2;


  const productCardH =
    layout.contentH -
    imagePad * 2;


  svg += `
    <rect
      x="${productCardX}"
      y="${productCardY}"
      width="${productCardW}"
      height="${productCardH}"
      rx="24"
      fill="#FFFFFF"
      stroke="${colors.accent}"
      stroke-opacity="0.12"
      stroke-width="2"
    />
  `;


  // Decorative accent line.
  svg += `
    <rect
      x="${productCardX + 24}"
      y="${productCardY + 18}"
      width="${Math.min(
        90,
        productCardW * 0.25
      )}"
      height="6"
      rx="3"
      fill="${colors.accent}"
    />
  `;


  // ----------------------------------------------------
  // PROMOTION
  // ----------------------------------------------------

  if (
    cleanText(promoText)
  ) {

    const promoY =
      layout.contentY +
      layout.contentH -
      promoH -
      22;


    svg += `
      <rect
        x="${layout.leftX}"
        y="${promoY}"
        width="${layout.leftW}"
        height="${promoH}"
        rx="18"
        fill="${theme}"
      />
    `;


    svg += textBlock(
      promoText,
      layout.leftX + 18,
      promoY +
        promoH * 0.62,
      layout.leftW - 36,
      22,
      '#FFFFFF',
      {
        weight: '900',
        maxLines: 2,
        lineHeight: 27,
        anchor: 'start',
        family:
          'Trebuchet MS, Arial, Helvetica, sans-serif',
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

    return res.status(200).json({
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

      if (
        !finalBusinessName
      ) {

        return res.status(400).json({
          success: false,

          message:
            'Business name is required.',
        });
      }


      if (
        !finalProductName
      ) {

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
      // COLORS + LAYOUT
      // ==================================================

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
        '=========================================='
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
        'Logo supplied:',
        Boolean(logo)
      );

      console.log(
        'Product image supplied:',
        Boolean(productImage)
      );

      console.log(
        '=========================================='
      );


      // ==================================================
      // BASE SVG
      // ==================================================

      let svg =
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<svg ` +
        `width="${width}" ` +
        `height="${height}" ` +
        `viewBox="0 0 ${width} ${height}" ` +
        `xmlns="http://www.w3.org/2000/svg">`;


      svg += `
        <defs>

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
            cleanText(
              crops
            ),

          usage:
            cleanText(
              usage
            ),

          promoText:
            cleanText(
              promoText
            ),
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


      if (
        cleanText(phone)
      ) {

        contacts.push(
          `Tel: ${cleanText(phone)}`
        );
      }


      if (
        cleanText(email)
      ) {

        contacts.push(
          `Email: ${cleanText(email)}`
        );
      }


      if (
        contacts.length
      ) {

        svg += textBlock(
          contacts.join(
            '   •   '
          ),
          width / 2,
          footerY + 45,
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
          y="${height - 20}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="13px"
          font-weight="600"
          fill="${colors.muted}"
          text-anchor="middle"
        >
          Agricultural Product
        </text>
      `;


      svg += '</svg>';


      // ==================================================
      // RENDER SVG
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


      if (
        logoBuffer
      ) {

        try {

          console.log(
            '🖼️ Processing business logo...'
          );


          // Larger logo depending on poster size.
          const logoBox =
            finalSize === 'story'
              ? 170
              : finalSize === 'landscape'
                ? 150
                : 155;


          // Trim empty edges around logo.
          const trimmedLogo =
            await sharp(
              logoBuffer
            )
              .ensureAlpha()
              .trim({
                background: '#FFFFFF',
                threshold: 22,
              })
              .png()
              .toBuffer();


          const logoProcessed =
            await sharp(
              trimmedLogo
            )
              .resize(
                logoBox - 24,
                logoBox - 24,
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


          // ------------------------------------------------
          // WHITE LOGO BADGE
          // ------------------------------------------------

          const badgeSvg = `
            <svg
              width="${logoBox}"
              height="${logoBox}"
              xmlns="http://www.w3.org/2000/svg"
            >

              <rect
                x="0"
                y="0"
                width="${logoBox}"
                height="${logoBox}"
                rx="24"
                fill="#FFFFFF"
                fill-opacity="0.98"
                stroke="${finalThemeColor}"
                stroke-opacity="0.14"
                stroke-width="2"
              />

            </svg>
          `;


          const badgeBuffer =
            Buffer.from(
              badgeSvg
            );


          const logoLeft =
            width -
            layout.margin -
            logoBox;


          const logoTop =
            finalTemplate ===
            'pestControl'
              ? 22
              : finalTemplate ===
                'promotion'
                ? 25
                : layout.margin - 5;


          // Badge first.
          image =
            image.composite([
              {
                input:
                  badgeBuffer,

                left:
                  Math.round(
                    logoLeft
                  ),

                top:
                  Math.round(
                    logoTop
                  ),
              },
            ]);


          // Logo second.
          image =
            image.composite([
              {
                input:
                  logoProcessed,

                left:
                  Math.round(
                    logoLeft + 12
                  ),

                top:
                  Math.round(
                    logoTop + 12
                  ),
              },
            ]);


          console.log(
            '✅ Logo added to poster.'
          );

        } catch (error) {

          console.log(
            '⚠️ Logo processing failed:',
            error.message
          );
        }

      } else {

        console.log(
          '⚠️ No usable logo data received.'
        );
      }


      // ==================================================
      // PRODUCT IMAGE
      // ==================================================

      const productBuffer =
        dataUriToBuffer(
          productImage
        );


      if (
        productBuffer
      ) {

        try {

          console.log(
            '🖼️ Processing product image...'
          );


          // ------------------------------------------------
          // LARGE PRODUCT IMAGE AREA
          // ------------------------------------------------

          const imageAreaW =
            Math.max(
              180,
              Math.round(
                layout.rightW -
                28
              )
            );


          const imageAreaH =
            Math.max(
              220,
              Math.round(
                layout.contentH -
                28
              )
            );


          // ------------------------------------------------
          // STEP 1:
          // TRIM EMPTY / WHITE MARGINS
          // ------------------------------------------------

          const trimmedProduct =
            await sharp(
              productBuffer
            )
              .ensureAlpha()
              .trim({
                background: '#FFFFFF',
                threshold: 30,
              })
              .png()
              .toBuffer();


          // ------------------------------------------------
          // STEP 2:
          // MAKE PRODUCT AS LARGE AS POSSIBLE
          // ------------------------------------------------

          const processedProduct =
            await sharp(
              trimmedProduct
            )
              .resize(
                imageAreaW,
                imageAreaH,
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


          // ------------------------------------------------
          // STEP 3:
          // COMPOSITE INTO THE PRODUCT CARD
          // ------------------------------------------------

          image =
            image.composite([
              {
                input:
                  processedProduct,

                left:
                  Math.round(
                    layout.rightX +
                    14
                  ),

                top:
                  Math.round(
                    layout.contentY +
                    14
                  ),
              },
            ]);


          console.log(
            '✅ Product image added and margins trimmed.'
          );

        } catch (error) {

          console.log(
            '⚠️ Product image processing failed:',
            error.message
          );
        }

      } else {

        console.log(
          '⚠️ No usable product image received.'
        );
      }


      // ==================================================
      // SAVE POSTER
      // ==================================================

      const timestamp =
        Date.now();


      const filename =
        `${safeFileName(
          finalBusinessName
        ) || 'business'}-` +
        `${safeFileName(
          finalProductName
        ) || 'product'}-` +
        `${timestamp}.png`;


      const outputPath =
        path.join(
          OUTPUT_DIR,
          filename
        );


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