<h1>detrade-spread</h1>

<p><strong>Trade Signal Server + Chrome Extension — Built for DeTrade</strong></p>

<p>Send a signal once from your server. Every connected browser executes the trade — automatically.</p>

<hr>

<h2>What is this?</h2>

<p>detrade-spread is a two-part trading automation system:</p>

<p>🖥️ <strong>Signal Server</strong> — A Node.js server with a Web UI. Compose and broadcast trade signals to all connected clients simultaneously.</p>

<p>🔌 <strong>Trade Executor</strong> — A Chrome Extension (MV3, v2.0.0) with a Side Panel UI. Connects to the Signal Server via WebSocket and auto-executes incoming signals on detrade.com.</p>

<hr>

<h2>Project Structure</h2>

<pre>
detrade-spread/
├── server/          Node.js Signal Server + Web UI
├── sidepanel/       Extension Side Panel UI
├── lib/             Shared utilities
├── icons/           Extension icons (16, 48, 128px)
├── background.js    Service Worker — WebSocket connection
├── content.js       Content Script — runs on detrade.com
├── keep_alive.js    Keeps the MV3 service worker alive
└── manifest.json    Chrome Extension manifest (v3)
</pre>

<hr>

<h2>Getting Started</h2>

<h3>Prerequisites</h3>
<ul>
  <li>Node.js v18+</li>
  <li>Google Chrome</li>
</ul>

<h3>1. Clone the repo</h3>

<pre>
git clone https://github.com/Muddassirshadab/detrade-spread.git
cd detrade-spread
</pre>

<h3>2. Start the Signal Server</h3>

<pre>
cd server
npm install
npm start
</pre>

<p>Server runs at <code>http://localhost:3000</code></p>

<h3>3. Load the Chrome Extension</h3>
<ol>
  <li>Open Chrome → <code>chrome://extensions/</code></li>
  <li>Enable <strong>Developer Mode</strong> (top right)</li>
  <li>Click <strong>Load unpacked</strong></li>
  <li>Select the root folder of this project (where <code>manifest.json</code> is)</li>
</ol>

<h3>4. Connect & Trade</h3>
<ol>
  <li>Click the <strong>Trade Executor</strong> icon in Chrome toolbar</li>
  <li>The <strong>Side Panel</strong> opens on the right</li>
  <li>Enter your server URL and connect</li>
  <li>Open detrade.com — you're live ✅</li>
</ol>

<hr>

<h2>Chrome Extension (v2.0.0)</h2>

<p>Built on <strong>Manifest V3</strong>.</p>

<table>
  <tr><th>Permission</th><th>Why</th></tr>
  <tr><td><code>activeTab</code></td><td>Interact with the current tab</td></tr>
  <tr><td><code>tabs</code></td><td>Manage browser tabs</td></tr>
  <tr><td><code>storage</code></td><td>Save server URL and settings</td></tr>
  <tr><td><code>sidePanel</code></td><td>Render the Side Panel UI</td></tr>
  <tr><td><code>alarms</code></td><td>Keep-alive scheduling</td></tr>
</table>

<hr>

<h2>Tech Stack</h2>

<p><strong>Server:</strong> Node.js, Express, WebSocket (ws), HTML/CSS/JS</p>
<p><strong>Extension:</strong> Manifest V3, Service Worker, Content Scripts, Chrome Side Panel API, Chrome Alarms API</p>

<hr>

<h2>⚠️ Disclaimer</h2>

<p>This tool is for personal and educational use only. Automated trading carries significant financial risk. The authors are not responsible for any financial losses or account actions. Always comply with the Terms of Service of any platform you use.</p>

<hr>

<h2>Contributing</h2>
<ol>
  <li>Fork the repo</li>
  <li>Create a branch: <code>git checkout -b feature/your-feature</code></li>
  <li>Commit: <code>git commit -m 'Add your feature'</code></li>
  <li>Push: <code>git push origin feature/your-feature</code></li>
  <li>Open a Pull Request</li>
</ol>

<hr>

<p>Built by <a href="https://github.com/Muddassirshadab">Muddassirshadab</a> — if this helped, leave a ⭐</p>
