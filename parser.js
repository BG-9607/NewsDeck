'use strict';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  mdash: '—', ndash: '–', hellip: '…', eacute: 'é',
  aacute: 'á', oacute: 'ó', uacute: 'ú', iacute: 'í',
  ntilde: 'ñ', uuml: 'ü', ouml: 'ö', auml: 'ä',
  egrave: 'è', agrave: 'à', ccedil: 'ç', deg: '°',
  pound: '£', euro: '€', copy: '©', reg: '®',
  trade: '™', bull: '•', middot: '·',
};

function decodeEntities(s) {
  if (!s) return '';
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, ent) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X'
        ? parseInt(ent.slice(2), 16)
        : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try { return String.fromCodePoint(code); } catch { return m; }
    }
    const lower = ent.toLowerCase();
    return Object.prototype.hasOwnProperty.call(ENTITIES, lower) ? ENTITIES[lower] : m;
  });
}

// Strip markup, collapse whitespace, decode entities (twice: feeds often double-encode).
function clean(s, maxLen) {
  if (!s) return '';
  let out = decodeEntities(String(s));
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '')
           .replace(/<style[\s\S]*?<\/style>/gi, '')
           .replace(/<[^>]*>/g, ' ');
  out = decodeEntities(out).replace(/\s+/g, ' ').trim();
  if (maxLen && out.length > maxLen) {
    out = out.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
  }
  return out;
}

// Pull the inner text of the first <tag>...</tag>, honouring CDATA.
function tagText(xml, ...names) {
  for (const name of names) {
    const re = new RegExp(String.raw`<${name}(?:\s[^>]*)?\s*(?:/>|>([\s\S]*?)</${name}\s*>)`, 'i');
    const m = re.exec(xml);
    if (m && m[1] != null) {
      const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(m[1]);
      const raw = cdata ? cdata[1] : m[1];
      if (raw && raw.trim()) return raw.trim();
    }
  }
  return '';
}

function attr(tagStr, name) {
  const m = new RegExp(String.raw`\b${name}\s*=\s*("([^"]*)"|'([^']*)')`, 'i').exec(tagStr || '');
  return m ? decodeEntities(m[2] != null ? m[2] : m[3]) : '';
}

function extractLink(block) {
  // Atom: prefer rel="alternate" (or no rel) with an href.
  const atomLinks = block.match(/<link\b[^>]*>/gi) || [];
  let fallback = '';
  for (const l of atomLinks) {
    const href = attr(l, 'href');
    if (!href) continue;
    const rel = (attr(l, 'rel') || 'alternate').toLowerCase();
    if (rel === 'alternate') return href;
    if (!fallback) fallback = href;
  }
  // RSS: <link>url</link>
  const rss = tagText(block, 'link');
  if (rss && /^https?:/i.test(rss)) return rss;
  return fallback || tagText(block, 'guid', 'id');
}

function extractImage(block) {
  const patterns = [
    /<media:content\b[^>]*>/i,
    /<media:thumbnail\b[^>]*>/i,
    /<enclosure\b[^>]*>/i,
    /<itunes:image\b[^>]*>/i,
  ];
  for (const re of patterns) {
    const m = re.exec(block);
    if (m) {
      const url = attr(m[0], 'url') || attr(m[0], 'href');
      const type = attr(m[0], 'type');
      if (url && (!type || /image/i.test(type)) && /^https?:/i.test(url)) return url;
    }
  }
  const inline = /<img\b[^>]*\bsrc\s*=\s*("([^"]+)"|'([^']+)')/i.exec(block);
  if (inline) {
    const url = decodeEntities(inline[2] || inline[3]);
    if (/^https?:/i.test(url)) return url;
  }
  return '';
}

function parseDate(block) {
  const raw = tagText(block, 'pubDate', 'published', 'updated', 'dc:date', 'date');
  if (raw) {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) return t;
  }
  return 0;
}

// Accepts an RSS 2.0, RDF or Atom document. Returns normalised items.
function parseFeed(xml, source) {
  if (!xml || typeof xml !== 'string') return [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1\s*>/gi) || [];
  const items = [];

  for (const block of blocks) {
    const title = clean(tagText(block, 'title'), 200);
    const link = extractLink(block);
    if (!title || !link) continue;

    const body = tagText(block, 'description', 'summary', 'content:encoded', 'content');
    items.push({
      title,
      link: link.trim(),
      summary: clean(body, 260),
      source,
      author: clean(tagText(block, 'dc:creator', 'author', 'creator'), 60),
      image: extractImage(block),
      publishedAt: parseDate(block),
    });
  }
  return items;
}

// Normalised key for cross-source duplicate detection.
function dedupeKey(item) {
  return item.title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 9)
    .join(' ');
}

module.exports = { parseFeed, clean, decodeEntities, dedupeKey };
