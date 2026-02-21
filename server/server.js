/**
 * Trade Signal Server 
 * Minimal 1:1 Server UI -> Executor Extension
 */

const http = require('http');
const url = require('url');

const PORT = 3000;

// Connected SSE clients
let clients = [];
let tradeHistory = [];

function sendSSE(data) {
    clients.forEach(client => {
        client.res.write(`data: ${JSON.stringify(data)}\n\n`);
    });
}

function handleCORS(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// -----------------------------------------------------
// --- HTML FRONTEND FOR SERVER UI ---
// -----------------------------------------------------
const HTML_CONTENT = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DeTrade Server Controller</title>
    <style>
        * { box-sizing: border-box; font-family: 'Segoe UI', sans-serif; }
        body { background: #0a0e17; color: #fff; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
        .container { background: #13132b; padding: 30px; border-radius: 12px; width: 350px; border: 1px solid #2a2a5a; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        h2 { margin-top: 0; text-align: center; font-size: 20px; color: #e0e6ed; }
        .status { text-align: center; margin-bottom: 20px; font-size: 14px; padding: 10px; border-radius: 8px; font-weight: bold; }
        .status.connected { background: rgba(0, 230, 118, 0.1); color: #00e676; border: 1px solid rgba(0, 230, 118, 0.3); }
        .status.disconnected { background: rgba(255, 82, 82, 0.1); color: #ff5252; border: 1px solid rgba(255, 82, 82, 0.3); }
        .btn-row { display: flex; gap: 10px; margin-bottom: 20px; }
        .btn { flex: 1; padding: 15px; border: none; border-radius: 8px; font-size: 16px; font-weight: bold; color: white; cursor: pointer; transition: 0.2s; }
        .btn-up { background: #26a69a; } .btn-up:hover { background: #2bbbad; }
        .btn-down { background: #ef5350; } .btn-down:hover { background: #f44336; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .auto-box { background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; }
        .auto-box h3 { margin: 0 0 10px 0; font-size: 14px; border-bottom: 1px solid #2a2a5a; padding-bottom: 5px; }
        .input-group { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
        input[type="number"] { width: 70px; padding: 5px; border-radius: 4px; border: 1px solid #2a2a5a; background: #0a0e17; color: white; text-align: center; font-size: 16px; }
        select { padding: 5px; border-radius: 4px; border: 1px solid #2a2a5a; background: #0a0e17; color: white; font-size: 14px; }
        .toggle-btn { width: 100%; padding: 10px; border: none; border-radius: 6px; font-weight: bold; cursor: pointer; background: #2962ff; color: white; }
        .toggle-btn.active { background: #ef5350; }
        .log { margin-top: 15px; font-size: 12px; color: #8892a4; text-align: center; min-height: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h2>DeTrade Server</h2>
        <div id="connStatus" class="status disconnected">Waiting for extensions...</div>
        
        <div class="btn-row">
            <button class="btn btn-up" id="btnUp" onclick="sendTrade('UP')" disabled>UP</button>
            <button class="btn btn-down" id="btnDown" onclick="sendTrade('DOWN')" disabled>DOWN</button>
        </div>

        <div class="auto-box">
            <h3>Auto Sender</h3>
            <div class="input-group">
                <label>Interval (s)</label>
                <input type="number" id="interval" value="5" min="1">
            </div>
            <div class="input-group">
                <label>Signal</label>
                <select id="signalType">
                    <option value="UP">UP</option>
                    <option value="DOWN">DOWN</option>
                    <option value="RANDOM">RANDOM</option>
                </select>
            </div>
            <button id="toggleAuto" class="toggle-btn" onclick="toggleAuto()">Start Auto</button>
            <div id="countdown" style="text-align: center; margin-top: 10px; font-family: monospace; color: #2962ff; font-weight: bold;"></div>
        </div>

        <div id="log" class="log">Server started. Send an event or wait.</div>
    </div>

    <script>
        let botCount = 0;
        let isAuto = false;
        let autoTimer = null;
        let countTimer = null;
        let nextTradeMs = 0;

        // Poll status to see if extensions connected
        setInterval(async () => {
            try {
                const res = await fetch('/status');
                const data = await res.json();
                
                const connectedNow = data.connectedClients;
                
                if (connectedNow !== botCount) {
                    botCount = connectedNow;
                    const st = document.getElementById('connStatus');
                    const btnU = document.getElementById('btnUp');
                    const btnD = document.getElementById('btnDown');
                    
                    if (botCount > 0) {
                        st.textContent = "🟢 " + botCount + " Bots Connected";
                        st.className = "status connected";
                        btnU.disabled = false;
                        btnD.disabled = false;
                        if(botCount > 1) logMsg(botCount + " bots ready to trade!");
                        else logMsg("1 bot ready to trade!");
                    } else {
                        st.textContent = "🔴 Waiting for extensions...";
                        st.className = "status disconnected";
                        btnU.disabled = true;
                        btnD.disabled = true;
                        if(isAuto) toggleAuto(); // force stop if disconnected
                        logMsg("No bots connected.");
                    }
                }
            } catch (e) {
                console.error("Status poll failed", e);
            }
        }, 1000);

        async function sendTrade(overrideType = null) {
            if (botCount === 0) return;
            
            let dir = overrideType;
            if (!dir) {
                dir = document.getElementById('signalType').value;
                if (dir === 'RANDOM') dir = Math.random() > 0.5 ? 'UP' : 'DOWN';
            }

            try {
                const res = await fetch('/trade', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({direction: dir})
                });
                if(res.ok) {
                    logMsg(\`✅ Sent \${dir} to \${botCount} bots\`);
                } else {
                    logMsg(\`❌ Failed to send \${dir}\`);
                }
            } catch (e) {
                logMsg(\`❌ Error sending trade\`);
            }
        }

        function toggleAuto() {
            isAuto = !isAuto;
            const btn = document.getElementById('toggleAuto');
            
            if (isAuto) {
                if(botCount === 0) {
                    alert("Cannot start Auto: No bots connected.");
                    isAuto = false;
                    return;
                }
                
                let sec = parseFloat(document.getElementById('interval').value);
                if(isNaN(sec) || sec < 1) sec = 1;
                
                btn.textContent = "Stop Auto";
                btn.className = "toggle-btn active";
                logMsg(\`Auto started every \${sec}s\`);
                
                sendTrade(); // immediate
                nextTradeMs = Date.now() + (sec * 1000);
                
                autoTimer = setInterval(() => {
                    sendTrade();
                    nextTradeMs = Date.now() + (sec * 1000);
                }, sec * 1000);
                
                countTimer = setInterval(() => {
                    let r = Math.max(0, (nextTradeMs - Date.now())/1000).toFixed(1);
                    document.getElementById('countdown').textContent = \`Next in: \${r}s\`;
                }, 100);
                
            } else {
                btn.textContent = "Start Auto";
                btn.className = "toggle-btn";
                clearInterval(autoTimer);
                clearInterval(countTimer);
                document.getElementById('countdown').textContent = "";
                logMsg("Auto stopped.");
            }
        }

        function logMsg(txt) {
            const d = new Date().toLocaleTimeString('en-US',{hour12:false});
            document.getElementById('log').textContent = \`[\${d}] \${txt}\`;
        }
    </script>
</body>
</html>
`;

// -----------------------------------------------------
// --- HTTP SERVER LOGIC ---
// -----------------------------------------------------

const server = http.createServer((req, res) => {
    handleCORS(res);

    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    // Serve HTML Web UI
    if (path === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(HTML_CONTENT);
        return;
    }

    // SSE endpoint — MULTI-CLIENT BROADCAST
    if (path === '/events' && req.method === 'GET') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        const clientId = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const client = { id: clientId, res };
        clients.push(client);

        console.log(`[Server] Extension CONNECTED: ${clientId}. Total active: ${clients.length}`);

        // Send welcome
        sendSSE({ type: 'connected', clientId, totalClients: clients.length });

        // Remove on disconnect
        req.on('close', () => {
            clients = clients.filter(c => c.id !== clientId);
            console.log(`[Server] Extension DISCONNECTED: ${clientId}. Total active: ${clients.length}`);
        });

        return;
    }

    // Trade endpoint — send trade signals
    if (path === '/trade' && req.method === 'POST') {
        if (clients.length === 0) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Cannot send trade. No extensions connected.' }));
            return;
        }

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                const data = JSON.parse(body);
                const direction = (data.direction || '').toUpperCase();

                if (direction !== 'UP' && direction !== 'DOWN') {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'direction must be "UP" or "DOWN"' }));
                    return;
                }

                const trade = {
                    type: 'trade',
                    direction: direction,
                    timestamp: Date.now()
                };

                tradeHistory.push(trade);
                if (tradeHistory.length > 100) tradeHistory.shift();

                sendSSE(trade);

                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    success: true,
                    direction: direction,
                    bots: clients.length,
                    timestamp: trade.timestamp
                }));

                console.log(`[Server] Signal: ${direction} → EXECUTED across ${clients.length} bots instantly.`);

            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON body' }));
            }
        });
        return;
    }

    // Status endpoint (For polling)
    if (path === '/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'running',
            connectedClients: clients.length,
            totalTradesProcessed: tradeHistory.length,
            lastTrade: tradeHistory.length > 0 ? tradeHistory[tradeHistory.length - 1] : null
        }));
        return;
    }

    // 404
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 Trade SIGNAL MULTI-SERVER running on :${PORT}`);
    console.log(`========================================`);
    console.log(`  UI Controller : http://localhost:${PORT}`);
    console.log(`  Extension URL : http://localhost:${PORT}/events`);
    console.log(`========================================`);
    console.log(`  SYNCHRONIZED BROADCAST ENABLED`);
    console.log(`  Unlimited Chrome profiles can connect.`);
    console.log(`  All will receive the trade instantly.`);
    console.log(`========================================\n`);
});
