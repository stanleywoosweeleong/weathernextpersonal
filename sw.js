// ============================================================
// WeatherNext Service Worker
// Version 1.0.0 — bump CACHE_VERSION on each release
// ============================================================

const CACHE_VERSION = 'wnpersonal-v0.6.4';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const WEATHER_CACHE = `${CACHE_VERSION}-weather`;

// Files that make up the app shell (offline-ready core)
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './favicon-32.png',
  './apple-touch-icon.png',
  // External CDN assets — cache so app loads fully offline after first visit
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// ============================================================
// INSTALL — pre-cache the app shell
// ============================================================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing version', CACHE_VERSION);
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => {
        // Use addAll with a fallback per-item to survive a single failure.
        // Cross-origin CDN assets (cdn.tailwindcss.com, cdnjs) often lack CORS headers
        // for fetch() pre-caching. Use 'no-cors' mode for them — produces an opaque
        // response which is cacheable but not introspectable (fine for static assets).
        return Promise.allSettled(
          SHELL_ASSETS.map((url) => {
            const isCrossOrigin = url.startsWith('http') && !url.startsWith(self.location.origin);
            const reqInit = isCrossOrigin
              ? { cache: 'reload', mode: 'no-cors', credentials: 'omit' }
              : { cache: 'reload' };
            return cache.add(new Request(url, reqInit)).catch((err) => {
              // Quiet failure — pre-cache is opportunistic, runtime fetch will still work
              console.warn('[SW] Pre-cache skipped for', url, '(will fetch on demand)');
            });
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

// ============================================================
// ACTIVATE — clean up old cache versions
// ============================================================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version', CACHE_VERSION);
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => {
              console.log('[SW] Deleting old cache:', key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

// ============================================================
// FETCH — routing strategy per request type
// ============================================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // 1. Firebase, Gemini, Google APIs — NEVER cache (auth + real-time)
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebase') ||
    url.hostname.includes('gstatic.com') && url.pathname.includes('firebasejs')
  ) {
    // Network-only, but allow graceful failure
    event.respondWith(
      fetch(request).catch(() => {
        return new Response(
          JSON.stringify({ error: 'offline', message: 'Network unavailable' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
      })
    );
    return;
  }

  // 2. Open-Meteo weather API — network-first with cache fallback (stale weather > no weather)
  if (url.hostname.includes('open-meteo.com')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache successful weather responses for offline fallback
          if (response.ok) {
            const clone = response.clone();
            caches.open(WEATHER_CACHE).then((cache) => {
              cache.put(request, clone);
              // Trim cache to prevent unbounded growth (keep ~30 most recent)
              trimCache(WEATHER_CACHE, 30);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            return cached || new Response(
              JSON.stringify({ error: 'offline', hourly: null }),
              { status: 503, headers: { 'Content-Type': 'application/json' } }
            );
          });
        })
    );
    return;
  }

  // 3. Navigation (HTML) — network-first with offline fallback to cached shell
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Update the shell cache with fresh HTML
          if (response.ok) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request)
            .then((cached) => cached || caches.match('./index.html'))
            .then((fallback) => fallback || caches.match('./'));
        })
    );
    return;
  }

  // 4. CDN scripts (Tailwind, html2canvas) — cache-first (rarely changes).
  // Cross-origin CDNs without CORS headers need no-cors mode to be cacheable.
  if (url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('cdn.tailwindcss.com')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          // Refresh in background (no-cors to handle CORS-restricted CDNs)
          fetch(request, { mode: 'no-cors' }).then((response) => {
            // Opaque responses have status 0 but are still cacheable
            if (response && (response.ok || response.type === 'opaque')) {
              caches.open(SHELL_CACHE).then((cache) => cache.put(request, response));
            }
          }).catch(() => {});
          return cached;
        }
        return fetch(request, { mode: 'no-cors' }).then((response) => {
          if (response && (response.ok || response.type === 'opaque')) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 5. Everything else (same-origin assets) — stale-while-revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// ============================================================
// HELPER — trim cache to max size (LRU-ish)
// ============================================================
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    // Delete oldest entries (keys() returns insertion order)
    await Promise.all(
      keys.slice(0, keys.length - maxItems).map((key) => cache.delete(key))
    );
  }
}

// ============================================================
// MESSAGE — allow the app to trigger SW updates
// ============================================================
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data === 'CLEAR_CACHE') {
    caches.keys().then((keys) => {
      keys.forEach((key) => caches.delete(key));
    });
  }
});
