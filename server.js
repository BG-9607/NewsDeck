'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const FEEDS = require('./feeds');
const { parseFeed, dedupeKey } = require('./parser');

const PORT = Number(process.env.PORT) || 3000;
const REFRESH_MS = Number(process.env.REFRESH_MS) || 90_000;
const FETCH_TIMEOUT_MS = 12_000;
const MAX_ITEMS = 120;
const MAX_AGE_MS = 36 * 3600_000; // retained stories older than this are dropped
const ACTIVE_WINDOW_MS = 10 * 60_000; // only poll categories someone looked at recently

const CATEGORIES = Object.keys(FEEDS);
const UA = 'Mozilla/5.0 (compatible; NewsdeckBot/1.0; +local dashboard)';

/** @type {Map<string, {items: any[], updatedAt: number, sources: any[]}>} */
const cache = new Map();
/** category -> timestamp of last client interest */
const lastRequested = new Map();
/** Set of SSE clients: { res, category, id } */
const clients = new Set();
/** category -> in-flight refresh promise, so callers coalesce onto one fetch */
const inflight = new Map();
let clientSeq = 0;

// ---------------------------------------------------------------- fetching

const sleep = ms => new Promise(r => setTimeout(r, ms));

function errLabel(err) {
  if (err.name === 'AbortError') return 'timeout';
  const code = err.cause && (err.cause.code || err.cause.message);
  return code ? String(code) : err.message;
}

async function fetchOnce(feed) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseFeed(xml, feed.name);
    if (!items.length) throw new Error('no items parsed');
    return { ok: true, name: feed.name, items };
  } finally {
    clearTimeout(timer);
  }
}

// Upstreams reset connections fairly often; a couple of quick retries turns
// most "fetch failed" noise into a successful load.
async function fetchFeed(feed, attempts = 3) {
  let last = 'unknown';
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchOnce(feed);
    } catch (err) {
      last = errLabel(err);
      // A real HTTP error (404/410) won't fix itself — stop early.
      if (/^HTTP 4/.test(last)) break;
      if (i < attempts - 1) await sleep(400 * (i + 1) + Math.random() * 300);
    }
  }
  return { ok: false, name: feed.name, items: [], error: last };
}

function mergeItems(results) {
  const seen = new Map();
  const all = [];
  for (const r of results) {
    for (const item of r.items) {
      const key = dedupeKey(item);
      if (!key) continue;
      const existing = seen.get(key);
      if (existing) {
        // Same story from another outlet: keep the richer copy, note the dupe.
        if (!existing.image && item.image) existing.image = item.image;
        if (!existing.summary && item.summary) existing.summary = item.summary;
        if (!existing.alsoIn.includes(item.source)) existing.alsoIn.push(item.source);
        continue;
      }
      const entry = { ...item, alsoIn: [], id: key };
      seen.set(key, entry);
      all.push(entry);
    }
  }
  // Undated items sink below dated ones rather than jumping to the top.
  all.sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  return all.slice(0, MAX_ITEMS);
}

// Union a fresh fetch with what we already had, so that one flaky source does
// not make stories the reader has already seen vanish from the deck.
function unionItems(fresh, previous) {
  const byId = new Map();
  for (const item of fresh) byId.set(item.id, item);
  for (const item of previous) if (!byId.has(item.id)) byId.set(item.id, item);

  const now = Date.now();
  return [...byId.values()]
    .filter(i => !i.publishedAt || now - i.publishedAt < MAX_AGE_MS)
    .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))
    .slice(0, MAX_ITEMS);
}

// Callers arriving while a fetch is already running wait for that same fetch
// rather than getting an empty cache back.
function refresh(category, opts = {}) {
  if (!FEEDS[category]) return Promise.resolve(undefined);
  const existing = inflight.get(category);
  if (existing) return existing;
  const run = doRefresh(category, opts).finally(() => inflight.delete(category));
  inflight.set(category, run);
  return run;
}

async function doRefresh(category, { notify = true } = {}) {
  // NB: pass an arrow, not `fetchFeed` directly — map's index arg would
  // otherwise land in the `attempts` parameter.
  const results = await Promise.all(FEEDS[category].map(feed => fetchFeed(feed)));
  const items = mergeItems(results);
  if (!items.length) {
    // Every source failed — keep whatever we had rather than blanking the UI.
    const prev = cache.get(category);
    if (prev) {
      prev.sources = results.map(r => ({ name: r.name, ok: r.ok, error: r.error, count: r.items.length }));
      return prev;
    }
  }
  const prev = cache.get(category);
  const known = new Set(prev ? prev.items.map(i => i.id) : []);
  const fresh = prev ? items.filter(i => !known.has(i.id)) : [];
  const merged = prev ? unionItems(items, prev.items) : items;

  const entry = {
    items: merged,
    updatedAt: Date.now(),
    sources: results.map(r => ({ name: r.name, ok: r.ok, error: r.error, count: r.items.length })),
  };
  cache.set(category, entry);

  const okCount = results.filter(r => r.ok).length;
  console.log(
    `[${new Date().toISOString().slice(11, 19)}] ${category}: ${items.length} items, ` +
    `${okCount}/${results.length} sources ok${fresh.length ? `, ${fresh.length} new` : ''}`
  );
  for (const r of results.filter(r => !r.ok)) console.log(`    ! ${r.name}: ${r.error}`);

  if (notify && fresh.length) broadcast(category, fresh, entry);
  return entry;
}

