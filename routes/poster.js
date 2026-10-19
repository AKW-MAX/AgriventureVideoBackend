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
  if (!value) return [];
  const maxWidth = Math.max(10, width);
  const glyphWidth = c => {
    if ('MW@%#'.includes(c)) return fontSize * 0.88;
    if ('ilI.,:;!| '.includes(c)) return fontSize * 0.30;
    if (/[A-Z]/.test(c)) return fontSize * 0.67;
    return fontSize * 0.55;
  };
  const measure = str => [...str].reduce((sum, c) => sum + glyphWidth(c), 0);
  const lines = [];
  for (const paragraph of value.split(/\n/)) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? line + ' ' + word : word;
      if (measure(candidate) <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      let part = '';
      for (const char of word) {
        if (part && measure(part + char) > maxWidth) { lines.push(part); part = ''; }
        part += char;
      }
      line = part;
    }
    if (line) lines.push(line);
  }
  return lines;
}

function fittedText(value, width, maxLines, preferred, minimum = 12) {
  for (let size = preferred; size >= minimum; size -= 1) {
    const lines = wrapText(value, width, size);
    if (lines.length <= maxLines) return { size, lines, truncated: false };
  }
  return { size: minimum, lines: truncateLines(wrapText(value, width, minimum), maxLines), truncated: true };
}

