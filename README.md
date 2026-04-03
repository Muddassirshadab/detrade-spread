detrade-spread
Trade Signal Server + Chrome Extension — Built for DeTrade
Send a signal once from your server. Every connected browser executes the trade — automatically.
What is this?
detrade-spread is a two-part trading automation system:
🖥️ Signal Server — A Node.js server with a Web UI. Compose and broadcast trade signals to all connected clients simultaneously.
🔌 Trade Executor — A Chrome Extension (MV3, v2.0.0) with a Side Panel UI. Connects to the Signal Server via WebSocket and auto-executes incoming signals on detrade.com.
How it works
Signal Server  ──── trade signal ────▶  Chrome Extension
(Node.js + UI) ◀─── status / ACK ────  (Trade Executor v2.0)
                                                 │
                                                 ▼
                                          detrade.com
                                        (auto-executes)
Project Structure
detrade-spread/
├── server/             Node.js Signal Server + Web UI
├── sidepanel/          Extension Side Panel UI
├── lib/                Shared utilities
├── icons/              Extension icons (16, 48, 128px)
├── background.js       Service Worker — WebSocket connection
├── content.js          Content Script — runs on detrade.com
├── keep_alive.js       Keeps the MV3 service worker alive
└── manifest.json       Chrome Extension manifest (v3)
Getting Started
Prerequisites
Node.js v18+
Google Chrome
1. Clone the repo
git clone https://github.com/Muddassirshadab/detrade-spread.git
cd detrade-spread
2. Start the Signal Server
cd server
npm install
npm start
Server runs at http://localhost:3000
3. Load the Chrome Extension
Open Chrome → chrome://extensions/
Enable Developer Mode (top right)
Click Load unpacked
Select the root folder of this project (where manifest.json is)
4. Connect & Trade
Click the Trade Executor icon in Chrome toolbar
The Side Panel opens on the right
Enter your server URL and connect
Open detrade.com — you're live ✅
Signal Server Features
Compose trade signals (asset, direction, quantity)
Broadcast to all connected Extension clients at once
View live connected clients
Monitor signal history and execution logs
Chrome Extension (v2.0.0)
Built on Manifest V3.
Permissions used:
Permission
Why
activeTab
Interact with the current tab
tabs
Manage browser tabs
storage
Save server URL and settings
sidePanel
Render the Side Panel UI
alarms
Keep-alive scheduling
Runs on:
https://detrade.com/*
https://*.detrade.com/*
http://localhost/*
Tech Stack
Server: Node.js, Express, WebSocket (ws), HTML/CSS/JS
Extension: Manifest V3, Service Worker, Content Scripts, Chrome Side Panel API, Chrome Alarms API
⚠️ Disclaimer
This tool is for personal and educational use only. Automated trading carries significant financial risk. The authors are not responsible for any financial losses or account actions. Always comply with the Terms of Service of any platform you use.
Contributing
Fork the repo
Create a branch: git checkout -b feature/your-feature
Commit: git commit -m 'Add your feature'
Push: git push origin feature/your-feature
Open a Pull Request
Built by Muddassirshadab — if this helped, leave a ⭐
