# 📰 Newsdeck

A real-time news dashboard. It aggregates ~40 public RSS/Atom feeds across 7 categories,
de-duplicates stories that ran in multiple outlets, and pushes new headlines to the browser
as they appear — no refreshing, no API keys, no dependencies.

## Run it

```bash
node server.js
```

Then open <http://localhost:3000>.

## What it does

- **Live updates.** The browser holds a Server-Sent Events connection. The server re-polls
  each active category every 90s and pushes only when something genuinely new appeared.
  If you're scrolled down, updates are held behind a "*N* new stories" button so the page
  never jumps under you.
- **7 categories** — World, India, Tech, Business, Science, Sports, Entertainment — in a menu
  that stays tucked away until you press `☰` (or `m`), then slides in over the page. It closes
  on Escape, on a click outside, or once you've picked a category, so headlines get the full
  width of the window. Connection status stays visible as a dot in the toolbar.
- **In-App Reader Modal.** Clicking any news card opens a distraction-free reader modal with the complete summary, reading time estimate, featured image, cross-source references, copyable article link, and quick jump to the original source.
- **Cross-source de-duplication.** The same story from Reuters and the BBC collapses into one
  card, tagged "also on …".
- **Source health.** A panel in the sidebar shows which feeds responded and how many items
  each returned, so a silently dead feed is visible rather than mysterious.
- **Resilient.** Feeds are fetched in parallel with a 12s timeout and 3 retries; a failing
  source degrades that one row, never the page. Stories already on screen are retained across
  refreshes, so a flaky feed can't make headlines you just saw disappear.
- **Search** across headline, summary and source, filtered live as you type.
- **Light / dark / system** theming, and a layout that works down to phone width.

### Keyboard

| Key | Action |
| --- | --- |
| `m` | open / close the menu |
| `/` | focus search |
| `1`–`7` | jump to category |
| `r` | refresh now |
| `t` | cycle theme |
| `←` / `j` | previous story (in reader modal) |
| `→` / `k` | next story (in reader modal) |
| `Esc` | close reader modal, close menu, or leave search |

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `REFRESH_MS` | `90000` | how often active categories are re-polled |

```bash
PORT=8080 REFRESH_MS=60000 node server.js
```

To change the sources, edit [`feeds.js`](feeds.js) — it's a plain map of category → `{ name, url }`.
Any RSS 2.0, RDF or Atom feed works.

## Layout

| File | Role |
| --- | --- |
| `server.js` | HTTP + SSE server, fetch scheduling, cache, de-duplication |
| `parser.js` | dependency-free RSS/Atom parser (CDATA, entities, media images) |
| `feeds.js` | the source list |
| `public/` | dashboard UI (vanilla JS, no build step) |

## Notes

Only categories someone has looked at in the last 10 minutes are polled, plus World — so an
idle tab doesn't hammer publishers. Requests are cached server-side and shared by all clients.

Feeds are fetched server-side, which keeps the browser free of CORS problems and means each
publisher sees one request per refresh regardless of how many tabs you have open.