function renderLines(lines, x, baseline, fontSize, color, opts = {}) {
  const { weight = 600, lineHeight = fontSize * 1.22, anchor = 'start', family = 'Arial, Helvetica, sans-serif' } = opts;
  return lines.map((line, i) => `<text x="${x}" y="${baseline + i * lineHeight}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${escapeXml(line)}</text>`).join('');
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
    lineHeight = Math.round(valueSize * 1.25),
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
      letter-spacing="0.7px"
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
      lineHeight,
      weight: label === 'DESCRIPTION' ? '500' : '600',
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
    lineCount * lineHeight +
    18;

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
// REMOVE WHITE PRODUCT BACKGROUND
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

    // Very white / neutral background
    const isWhiteBackground =
      brightness >= 238 &&
      difference <= 25;

    if (isWhiteBackground) {

      data[i + 3] = 0;

    } else if (
      brightness >= 220 &&
      difference <= 30
    ) {

      // Soft transparency near edges
      const alpha =
        Math.round(
          ((238 - brightness) / 18) * 255
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
// POSTER LAYOUT
// ======================================================

function layoutFor(size, template) {

  const {
    width,
    height,
  } = SIZES[size];

  const margin =
    Math.round(
      Math.min(width, height) * 0.055
    );

  const headerH =
    size === 'story'
      ? 300
      : size === 'landscape'
        ? 235
        : 265;

  const footerH =
    size === 'story'
      ? 145
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

  // Give the text side more room.
  let leftRatio = 0.50;

  if (template === 'productInfo') {
    leftRatio = 0.46;
  }

  if (template === 'minimal') {
    leftRatio = 0.49;
  }

  if (size === 'landscape') {
    leftRatio =
      template === 'productInfo'
        ? 0.46
        : 0.50;
  }

  const gap =
    Math.round(
      Math.min(width, height) * 0.018
    );

  const innerW =
    width - margin * 2;

  const leftW =
    Math.round(
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

function drawHeader(width, height, layout, template, colors, businessName, location) {
  const x = layout.margin;
  const dark = template === 'boldProduct' || template === 'premiumAgri';
  const textColor = dark || template === 'pestControl' ? '#FFFFFF' : colors.text;
  const muted = dark || template === 'pestControl' ? '#F1F5F1' : colors.muted;
  const reservedLogo = Math.min(165, width * 0.18);
  const nameWidth = width - 2 * x - reservedLogo - 14;
  const nameTop = template === 'pestControl' ? 91 : layout.margin + 42;
  const nameMaxHeight = layout.headerH - nameTop - 64;
  let name = fittedText(businessName, nameWidth, 3, width > 1500 ? 55 : 52, 22);
  while (name.size > 20 && name.lines.length * name.size * 1.08 > nameMaxHeight) {
    name = fittedText(businessName, nameWidth, 3, name.size - 1, 20);
  }
  const lineHeight = name.size * 1.08;
  const locationY = nameTop + (name.lines.length - 1) * lineHeight + name.size * 0.8 + 23;
  let svg = `<rect x="${x}" y="${layout.margin - 16}" width="74" height="6" rx="3" fill="${dark || template === 'pestControl' ? '#FFFFFF' : colors.accent}"/>`;
  svg += renderLines(name.lines, x, nameTop, name.size, textColor, {weight: 900, lineHeight, family:'Trebuchet MS, Arial, sans-serif'});
  if (location && locationY < layout.contentY - 13) {
    const availableHeight = layout.contentY - 12 - locationY;
    const maxLines = availableHeight >= 45 ? 2 : 1;
    const address = fittedText(location, nameWidth, maxLines, 20, 12);
    svg += renderLines(address.lines, x, locationY, address.size, muted, {weight:600, lineHeight:address.size * 1.16});
  }
  return svg;
}


// ======================================================
// CONTENT
// ======================================================

function shortDescription(value, limit = 170) {
  const text = cleanText(value).replace(/\s+/g, ' ');
  if (text.length <= limit) return text;
  // Only use complete sentences; never append a trailing ellipsis.
  const sentences = text.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [];
  let result = '';
  for (const sentence of sentences) {
    if ((result + sentence).trim().length > limit) break;
    result += sentence;
  }
  if (result.trim()) return result.trim();
  // If the input has no short sentence, finish at a word boundary.
  const words = text.slice(0, limit + 1);
  const prefix = words.slice(0, words.lastIndexOf(' ')).replace(/[,;:\s]+$/, '');
  return prefix ? prefix + '.' : text;
}

function parseAdvantages(value) {
  const raw = Array.isArray(value) ? value : cleanText(value).split(/\n|;|\s*\|\s*/);
  return raw.map(item => cleanText(item).replace(/^[•✓✔\-–\d.)\s]+/, '').trim()).filter(Boolean).slice(0, 5);
}

function drawContent(width, height, layout, template, colors, fields, theme) {
  const {productName, description, activeIngredient, targetPests, crops, usage, promoText, price, advantages} = fields;
  const dark = template === 'premiumAgri';
  const titleColor = template === 'boldProduct' ? theme : (dark ? '#FFFFFF' : colors.accent);
  const textColor = dark ? '#FFFFFF' : colors.text;
  const labelColor = dark ? '#DCEBDD' : titleColor;
  const border = dark ? 'rgba(255,255,255,0.2)' : colors.border;
  const p = width >= 1800 ? 34 : 25;
  const x = layout.leftX + p, w = layout.leftW - 2*p;
  const top = layout.contentY, bottom = top + layout.contentH - 17;
  const benefits = parseAdvantages(advantages);
  const sections = [];
  if (description) sections.push({label:'DESCRIPTION',value:shortDescription(description),type:'description'});
  if (benefits.length) sections.push({label:'ADVANTAGES',value:benefits,type:'advantages'});
  if (activeIngredient) sections.push({label:'ACTIVE INGREDIENT',value:activeIngredient,type:'detail'});
  if (targetPests) sections.push({label:'TARGETS',value:targetPests,type:'detail'});
  if (crops) sections.push({label:'CROPS / ANIMALS',value:crops,type:'detail'});
  if (usage) sections.push({label:'USAGE / MIXING',value:usage,type:'usage'});
  let chosen = null;
  for (let scale=1; scale>=0.50; scale-=0.025) {
    const titleFont=Math.round((height>=1800?47:41)*scale);
    const title=fittedText(productName,w,3,titleFont,Math.max(16,titleFont-2));
    const font=Math.max(15,Math.round((height>=1800?27:25)*scale));
    const labelFont=Math.max(13,Math.round(17*scale));
    const rows=sections.map(section=>{
      const lineHeight=font*1.2;
      const lines=section.type==='advantages'
        ? section.value.map(v=>wrapText(v,w-24,font)).flatMap((ls,i)=>ls.map((line,j)=>({text:line,bullet:j===0})))
        : wrapText(section.value,w-(section.type==='usage'?20:0),font).map(text=>({text,bullet:false}));
      return {...section,font,labelFont,lines,lineHeight,height:labelFont*1.3+10+lines.length*lineHeight+(section.type==='usage'?19:0)};
    });
    const total=25+title.lines.length*title.size*1.12+20+rows.reduce((n,r)=>n+r.height+17,0)+10;
    if(total<=layout.contentH-15){chosen={title,rows};break;}
  }
  if(!chosen){
    const title=fittedText(productName,w,2,21,16),font=15,labelFont=13,lineHeight=18;
    const available=layout.contentH-25-title.lines.length*title.size*1.12-35;
    const each=Math.max(25,(available-sections.length*17)/Math.max(1,sections.length));
    const rows=sections.map(section=>{
      const raw=section.type==='advantages'
        ? section.value.flatMap(v=>wrapText(v,w-24,font).map((text,i)=>({text,bullet:i===0})))
        : wrapText(section.value,w-20,font).map(text=>({text,bullet:false}));
      const count=Math.max(1,Math.floor((each-25-(section.type==='usage'?12:0))/lineHeight));
      const lines=raw.slice(0,count);
      return {...section,font,labelFont,lineHeight,lines,height:labelFont*1.3+10+lines.length*lineHeight+(section.type==='usage'?12:0)};
    });
    chosen={title,rows};
  }
  let svg=`<rect x="${layout.leftX}" y="${top}" width="${layout.leftW}" height="${layout.contentH}" rx="28" fill="${colors.panel}" stroke="${border}" stroke-width="2"/>`;
  svg+=`<rect x="${layout.rightX}" y="${top}" width="${layout.rightW}" height="${layout.contentH}" rx="28" fill="#FFFFFF" stroke="${border}" stroke-width="2"/><rect x="${layout.rightX}" y="${top}" width="9" height="${layout.contentH}" rx="4" fill="${theme}"/>`;
  // Price is deliberately on the PRODUCT IMAGE side, above the product.
  const badgeText=cleanText(price) || cleanText(promoText);
  if(badgeText){
    const bw=Math.min(layout.rightW-45,360), bx=layout.rightX+(layout.rightW-bw)/2, by=top+20;
    const badge=fittedText(badgeText,bw-28,2,25,15);
    svg+=`<rect x="${bx}" y="${by}" width="${bw}" height="72" rx="25" fill="${theme}"/>`;
    svg+=renderLines(badge.lines,bx+bw/2,by+36-(badge.lines.length-1)*badge.size*.47,badge.size,'#FFFFFF',{weight:900,anchor:'middle',lineHeight:badge.size*1.1});
  }
  let y=top+25;
  svg+=renderLines(chosen.title.lines,x,y+chosen.title.size,chosen.title.size,titleColor,{weight:900,lineHeight:chosen.title.size*1.12,family:'Trebuchet MS, Arial, sans-serif'});
  y+=chosen.title.lines.length*chosen.title.size*1.12+20;
  for(const row of chosen.rows){
    if(y+row.height>bottom) break;
    if(row.type==='usage') svg+=`<rect x="${x-7}" y="${y-6}" width="${w+14}" height="${row.height+7}" rx="13" fill="${colors.accentSoft}" stroke="${theme}" stroke-opacity="0.25"/>`;
    const inset=row.type==='usage'?8:0;
    svg+=renderLines([row.label],x+inset,y+row.labelFont,row.labelFont,labelColor,{weight:900});
    const lineY=y+row.labelFont*1.3+10+row.font;
    row.lines.forEach((line,i)=>{
      if(row.type==='advantages' && line.bullet) svg+=`<circle cx="${x+6}" cy="${lineY+i*row.lineHeight-row.font*.32}" r="3.5" fill="${theme}"/>`;
      svg+=renderLines([line.text],x+inset+(row.type==='advantages'?19:0),lineY+i*row.lineHeight,row.font,textColor,{weight:row.type==='description'?500:650});
    });
    y+=row.height+17;
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
        price,
        advantages,

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
          price: cleanText(price),
          advantages,
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
      // CREATE BASE IMAGE
      // ==================================================

      let image =
        sharp(
          Buffer.from(svg)
        ).png();


      // ==================================================
      // LOGO
      // ==================================================

      // An uploaded logo takes precedence; the fallback file is optional.
      const defaultLogoPath = path.join(__dirname, '..', 'assets', 'agriventure-logo.png');
      const uploadedLogoBuffer = dataUriToBuffer(logo);
      if (logo && !uploadedLogoBuffer) {
        throw new Error('The uploaded logo could not be decoded. Please select the logo again.');
      }
      const logoBuffer = uploadedLogoBuffer ||
        (fs.existsSync(defaultLogoPath) ? fs.readFileSync(defaultLogoPath) : null);
      if (!logoBuffer) console.warn('Poster logo missing: upload a logo or add the fallback file at', defaultLogoPath);


      if (logoBuffer) {

        try {

          const logoBox = finalSize === 'story' ? 170 : 145;


          const logoProcessed =
            await sharp(logoBuffer)
              .trim({ background: '#FFFFFF', threshold: 12 })
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

        } catch (error) {

          console.error('Logo processing failed:', error);
          throw error;
        }
      }


      // ==================================================
      // PRODUCT IMAGE
      // ======================================================

      const productBuffer =
        dataUriToBuffer(
          productImage
        );


      if (productBuffer) {

        try {

          // ------------------------------------------------
          // RIGHT SIDE IMAGE AREA
          // ------------------------------------------------

          const imageAreaX =
            layout.rightX + 18;

          const imageAreaY =
            layout.contentY + (cleanText(price) || cleanText(promoText) ? 108 : 18);

          const imageAreaW =
            layout.rightW - 36;

          const imageAreaH =
            layout.contentH - (cleanText(price) || cleanText(promoText) ? 126 : 36);


          // ------------------------------------------------
          // REMOVE WHITE BACKGROUND
          // ------------------------------------------------

          const transparentProduct =
            await removeWhiteBackground(
              productBuffer
            );


          // ------------------------------------------------
          // TRIM TRANSPARENT EDGES
          // ------------------------------------------------

          let trimmedProduct =
            transparentProduct;

          try {

            trimmedProduct =
              await sharp(
                transparentProduct
              )
                .trim({
                  background: {
                    r: 255,
                    g: 255,
                    b: 255,
                    alpha: 0,
                  },
                  threshold: 5,
                })
                .png()
                .toBuffer();

          } catch (trimError) {

            console.log(
              '⚠️ Product trim skipped:',
              trimError.message
            );
          }


          // ------------------------------------------------
          // PRODUCT SIZE
          // ------------------------------------------------

          const productW =
            Math.round(
              imageAreaW * 0.94
            );

          const productH =
            Math.round(
              imageAreaH * 0.94
            );


          // ------------------------------------------------
          // RESIZE PRODUCT
          // ------------------------------------------------

          const processed =
            await sharp(
              trimmedProduct
            )
              .resize(
                productW,
                productH,
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
          // PRODUCT METADATA
          // ------------------------------------------------

          const metadata =
            await sharp(
              processed
            ).metadata();


          const actualWidth =
            metadata.width ||
            productW;

          const actualHeight =
            metadata.height ||
            productH;


          // ------------------------------------------------
          // CENTER PRODUCT
          // ------------------------------------------------

          const left =
            Math.round(
              imageAreaX +
              (imageAreaW -
                actualWidth) / 2
            );


          const top =
            Math.round(
              imageAreaY +
              (imageAreaH -
                actualHeight) / 2
            );


          // ------------------------------------------------
          // COMPOSITE PRODUCT
          // ------------------------------------------------

          image =
            image.composite([
              {
                input: processed,

                top,

                left,
              },
            ]);


          console.log(
            '✅ Product image processed successfully'
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