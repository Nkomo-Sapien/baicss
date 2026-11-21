# Navora

Navora is a responsive web app prototype for navigation through wide open spaces. It pairs a Python route API with a Node.js web server, OpenStreetMap tiles displayed with Leaflet, therapist review, voice prompts, a local tamper-evident ledger and optional on-chain commitment anchoring.

## Run on your PC

1. Install Python 3 and Node.js if they are not already installed.
2. Open this folder in VS Code (`code .`).
3. Open the VS Code terminal with **Ctrl+`**, then run `./start.ps1`. It selects free ports and prints the PC and phone URLs. Keep the terminal running.

## Real map routes

The main map uses [Leaflet](https://leafletjs.com/) and public [OpenStreetMap](https://www.openstreetmap.org/copyright) map tiles. No Google Maps API key or billing account is needed. Address lookup uses the public Nominatim service; walking directions use the public Valhalla demo service. Enter a start address or use current location, enter a destination, and choose **Plan walking route**.

These shared public services have fair-use limits and no production service guarantee. Do not send frequent automated requests. Address queries and route coordinates are sent to those services. For a production app, host or contract for dedicated tile, geocoding and routing services. Keep visible OpenStreetMap attribution on the map.

## Android and iPhone

The interface adapts to phone screens. For local testing, connect the phone and PC to the same Wi-Fi and open the **Phone on the same Wi-Fi** URL printed by `start.ps1`. Keep the VS Code server running. Some Wi-Fi networks isolate devices; an HTTPS public deployment or secure tunnel can be used instead. HTTPS (or localhost) is required for phone location access. On iPhone, open the hosted HTTPS address in Safari and use **Share → Add to Home Screen**; on Android, open it in Chrome.

## Avalanche Fuji and BNB Chain anchoring

Pathlight includes the Solidity contract at `contracts/PathlightLedger.sol` and browser support for two EVM-compatible test networks: Avalanche Fuji C-Chain (chain ID `43113`) and BNB Smart Chain Testnet (`97`). Both use test tokens, not mainnet funds. The app only submits salted commitments to the contract. Locations, full route data and clinical notes remain in the local Python ledger. The wallet address, event category, timestamp and transaction are public. A privacy proof salt is kept in this browser's local storage; keep a backup if you need to verify records after clearing browser data.

1. Deploy the same Solidity file once on each test network you want to use. Open it in the Solidity tooling you installed, or open [Remix](https://remix.ethereum.org/) and paste its contents into a new Solidity file.
2. Compile with Solidity `0.8.28` or another compatible `0.8.x` compiler. For Avalanche Fuji, set the compiler EVM target to **Cancun**.
3. Select an injected wallet and the target test network, deploy `PathlightLedger`, and approve the deployment in your wallet. Test tokens are needed to pay testnet fees.
4. In Pathlight, open **Trust ledger**, choose **Avalanche Fuji C-Chain** or **BNB Smart Chain Testnet**, connect your wallet, then paste that network's deployed contract address and choose **Connect contract**.
5. Generate local records by planning a demo route or adding a therapist review. Then choose **Anchor unanchored record hashes** and approve the transaction in your wallet.

Avalanche Fuji uses RPC `https://api.avax-test.network/ext/bc/C/rpc` and chain ID `43113`, per [Avalanche's network reference](https://build.avax.network/docs/primary-network). BNB Smart Chain Testnet uses RPC `https://data-seed-prebsc-1-s1.bnbchain.org:8545` and chain ID `97`, per [BNB Chain's wallet configuration](https://docs.bnbchain.org/bnb-smart-chain/developers/wallet-configuration/). The [Avalanche faucet](https://build.avax.network/console) provides test AVAX; BNB Chain documents its [test tBNB faucet](https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/). You may need to open Pathlight inside a compatible wallet browser or a desktop browser with a wallet extension enabled; a VS Code Solidity extension by itself does not inject a wallet into the app. Do not use mainnet or real funds for this prototype.

For the privacy commitment, Pathlight combines each local ledger hash with a random 32-byte salt before submitting it. The contract cannot recover the route or review text from that commitment. This demonstrates tamper-evident anchoring; it does not prove a route is safe or that a reviewer is clinically qualified.

## Prototype scope and safety

- A* path planning on a small, fictional courtyard grid with simulated obstacle clearance.
- Public pedestrian directions on a real map, when place lookup and the routing service are available.
- A visual corridor overlay is an estimate only; the map does not verify path width, surface, curb ramps, temporary obstacles or accessibility.
- Simulated step-by-step movement, obstacle alerts and browser speech output.
- Therapist approval or change requests with written notes.
- SHA-256 chained route and review records in `data/ledger.json`, with optional salted commitments anchored to Avalanche Fuji or BNB Smart Chain Testnet.

Do not rely on this prototype as a safety system or as a substitute for a mobility aid and professional assessment. Fuji is a public test network; for production, use a reviewed contract, a managed RPC, appropriate reviewer access controls and a privacy/legal review before choosing what to anchor.
