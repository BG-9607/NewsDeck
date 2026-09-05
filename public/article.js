'use strict';

const $ = sel => document.querySelector(sel);

const ICONS = {
  top: '🌍', india: '🇮🇳', tech: '💻', business: '📈',
  science: '🔬', sports: '⚽', entertainment: '🎬',
};

function relTime(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return '1 min ago';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h > 1 ? 's' : ''} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d > 1 ? 's' : ''} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function safeUrl(raw) {
  try {
    const u = new URL(raw, location.href);
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch { return null; }
}

function applyTheme(mode) {
  if (mode) document.documentElement.dataset.theme = mode;
  else delete document.documentElement.dataset.theme;
}

async function main() {
  applyTheme(localStorage.getItem('newsdeck-theme'));

  const params = new URLSearchParams(location.search);
  const targetUrl = params.get('url') || '';
  const category = params.get('category') || 'top';
  const initialTitle = params.get('title') || '';
  const initialSource = params.get('source') || 'News';
  const initialSummary = params.get('summary') || '';
  const initialImage = params.get('image') || '';
  const initialAuthor = params.get('author') || '';
  const initialPublished = Number(params.get('publishedAt')) || 0;
  const initialAlso = (params.get('also') || '').split(',').filter(Boolean);

  // Update document title
  if (initialTitle) document.title = `${initialTitle} — Newsdeck`;

  // Back button preserve category hash
  const backBtn = $('#backBtn');
  backBtn.href = `/#${category}`;

  // Topbar Category Pill
  const topbarCat = $('#topbarCategory');
  topbarCat.textContent = `${ICONS[category] || '📰'} ${category[0].toUpperCase() + category.slice(1)}`;

  // Header meta
  $('#artSource').textContent = initialSource;
  $('#artCategory').textContent = category[0].toUpperCase() + category.slice(1);
  if (initialPublished) $('#artTime').textContent = relTime(initialPublished);
  if (initialAuthor) $('#artAuthor').textContent = `· by ${initialAuthor}`;

  // Heading
  $('#artTitle').textContent = initialTitle || 'News Article';

  // Hero image
  const artHero = $('#artHero');
  const artImg = $('#artImg');
  if (initialImage) {
    artHero.hidden = false;
    artImg.src = initialImage;
    artImg.onerror = () => { artHero.hidden = true; };
  }

  // Cross-coverage
  const artAlso = $('#artAlso');
  const artAlsoTags = $('#artAlsoTags');
  if (initialAlso.length) {
    artAlso.hidden = false;
    artAlsoTags.replaceChildren(...initialAlso.map(s => el('span', 'article-also-tag', s)));
  }

  // Overview / Lead box
  const artLeadBox = $('#artLeadBox');
  const artLeadText = $('#artLeadText');
  if (initialSummary) {
    artLeadBox.hidden = false;
    artLeadText.textContent = initialSummary;
  }

  // Source CTA
  const sourceHref = safeUrl(targetUrl) || '#';
  $('#extArticleBtn').href = sourceHref;
  $('#artCtaLink').href = sourceHref;
  $('#ctaSourceName').textContent = initialSource;
  $('#ctaBtnSourceName').textContent = initialSource;

  // Reading time initial estimation
  const wordCount = (initialTitle + ' ' + initialSummary).split(/\s+/).length;
  $('#artReadTime').textContent = `${Math.max(1, Math.round(wordCount / 40))} min read`;

  // Theme button
  $('#themeBtn').addEventListener('click', () => {
    const cur = localStorage.getItem('newsdeck-theme');
    const next = cur === 'dark' ? 'light' : cur === 'light' ? '' : 'dark';
    if (next) localStorage.setItem('newsdeck-theme', next);
    else localStorage.removeItem('newsdeck-theme');
    applyTheme(next);
  });

  // Copy article link
  $('#copyArticleBtn').addEventListener('click', async () => {
    const btn = $('#copyArticleBtn');
    try {
      await navigator.clipboard.writeText(targetUrl || location.href);
      const prev = btn.textContent;
      btn.textContent = '✓';
      btn.title = 'Link copied!';
      setTimeout(() => {
        btn.textContent = prev;
        btn.title = 'Copy article link';
      }, 1400);
    } catch {}
  });

  // Keyboard navigation
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' || (e.key === 'Backspace' && e.target === document.body)) {
      location.href = `/#${category}`;
    } else if (e.key === 't' && e.target === document.body) {
      $('#themeBtn').click();
    }
  });

  // Load Full Article Content
  const bodyEl = $('#artBody');
  if (targetUrl) {
    try {
      const res = await fetch(`/api/article?url=${encodeURIComponent(targetUrl)}`);
      const data = await res.json();
      bodyEl.replaceChildren();

      if (data.ok && data.article) {
        const art = data.article;
        if (art.title && !initialTitle) {
          $('#artTitle').textContent = art.title;
          document.title = `${art.title} — Newsdeck`;
        }
        if (art.author && !initialAuthor) {
          $('#artAuthor').textContent = `· by ${art.author}`;
        }
        if (art.image && !initialImage) {
          artHero.hidden = false;
          artImg.src = art.image;
        }
        if (art.publishedAt && !initialPublished) {
          $('#artTime').textContent = relTime(art.publishedAt);
        }

        if (art.wordCount > 0) {
          const mins = Math.max(1, Math.ceil(art.wordCount / 180));
          $('#artReadTime').textContent = `${mins} min read · ${art.wordCount} words`;
        }

        if (art.description && !initialSummary) {
          artLeadBox.hidden = false;
          artLeadText.textContent = art.description;
        }

        if (art.content && art.content.length > 0) {
          for (const block of art.content) {
            if (block.type === 'h2' || block.type === 'h3') {
              bodyEl.appendChild(el(block.type, 'article-subheading', block.text));
            } else if (block.type === 'quote') {
              bodyEl.appendChild(el('blockquote', 'article-quote', block.text));
            } else {
              bodyEl.appendChild(el('p', 'article-p', block.text));
            }
          }
        } else {
          // Fallback if content was not scraped
          const p = el('p', 'article-p', initialSummary || 'Full report text could not be parsed from source layout.');
          bodyEl.appendChild(p);
          const notice = el('div', 'article-notice', 'To read the full unedited story with interactive elements and live updates, continue to the publisher source using the button below.');
          bodyEl.appendChild(notice);
        }
      } else {
        const p = el('p', 'article-p', initialSummary || 'This article could not be loaded in reader mode.');
        bodyEl.appendChild(p);
      }
    } catch (err) {
      bodyEl.replaceChildren();
      if (initialSummary) {
        bodyEl.appendChild(el('p', 'article-p', initialSummary));
      }
      bodyEl.appendChild(el('div', 'article-notice', `Preview mode (Could not fetch full text: ${err.message}).`));
    }
  }

  // Load Related Stories in this Category
  $('#relatedCatName').textContent = category[0].toUpperCase() + category.slice(1);
  try {
    const res = await fetch(`/api/news?category=${encodeURIComponent(category)}`);
    if (res.ok) {
      const data = await res.json();
      const otherStories = (data.items || [])
        .filter(item => item.link !== targetUrl && item.title !== initialTitle)
        .slice(0, 4);

      const grid = $('#relatedGrid');
      grid.replaceChildren(...otherStories.map(item => {
        const card = el('a', 'card related-card');
        const href = `/article.html?url=${encodeURIComponent(item.link)}&category=${encodeURIComponent(category)}&id=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title)}&source=${encodeURIComponent(item.source)}&publishedAt=${item.publishedAt || 0}&author=${encodeURIComponent(item.author || '')}&summary=${encodeURIComponent(item.summary || '')}&image=${encodeURIComponent(item.image || '')}&also=${encodeURIComponent((item.alsoIn || []).join(','))}`;
        card.href = href;

        if (item.image) {
          const thumb = el('img', 'thumb');
          thumb.src = item.image;
          thumb.alt = '';
          thumb.loading = 'lazy';
          thumb.referrerPolicy = 'no-referrer';
          thumb.addEventListener('error', () => thumb.remove(), { once: true });
          card.appendChild(thumb);
        }

        const b = el('div', 'card-body');
        const meta = el('div', 'meta');
        meta.appendChild(el('span', 'badge', item.source));
        meta.appendChild(el('span', 'time', relTime(item.publishedAt)));
        b.appendChild(meta);
        b.appendChild(el('h3', 'related-title', item.title));
        card.appendChild(b);
        return card;
      }));
    }
  } catch {}
}

main();