async function getCategory(category) {
  const hit = cache.get(category);
  lastRequested.set(category, Date.now());
  if (hit && Date.now() - hit.updatedAt < REFRESH_MS) return hit;
  return (await refresh(category, { notify: !!hit })) || { items: [], updatedAt: Date.now(), sources: [] };
}

// ---------------------------------------------------------------- SSE

function broadcast(category, fresh, entry) {
  const payload = JSON.stringify({
    type: 'update',
    category,
    updatedAt: entry.updatedAt,
    newCount: fresh.length,
    items: entry.items,
  });
  for (const c of clients) {
    if (c.category !== category) continue;
    try {
      c.res.write(`event: update\ndata: ${payload}\n\n`);
    } catch {
      clients.delete(c);
    }
  }
}

function handleStream(req, res, category) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');

  const client = { res, category, id: ++clientSeq };
  clients.add(client);
  lastRequested.set(category, Date.now());

  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { cleanup(); }
  }, 25_000);

  function cleanup() {
    clearInterval(ping);
    clients.delete(client);
  }
  req.on('close', cleanup);
  req.on('error', cleanup);
}

// ---------------------------------------------------------------- static

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

const PUBLIC_DIR = path.join(__dirname, 'public');

function serveStatic(urlPath, res) {
  const rel = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const full = path.join(PUBLIC_DIR, rel);
  // Block traversal outside public/.
  if (!full.startsWith(PUBLIC_DIR + path.sep) && full !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function sendJSON(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

// ---------------------------------------------------------------- routes

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  const { pathname, searchParams } = url;

  try {
    if (pathname === '/api/categories') {
      return sendJSON(res, 200, {
        categories: CATEGORIES.map(c => ({
          id: c,
          label: c[0].toUpperCase() + c.slice(1),
          sources: FEEDS[c].map(f => f.name),
        })),
      });
    }

    if (pathname === '/api/news') {
      const category = CATEGORIES.includes(searchParams.get('category'))
        ? searchParams.get('category')
        : 'top';
      const entry = await getCategory(category);
      const q = (searchParams.get('q') || '').trim().toLowerCase();
      let items = entry.items;
      if (q) {
        items = items.filter(i =>
          i.title.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q) ||
          i.source.toLowerCase().includes(q)
        );
      }
      return sendJSON(res, 200, {
        category,
        items,
        updatedAt: entry.updatedAt,
        sources: entry.sources,
        refreshMs: REFRESH_MS,
      });
    }

    if (pathname === '/api/stream') {
      const category = CATEGORIES.includes(searchParams.get('category'))
        ? searchParams.get('category')
        : 'top';
      return handleStream(req, res, category);
    }

    if (pathname === '/api/refresh' && req.method === 'POST') {
      const category = CATEGORIES.includes(searchParams.get('category'))
        ? searchParams.get('category')
        : 'top';
      const entry = await refresh(category, { notify: true });
      return sendJSON(res, 200, { ok: true, updatedAt: entry?.updatedAt || 0 });
    }

    if (pathname.startsWith('/api/')) return sendJSON(res, 404, { error: 'Unknown endpoint' });

    return serveStatic(pathname, res);
  } catch (err) {
    console.error('request failed:', err);
    if (!res.headersSent) sendJSON(res, 500, { error: 'Internal error' });
    else res.end();
  }
});

// ---------------------------------------------------------------- lifecycle

function activeCategories() {
  const now = Date.now();
  const live = new Set(['top']);
  for (const c of clients) live.add(c.category);
  for (const [cat, ts] of lastRequested) {
    if (now - ts < ACTIVE_WINDOW_MS) live.add(cat);
  }
  return [...live].filter(c => FEEDS[c]);
}

async function refreshLoop() {
  for (const cat of activeCategories()) {
    await refresh(cat, { notify: true });
  }
}

server.listen(PORT, () => {
  console.log(`\n  Newsdeck running → http://localhost:${PORT}`);
  console.log(`  ${CATEGORIES.length} categories, refresh every ${Math.round(REFRESH_MS / 1000)}s\n`);
  refresh('top', { notify: false });
  setInterval(() => { refreshLoop().catch(e => console.error('refresh loop:', e)); }, REFRESH_MS);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log('\nShutting down…');
    for (const c of clients) { try { c.res.end(); } catch {} }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
