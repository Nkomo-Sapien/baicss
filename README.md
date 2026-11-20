# Pathlight

Pathlight is a responsive web app prototype for navigation through wide open spaces. It pairs a Python route API with a Node.js web server, and includes OpenStreetMap tiles displayed with Leaflet, a therapist review screen, voice prompts and a tamper-evident local record chain.

## Run on your PC

1. Install Python 3 and Node.js if they are not already installed.
2. Open this folder in VS Code (`code .`).
3. Open the VS Code terminal with **Ctrl+`**, then run `./start.ps1`. It selects free ports and prints the PC and phone URLs. Keep the terminal running.

## Real map routes

The main map uses [Leaflet](https://leafletjs.com/) and public [OpenStreetMap](https://www.openstreetmap.org/copyright) map tiles. No Google Maps API key or billing account is needed. Address lookup uses the public Nominatim service; walking directions use the public Valhalla demo service. Enter a start address or use current location, enter a destination, and choose **Plan walking route**.

These shared public services have fair-use limits and no production service guarantee. Do not send frequent automated requests. Address queries and route coordinates are sent to those services. For a production app, host or contract for dedicated tile, geocoding and routing services. Keep visible OpenStreetMap attribution on the map.

## Android and iPhone

The interface adapts to phone screens. For local testing, connect the phone and PC to the same Wi-Fi and open the **Phone on the same Wi-Fi** URL printed by `start.ps1`. Keep the VS Code server running. Some Wi-Fi networks isolate devices; an HTTPS public deployment or secure tunnel can be used instead. HTTPS (or localhost) is required for phone location access. On iPhone, open the hosted HTTPS address in Safari and use **Share → Add to Home Screen**; on Android, open it in Chrome.

## Prototype scope and safety

- A* path planning on a small, fictional courtyard grid with simulated obstacle clearance.
- Public pedestrian directions on a real map, when place lookup and the routing service are available.
- A visual corridor overlay is an estimate only; the map does not verify path width, surface, curb ramps, temporary obstacles or accessibility.
- Simulated step-by-step movement, obstacle alerts and browser speech output.
- Therapist approval or change requests with written notes.
- SHA-256 chained route and review records in `data/ledger.json`. This is a local demonstration ledger, not a decentralized blockchain or production security guarantee.

Do not rely on this prototype as a safety system or as a substitute for a mobility aid and professional assessment.
