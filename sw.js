// ============================================================
//  SBD 2026 — ITN Distribution Survey · Service Worker
//  BUMP THIS VERSION STRING every time you upload new files:
const CACHE_VERSION = 'sbd-2026-v9';
// ============================================================

// ── YOUR MAIN APP FILES ───────────────────────────────────────
const APP_FILES = [
  './index.html',
  './script_option2.js',
  './ai_agent.js',
  './manifest.json',
  './offline.html',
  './icon-maskable-512.png',
  // ── CSV DATA FILES ──────────────────────────────────────────
  // Add ALL csv files used by any HTML in your repo here
  './cascading_data.csv',        // main app — school locations
  './itn_movement_users.csv',     // itn_movement.html — users/staff
  './users_phu.csv',              // itn_received.html — PHU users
];

// ── MODULE HTML FILES + THEIR OWN ASSETS ────────────────────
// Each module HTML is cached so it works offline.
// If a module uses its own CSV/JS files, add them here too.
const MODULE_FILES = [
  './assessment.html',
  './itn_movement.html',
  './itn_received.html',
  './monitoring.html',
  './itn_reconciliation.html',
  './device_tracking.html',
  './attendance_payment.html',
  './distribution_report.html',
];

// ── CDN LIBRARIES ─────────────────────────────────────────────
const CDN_FILES = [
  'https://fonts.googleapis.com/css2?family=Oswald:wght@300;400;500;600;700&display=swap',
  'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js',
  'https://cdn.jsdelivr.net/npm/signature_pad@4.1.7/dist/signature_pad.umd.min.js',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js',
];

// ── OPTIONAL (cached if they exist, silently skipped if not) ──
const OPTIONAL_FILES = [
  './ICF-SL.jpg',
  './infographics.png',
  './logo_mohs.png',
  './logo_nmcp.png',
  './logo_pmi.png',
  './favicon.svg',
];

// ── NEVER CACHE — always go to live network ───────────────────
const NEVER_CACHE = [
  'script.google.com',
  'docs.google.com',
  'api.anthropic.com',
];

// ── CDN origins allowed to be cached ─────────────────────────
const CACHE_EXTERNAL = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
];

// ─────────────────────────────────────────────────────────────
function toAbs(url) {
  return url.startsWith('http') ? url : new URL(url, self.location.href).href;
}

// Cache one URL — never throws, silently skips failures
async function cacheOne(cache, url) {
  try { await cache.add(url); }
  catch(e) { console.warn('[SW] Skipped:', url, '-', e.message); }
}

// ── INSTALL ───────────────────────────────────────────────────
// Cache everything. Never fail install due to a single missing file.
self.addEventListener('install', event => {
  console.log('[SW] Install', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async cache => {
      // Required files — cache in parallel
      const required = [...APP_FILES, ...MODULE_FILES, ...CDN_FILES];
      await Promise.all(required.map(u => cacheOne(cache, toAbs(u))));
      // Optional files — best effort
      await Promise.all(OPTIONAL_FILES.map(u => cacheOne(cache, toAbs(u))));
      console.log('[SW] Cache ready —', CACHE_VERSION);
      return self.skipWaiting(); // activate immediately
    })
  );
});

// ── ACTIVATE ──────────────────────────────────────────────────
// Wipe ALL old caches and take control of every open tab
self.addEventListener('activate', event => {
  console.log('[SW] Activate', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────────────
// Strategy: Cache-first → network fallback → offline page
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = event.request.url;

  // Always go to network for GAS / Sheets / Claude
  if (NEVER_CACHE.some(p => url.includes(p))) return;

  // Skip unknown external origins (not in our allowed CDN list)
  const reqOrigin = new URL(url).hostname;
  const isExternal = !url.startsWith(self.location.origin);
  const isAllowedCDN = CACHE_EXTERNAL.some(o => reqOrigin.includes(o));
  if (isExternal && !isAllowedCDN) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        // Serve from cache instantly + refresh in background
        fetch(event.request)
          .then(r => {
            if (r && r.status === 200) {
              const rc = r.clone();
              caches.open(CACHE_VERSION).then(c => c.put(event.request, rc));
            }
          })
          .catch(() => {});
        return cached;
      }
      // Not cached — fetch and store
      return fetch(event.request)
        .then(r => {
          if (!r || r.status !== 200) return r;
          caches.open(CACHE_VERSION).then(c => c.put(event.request, r.clone()));
          return r;
        })
        .catch(() => {
          // Network failed — return offline page for navigation
          if (event.request.mode === 'navigate')
            return caches.match(new URL('./offline.html', self.location.href).href);
          return new Response('', { status: 503 });
        });
    })
  );
});

// ── MESSAGES ──────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data.type === 'CLEAR_CACHE')  caches.delete(CACHE_VERSION);
});

// ── BACKGROUND SYNC ───────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-submissions')
    console.log('[SW] Background sync triggered');
});
