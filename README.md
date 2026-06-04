# 农友天气 · WeatherNext (Personal)

A single-file Progressive Web App (PWA) delivering hyperlocal weather forecasts,
with an optional AI farming briefing. **This is the generic, personalizable
build** — for friends who want hyperlocal weather but aren't in the WeatherNext
WhatsApp broadcast groups.

Bilingual (中文 / English). Part of the WeatherNext family — but unlike the
per-region builds, this one ships with **no preset farms and no region
identity**. Each person makes it their own.

---

## How it differs from the regional builds

- **No seeded farms.** The location list starts empty. The user adds their own
  places with the **+** button; each is auto-favourited.
- **No name baked in.** On first run there is no owner/region name. The user
  sets their own via **Edit Name** (optional).
- **No region.** Branding is just "农友天气 WeatherNext" — no town or state.
- **Location-agnostic AI.** The AI briefing reasons purely from each location's
  real coordinates and live weather, so it works anywhere in Malaysia (lowland
  or highland) without assuming a region.
- **Gift / share flow.** A friend can receive a shared location via a deep link
  and have it auto-added to their own list.

It still carries the **full microclimate engine** (disease-risk, fog, 29-crop
AI briefing, model-run freshness, broadcast tools). A grower friend who adds a
farm gets the full disease/fog advice; a casual friend who adds their home just
sees the forecast and a general briefing (no crop set = no crop advice).

---

## Live app

```
https://stanleywoosweeleong.github.io/weathernextpersonal/
```

Open on a phone and use **"Add to Home Screen"** to install. Works offline after
first visit (service-worker cached).

---

## API key — bring your own

AI features use Google's Gemini API; each user supplies their own free key
(stored only on-device, never committed). Get one at
https://aistudio.google.com/app/apikey and paste it into the in-app **API Key**
modal. The forecast works without a key — only the AI briefing needs one.

---

## Deploying

All files live in the repository root (relative `./` paths). Enable GitHub
Pages: **Settings → Pages → Source: Deploy from branch → `main` / `root`**.

```
index.html            — the app (single file)
manifest.json         — PWA metadata
sw.js                 — service worker (offline cache)
icon-512.png / icon-192.png / apple-touch-icon.png / favicon-32.png — icons
```

When pushing changes, bump `CACHE_VERSION` at the top of `sw.js`. Current value:

```
wnext-weathernextpersonal-202606042138
```

---

## Tech notes

- **Weather data:** Open-Meteo API (no key; network-first with cache fallback,
  rate-limit throttling + retry).
- **AI model:** `gemini-2.5-flash` via the Generative Language API.
- **Storage namespace:** `weathernextpersonal__*` in `localStorage`, isolated
  from every other WeatherNext build.
- **Cloud sync:** Firebase, `appId: wnext-ag-v41-weathernextpersonal`.
- **App icon:** sun over a green field; boot screen sky-blue `#84d2f8` to match.
