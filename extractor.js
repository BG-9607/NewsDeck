'use strict';

const { decodeEntities, clean } = require('./parser');

function getMeta(html, nameOrProp) {
  const patterns = [
    new RegExp(`<meta\\b[^>]*(?:name|property|itemprop)=["'](?:og:|twitter:|article:)?${nameOrProp}["'][^>]*content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*(?:name|property|itemprop)=["'](?:og:|twitter:|article:)?${nameOrProp}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && m[1]) return decodeEntities(m[1].trim());
  }
  return '';
}

function resolveUrl(relative, base) {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

function extractArticle(html, targetUrl) {
  if (!html || typeof html !== 'string') {
    return { title: '', image: '', author: '', publishedAt: 0, content: [], wordCount: 0 };
  }

  // 1. Extract high-level metadata
  const title = getMeta(html, 'title') ||
    clean((/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1], 200);

  const description = getMeta(html, 'description');
  let image = getMeta(html, 'image');
  if (image && targetUrl) image = resolveUrl(image, targetUrl);

  const author = getMeta(html, 'author') || getMeta(html, 'creator');
  const siteName = getMeta(html, 'site_name');

  const rawDate = getMeta(html, 'published_time') || getMeta(html, 'date') || getMeta(html, 'pubdate');
  const publishedAt = rawDate ? (Date.parse(rawDate) || 0) : 0;

  // 2. Remove script, style, comments, nav, footer, sidebar, ads
  let doc = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
    .replace(/<form\b[\s\S]*?<\/form>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, '')
    .replace(/<header\b[\s\S]*?<\/header>/gi, '')
    .replace(/<footer\b[\s\S]*?<\/footer>/gi, '')
    .replace(/<aside\b[\s\S]*?<\/aside>/gi, '');

  // 3. Find primary content container if possible
  const containerMatches = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<div\b[^>]*(?:class|id)=["'][^"']*(?:article-body|story-body|story-content|entry-content|post-content|article__body|article-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ];

  let bodyHtml = doc;
  for (const re of containerMatches) {
    const m = re.exec(doc);
    if (m && m[1] && m[1].length > 300) {
      bodyHtml = m[1];
      break;
    }
  }

  // 4. Extract structured blocks (paragraphs, subheadings, blockquotes)
  const blockRegex = /<(p|h2|h3|blockquote)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const content = [];
  let m;

  const boilerplateFilters = [
    /^(follow us on|sign up for|subscribe to|read more:|also read:|copyright|all rights reserved|terms of service|privacy policy|advertisement|photo:|image:|source:)/i,
    /cookie policy|newsletter|download our app/i,
  ];

  while ((m = blockRegex.exec(bodyHtml)) !== null) {
    const tag = m[1].toLowerCase();
    const rawText = m[2];
    const text = clean(rawText);

    // Skip empty or trivial snippets
    if (!text || (tag === 'p' && text.length < 24)) continue;

    // Filter out common promo/boilerplate lines
    const isBoilerplate = boilerplateFilters.some(re => re.test(text));
    if (isBoilerplate) continue;

    content.push({
      type: tag === 'blockquote' ? 'quote' : tag,
      text,
    });
  }

  // Fallback: If no blocks found in container, try searching all <p> in doc
  if (content.length === 0) {
    const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = pRegex.exec(doc)) !== null) {
      const text = clean(m[1]);
      if (text && text.length >= 30 && !boilerplateFilters.some(re => re.test(text))) {
        content.push({ type: 'p', text });
      }
    }
  }

  const wordCount = content.reduce((acc, b) => acc + b.text.split(/\s+/).length, 0);

  return {
    title,
    description,
    image,
    author,
    siteName,
    publishedAt,
    content,
    wordCount,
  };
}

module.exports = { extractArticle };
