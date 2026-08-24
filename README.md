# TRG WarnOverlay

A GitHub Pages-ready NWS severe weather alert overlay inspired by Warnverlay.

## Alerts included

Only these four NWS event types are displayed:

- Tornado Warning
- Severe Thunderstorm Warning
- Tornado Watch
- Severe Thunderstorm Watch

The NWS API identifies these as operational event codes including TOR, SVR, TOA, and SVA. The site filters directly by the event names returned by the active alerts API.

## Features

- Live NWS active alert feed
- 15-second background refresh
- Automatic alert sorting by priority
- New-alert popup
- Alert sound when a new alert is detected
- 5-minute NEW indicator
- Full-screen 1080p/OBS-friendly design
- No framework or build process required
- Works as a GitHub Pages static site

## GitHub Pages

1. Create a new public GitHub repository.
2. Upload `index.html`, `style.css`, `script.js`, and `README.md`.
3. Go to **Settings → Pages**.
4. Set deployment to **Deploy from a branch**.
5. Select `main` and `/ (root)`.
6. Save.

The site will be available at:

`https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`

## Important browser note

Browsers may restrict audio until the page has received user interaction. The alert popup will still work even if the browser blocks the sound.

## Data

Alert data comes from the National Weather Service API:
https://api.weather.gov/alerts/active
