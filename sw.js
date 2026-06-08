// ============================================================
// WeatherNext Service Worker — Personal (generic personalizable build)
// MIGRATED to the full Raub/Cameron microclimate architecture. This is the
// GENERIC build for friends who want hyperlocal weather without joining the
// WhatsApp groups. KEY DIFFERENCES from the regional builds:
//   - seedLocs is EMPTY (seeds no farms) — each friend adds their own via +
//   - NO name seed — NAME_KEY left unset; each friend sets their own name
//   - NO region identity — branding is plain '农友天气 WeatherNext'
//   - AI prompt is location-name-free (a friend may be anywhere in Malaysia);
//     it reasons from each location's real coordinates + live weather
// Carries the FULL engine (per Stanley's choice): microclimate disease-risk
// (6-disease + Phase-2 tiers), fog engine, 29-crop list, coordinate-aware
// terrain note, broadcast GPS sort, Open-Meteo rate-limit throttling + retry,
// storm-confidence wording, AI-greeting crop-owner fix, REAL model-run freshness
// header, gift-flow deep-link receiver, swipe share + edit name/GPS. A grower
// friend gets disease/fog advice once they add a farm; a casual friend who adds
// a home location simply sees forecast + general briefing (no crop = no crop
// advice). Boot screen sky-blue (#84d2f8) to match the sun/field icon.
// Identity: namespace weathernextpersonal, appId wnext-ag-v41-weathernextpersonal,
// seed version personal-arch1. bump CACHE_VERSION on each release
// ------------------------------------------------------------
// BROADCAST CLARITY PORT (from Raub v1.3.0–v1.3.14, applied 2026-06-05):
// the WhatsApp broadcast text builder (buildBroadcastText) was replaced wholesale
// with the refined Raub version. The GENERIC build's identity is UNCHANGED —
// weathernextpersonal namespace, appId wnext-ag-v41-weathernextpersonal, seed
// version personal-arch1, EMPTY seedLocs, no name seed, plain branding, the
// location-name-free AI prompt, gift-flow deep-link receiver, and swipe share +
// edit name/GPS are all preserved exactly. Only the broadcast text logic was
// swapped (verified the function body matched the pre-fix baseline with no
// build-specific drift before transplant; empty-locations case still degrades
// gracefully to "没有可用的地点 / No locations available", not a crash). Fixes:
//   • Fog tag gated to the broadcast window (no warning about an already-past dawn)
//   • Fog rendered in the location's language + Malay, never the greeting choice
//   • Fog tag placed BEFORE the afternoon storm clause (dawn→afternoon order)
//   • Favourites day-1 capped at 23:00 (no double-listing tomorrow's small hours)
//   • Afternoon midnight-crossover note ("12am 之后为明天预报")
//   • 🌫️ and 🕛 emoji removed (blank-box on older device OSes); 📍 kept
//   • Single-language Malay hourly labels now render in Malay
//   • Thin-rain reconciliation ("可能有丝丝细雨 / Possible drizzle / Mungkin hujan
//     merintik-rintik") instead of a contradictory "no rain"
//   • Confidence marker states WHAT models agree on ("模型一致：很可能有雨 / 大致无雨")
//   • Contradiction sweep: past-storm suppression, probability floored to the
//     measurable-hour signal, trace tag suppressed when a real rain hour exists
// bump CACHE_VERSION on each release
// ============================================================
// ------------------------------------------------------------
// FOG FIXES (ported from Cameron v1.0.310/311, 2026-06-06): (1) broadcast
// fog tag now derives its band from the WORST in-window VISIBILITY
// (computeFog thresholds <=200m dense, <=1000m fog) instead of bandKey, so
// it matches the detail screen's fog index. (2) Dropped the misleading
// 'overnight/夜间/malam' wording — now day-agnostic morning wording (清晨有浓雾
// / Dense fog in the morning / Kabus tebal waktu pagi). Generic identity
// (empty seedLocs, no name seed, location-name-free AI prompt, gift-flow) unchanged.

const CACHE_VERSION = 'wnext-weathernextpersonal-202606082000';
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
  // External CDN assets — cache so app loads fully offline after first visit.
  // (Tailwind is no longer here — it's now pre-built and inlined in index.html.)
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
        // Cross-origin CDN assets (cdnjs) often lack CORS headers for fetch()
        // pre-caching. Use 'no-cors' mode for them — produces an opaque response
        // which is cacheable but not introspectable (fine for static assets).
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

  // 1. Firebase, Gemini, Google APIs — do NOT intercept at all.
  //
  // This rule used to do event.respondWith(fetch(request).catch(... JSON 503 ...)).
  // That was a bug: it also caught the Firebase SDK JavaScript module requests
  // (gstatic.com/firebasejs/...). When such a request failed, the SW handed the
  // browser a JSON body; the browser then tried to execute JSON as an ES module,
  // which throws and kills the entire type="module" script — a fully blank page,
  // repeated on every load because the installed SW kept doing it.
  //
  // Fix: don't substitute anything for these requests. Returning here (with no
  // event.respondWith) lets the browser fetch them natively. A real network
  // failure becomes a normal rejected fetch, which the app already handles —
  // never a poisoned JSON module.
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebase') ||
    (url.hostname.includes('gstatic.com') && url.pathname.includes('firebasejs'))
  ) {
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

  // 4. CDN scripts (html2canvas) — cache-first (rarely changes).
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
