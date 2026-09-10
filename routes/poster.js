
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

  // Full HEX
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return color;
  }

  // Short HEX
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    return (
      '#' +
      color[1] + color[1] +
      color[2] + color[2] +
      color[3] + color[3]
    );
  }

  // Allow common CSS colour names
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
  };

  const named = namedColors[color.toLowerCase()];

  if (named) {
    return named;
  }

  // Agriventure default green
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

    // Break very long words
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

  const result = lines.slice(0, maxLines);

  result[maxLines - 1] =
    `${result[maxLines - 1]
      .replace(/[.,;:!?-]+$/, '')}…`;

  return result;
}


// ======================================================
// GENERIC TEXT BLOCK
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
    labelSize = 17,
    valueSize = 19,
    maxLines = 2,
    gap = 24,
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
      letter-spacing="0.5px"
    >
      ${escapeXml(label)}
    </text>
  `;

  const valueY = y + gap;

  svg += textBlock(
    value,
    x,
    valueY,
    width,
    valueSize,
    colors.value,
    {
      maxLines,
      lineHeight: Math.round(
        valueSize * 1.25
      ),
    }
  );

  const lineCount = Math.min(
    wrapText(
      value,
      width,
      valueSize
    ).length,
    maxLines
  );

  const h =
    gap +
    lineCount *
      Math.round(valueSize * 1.25) +
    15;

  return {
    svg,
    height: h,
  };
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
// POSTER LAYOUT
// ======================================================

function layoutFor(size, template) {

  const {
    width,
    height,
  } = SIZES[size];

  const margin = Math.round(
    Math.min(width, height) * 0.065
  );

  const headerH =
    size === 'story'
      ? 280
      : size === 'landscape'
        ? 225
        : 250;

  const footerH =
    size === 'story'
      ? 165
      : 135;

  const contentY =
    headerH + 15;

  const contentBottom =
    height - footerH;

  const contentH = Math.max(
    260,
    contentBottom - contentY
  );

  let leftRatio = 0.54;

  if (template === 'productInfo') {
    leftRatio = 0.40;
  }

  if (template === 'minimal') {
    leftRatio = 0.52;
  }

  if (size === 'landscape') {
    leftRatio =
      template === 'productInfo'
        ? 0.44
        : 0.52;
  }

  const gap = Math.round(
    Math.min(width, height) * 0.025
  );

  const innerW =
    width - margin * 2;

  const leftW = Math.round(
    (innerW - gap) * leftRatio
  );

  const rightW =
    innerW - gap - leftW;

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
// TEMPLATE COLOURS
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


  if (template === 'boldProduct') {

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


  if (template === 'premiumAgri') {

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


  if (template === 'pestControl') {

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


  if (template === 'promotion') {

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


  if (template === 'socialMedia') {

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


  if (template === 'minimal') {

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
        cx="${width * 0.04}"
        cy="${height * 0.92}"
        r="${Math.min(width, height) * 0.22}"
        fill="#FFFFFF"
        opacity="0.07"
      />
    `;
  }


  if (template === 'premiumAgri') {

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
    `;

    svg += `
      <circle
        cx="${width - 80}"
        cy="80"
        r="18"
        fill="${theme}"
      />
    `;
  }


  if (template === 'pestControl') {

    svg += `
      <rect
        x="0"
        y="0"
        width="${width}"
        height="${Math.round(height * 0.22)}"
        fill="${theme}"
      />
    `;

    svg += `
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


  if (template === 'promotion') {

    svg += `
      <rect
        x="0"
        y="0"
        width="${width}"
        height="${Math.round(height * 0.18)}"
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


  if (template === 'productInfo') {

    svg += `
      <rect
        x="0"
        y="0"
        width="${Math.round(width * 0.23)}"
        height="${height}"
        fill="${theme}"
      />
    `;

    svg += `
      <rect
        x="${Math.round(width * 0.23)}"
        y="0"
        width="${Math.round(width * 0.02)}"
        height="${height}"
        fill="${rgba(theme, 0.12)}"
      />
    `;
  }


  if (template === 'socialMedia') {

    svg += `
      <rect
        x="0"
        y="0"
        width="${width}"
        height="${Math.round(height * 0.13)}"
        fill="${theme}"
      />
    `;

    svg += `
      <circle
        cx="${width * 0.93}"
        cy="${height * 0.08}"
        r="${Math.min(width, height) * 0.13}"
        fill="#FFFFFF"
        opacity="0.10"
      />
    `;
  }


  if (template === 'modernFarm') {

    svg += `
      <path
        d="
          M0 ${height * 0.84}
          C ${width * .18} ${height * .69},
            ${width * .36} ${height * .93},
            ${width * .56} ${height * .79}
          C ${width * .75} ${height * .66},
            ${width * .88} ${height * .87},
            ${width} ${height * .74}
          V${height}
          H0Z
        "
        fill="${rgba(theme, 0.12)}"
      />
    `;

    svg += `
      <circle
        cx="${width * .88}"
        cy="${height * .14}"
        r="${Math.min(width, height) * .075}"
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

  const x = layout.margin;

  const dark =
    template === 'boldProduct' ||
    template === 'premiumAgri';


  // ====================================================
  // BIGGER COMPANY NAME
  // ====================================================

  const businessSize =
    height >= 1800
      ? 58
      : width >= 1800
        ? 54
        : 50;


  let svg = '';


  // ====================================================
  // PRODUCT INFO
  // ====================================================

  if (template === 'productInfo') {

    svg += `
      <text
        x="${x}"
        y="${layout.headerH * 0.62}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="30px"
        font-weight="900"
        fill="#FFFFFF"
        letter-spacing="0.5px"
      >
        AGRIVENTURE
      </text>
    `;

    svg += `
      <text
        x="${x}"
        y="${layout.headerH * 0.62 + 42}"
        font-family="Arial, Helvetica, sans-serif"
        font-size="16px"
        font-weight="700"
        fill="#E8F5E9"
      >
        PRODUCT INFO
      </text>
    `;

    return svg;
  }


  // ====================================================
  // PEST CONTROL
  // ====================================================

  if (template === 'pestControl') {

    svg += `
      <text
        x="${x}"
        y="55"
        font-family="Arial, Helvetica, sans-serif"
        font-size="17px"
        font-weight="900"
        fill="#FFFFFF"
        letter-spacing="2px"
      >
        PEST CONTROL
      </text>
    `;

    svg += textBlock(
      businessName,
      x,
      120,
      width - layout.margin * 2,
      businessSize,
      '#FFFFFF',
      {
        weight: '900',
        maxLines: 2,
        lineHeight:
          businessSize * 1.08,
        letterSpacing: 0.3,
      }
    );


    if (location) {

      svg += textBlock(
        location,
        x,
        205,
        width * 0.65,
        20,
        '#F3FFF4',
        {
          weight: '600',
          maxLines: 1,
        }
      );
    }

    return svg;
  }


  // ====================================================
  // STANDARD TEMPLATES
  // ====================================================

  const color =
    dark
      ? '#FFFFFF'
      : colors.text;

  const muted =
    dark
      ? '#DCEBDD'
      : colors.muted;


  const headerY =
    template === 'promotion'
      ? 125
      : layout.margin + businessSize;


  // ====================================================
  // COMPANY NAME
  // ====================================================

  svg += textBlock(
    businessName,
    x,
    headerY,
    width * 0.72,
    businessSize,
    color,
    {
      weight: '900',
      maxLines: 2,
      lineHeight:
        businessSize * 1.08,
      family:
        'Arial, Helvetica, sans-serif',
      letterSpacing: 0.3,
    }
  );


  // ====================================================
  // LOCATION
  // ====================================================

  if (location) {

    svg += textBlock(
      location,
      x,
      headerY +
        businessSize * 1.55,
      width * 0.65,
      20,
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
    template === 'boldProduct' ||
    template === 'premiumAgri';


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
    dark
      ? colors.panel
      : colors.panel;


  const p = 24;


  let svg = '';


  const titleSize =
    height >= 1800
      ? 48
      : width >= 1800
        ? 46
        : 42;


  const detailSize =
    height >= 1800
      ? 18
      : 19;


  const detailWidth =
    layout.leftW - p * 2;


  // ====================================================
  // LEFT CONTENT PANEL
  // ====================================================

  svg += `
    <rect
      x="${layout.leftX}"
      y="${layout.contentY}"
      width="${layout.leftW}"
      height="${layout.contentH}"
      rx="24"
      fill="${panel}"
      stroke="${border}"
      stroke-width="2"
    />
  `;


  // ====================================================
  // RIGHT IMAGE PANEL
  // ====================================================

  svg += `
    <rect
      x="${layout.rightX}"
      y="${layout.contentY}"
      width="${layout.rightW}"
      height="${layout.contentH}"
      rx="24"
      fill="${panel}"
      stroke="${border}"
      stroke-width="2"
    />
  `;


  // ====================================================
  // PRODUCT TITLE
  // ====================================================

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
              1.08
          }"
          font-family="Arial, Helvetica, sans-serif"
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
      1.08 +
    26;


  // ====================================================
  // PRODUCT DETAILS
  // ====================================================

  const details = [

    [
      'DESCRIPTION',
      description,
      2,
    ],

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


  for (const [
    label,
    value,
    maxLines,
  ] of details) {

    if (!cleanText(value)) {
      continue;
    }


    if (
      y >
      layout.contentY +
      layout.contentH -
      65
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
          label: titleColor,

          value:
            muted === colors.muted
              ? '#414741'
              : muted,
        },
        {
          labelSize: 14,
          valueSize: detailSize,
          maxLines,
        }
      );


    svg += result.svg;

    y += result.height;
  }


  // ====================================================
  // PRODUCT IMAGE CARD
  // ====================================================

  const imagePad = 28;


  svg += `
    <rect
      x="${layout.rightX + imagePad}"
      y="${layout.contentY + imagePad}"
      width="${layout.rightW - imagePad * 2}"
      height="${Math.round(layout.contentH * 0.62)}"
      rx="20"
      fill="#FFFFFF"
    />
  `;


  svg += `
    <text
      x="${layout.rightX + layout.rightW / 2}"
      y="${layout.contentY + layout.contentH * 0.70}"
      font-family="Arial, Helvetica, sans-serif"
      font-size="15px"
      font-weight="800"
      fill="${colors.muted}"
      text-anchor="middle"
    >
      PRODUCT
    </text>
  `;


  // ====================================================
  // PROMOTION
  // ====================================================

  if (promoText) {

    const promoH =
      Math.min(
        105,
        Math.max(
          72,
          layout.contentH * 0.14
        )
      );


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
      promoY + promoH * 0.62,
      layout.leftW - 36,
      22,
      '#FFFFFF',
      {
        weight: '900',
        maxLines: 2,
        lineHeight: 27,
        anchor: 'start',
      }
    );
  }


  return svg;
}


// ======================================================
// TEST ROUTE
// ======================================================

router.get('/test', (req, res) => {

  res.status(200).json({

    success: true,

    message:
      'Poster API is connected correctly.',

    route:
      '/api/poster/test',

    method:
      'GET',

  });
});


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
        TEMPLATES.has(requestedTemplate)
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


      // ==================================================
      // COLOUR + LAYOUT
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


      // ==================================================
      // SVG START
      // ==================================================

      let svg = `
        <?xml version="1.0" encoding="UTF-8"?>

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


      // ==================================================
      // CONTACT DETAILS
      // ==================================================

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
          footerY + 48,
          width - layout.margin * 2,
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


      // ==================================================
      // FOOTER LABEL
      // ==================================================

      svg += `
        <text
          x="${width / 2}"
          y="${height - 22}"
          font-family="Arial, Helvetica, sans-serif"
          font-size="13px"
          font-weight="600"
          fill="${colors.muted}"
          text-anchor="middle"
        >
          Agricultural Product
        </text>
      `;


      // ==================================================
      // CLOSE SVG
      // ==================================================

      svg += '</svg>';


      // ==================================================
      // CREATE IMAGE
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
              ? 155
              : 125;


          const logoProcessed =
            await sharp(logoBuffer)

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
                input: logoProcessed,

                top:
                  layout.margin,

                left:
                  width -
                  layout.margin -
                  logoBox,
              },
            ]);
        }

        catch (error) {

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

          const cardW =
            Math.max(
              160,
              layout.rightW - 56
            );


          const cardH =
            Math.max(
              180,
              Math.round(
                layout.contentH * 0.62
              ) - 12
            );


          const processed =
            await sharp(productBuffer)

              .ensureAlpha()

              .trim({
                threshold: 22,
              })

              .flatten({
                background: '#FFFFFF',
              })

              .resize(
                cardW,
                cardH,
                {
                  fit: 'contain',

                  position: 'centre',

                  background: '#FFFFFF',
                }
              )

              .png()

              .toBuffer();


          const metadata =
            await sharp(
              processed
            ).metadata();


          const actualWidth =
            metadata.width ||
            cardW;


          const actualHeight =
            metadata.height ||
            cardH;


          const left =
            Math.round(
              layout.rightX +
              28 +
              (cardW - actualWidth) / 2
            );


          const top =
            Math.round(
              layout.contentY +
              28 +
              (cardH - actualHeight) / 2
            );


          image =
            image.composite([
              {
                input: processed,

                top,

                left,
              },
            ]);
        }

        catch (error) {

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

    }

    catch (error) {

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