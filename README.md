�

____  _____  _____  ____    __    ____  ____ 
(  _ \( ___ )(_   _)(  _ \  /__\  (  _ \( ___)
 )(_) ))__)   _)(_   )   / /(__)\  )(_) ))__) 
(____/(____)  (____)(_)\_)(__)(__)(_____/(____)
�
detrade-spread


�
Trade Signal Server + Chrome Extension — Built for DeTrade


�
Send a signal once from your server. Every connected browser executes the trade — automatically.


�
�
�
�
Load image
Load image
Load image
Load image
�

📖 Overview
detrade-spread is a two-part automation system for executing trades on DeTrade:
┌─────────────────────┐         WebSocket          ┌──────────────────────────┐
│   Signal Server     │ ─────── trade signal ──────▶│  Chrome Extension        │
│   (Node.js + UI)    │                             │  (Trade Executor v2.0)   │
│                     │◀────── status / ACK ────────│                          │
└─────────────────────┘                             └──────────────────────────┘
                                                              │
                                                              ▼
                                                     detrade.com (auto-executes)
Part
Description
🖥️ Signal Server
Node.js server with a Web UI — compose and broadcast trade signals to all connected clients at once
🔌 Trade Executor
Chrome Extension (MV3) with a Side Panel UI — connects to the server via WebSocket and auto-executes incoming signals on detrade.com
📁 Project Structure
detrade-spread/
│
├── 📂 server/              # Node.js Signal Server
│   └── ...                 # Express server + Web UI
│
├── 📂 sidepanel/           # Extension Side Panel
│   └── sidepanel.html      # Main panel UI (opens in Chrome side panel)
│
├── 📂 lib/                 # Shared utilities / helpers
│
├── 📂 icons/               # Extension icons (16px, 48px, 128px)
│
├── background.js           # Service Worker (MV3) — manages WebSocket connection
├── content.js              # Content Script — injected into detrade.com pages
├── keep_alive.js           # Keeps the service worker alive
├── manifest.json           # Chrome Extension manifest (v3)
└── README.md
🚀 Getting Started
Prerequisites
Node.js v18+
Google Chrome browser
1. Clone the Repository
git clone https://github.com/Muddassirshadab/detrade-spread.git
cd detrade-spread
2. Start the Signal Server
cd server
npm install
npm start
Web UI will be available at http://localhost:3000
3. Load the Chrome Extension
Open Chrome and go to chrome://extensions/
Toggle on Developer Mode (top right corner)
Click "Load unpacked"
Select the root folder of this project (where manifest.json lives)
4. Open the Side Panel & Connect
Click the Trade Executor icon in your Chrome toolbar
The Side Panel will open on the right side of the browser
Enter your Signal Server URL and connect
Navigate to detrade.com — the extension is now active ✅
🖥️ Signal Server
The Node.js server provides a Web UI to:
📝 Compose trade signals (asset, direction, quantity, etc.)
📡 Broadcast to all connected Extension clients simultaneously
👥 View live connected clients
📜 Monitor signal history and execution logs
🔌 Chrome Extension (v2.0.0)
Built on Manifest V3 with the following Chrome permissions:
Permission
Purpose
activeTab
Interact with the current active tab
tabs
Manage and query browser tabs
storage
Persist server URL and extension settings
sidePanel
Render the Side Panel UI
alarms
Periodic tasks & keep-alive scheduling
Host Permissions:
https://detrade.com/*
https://*.detrade.com/*
http://localhost/* (for local Signal Server)
Extension Files
File
Role
background.js
Service Worker — WebSocket client, signal listener
content.js
Injected into detrade.com — executes trades on the page DOM
keep_alive.js
Prevents the MV3 service worker from going idle
sidepanel/sidepanel.html
Side Panel UI — connection status, logs, settings
⚙️ Configuration
The server URL is configurable directly from the Side Panel inside the extension.
For the Signal Server, create a .env inside server/ if needed:
PORT=3000
🛠️ Tech Stack
Signal Server
Node.js + Express
WebSocket (ws)
HTML / CSS / JS Web UI
Chrome Extension
Manifest V3
Service Worker (background.js)
Content Scripts (content.js)
Chrome Side Panel API
Chrome Alarms API (keep-alive mechanism)
⚠️ Disclaimer
This tool is for personal and educational use only.
Automated trading carries significant financial risk. Always comply with the Terms of Service of any platform you use. The authors are not responsible for any financial losses or account actions resulting from use of this tool.
🤝 Contributing
Fork the repo
Create your branch: git checkout -b feature/your-feature
Commit your changes: git commit -m 'Add your feature'
Push: git push origin feature/your-feature
Open a Pull Request
�

Built by Muddassirshadab
Found it useful? Drop a ⭐ on the repo!
�
