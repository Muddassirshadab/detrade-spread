/**
 * DeTrade Trading Bot - Background Service Worker
 * Handles WebSocket connection and message routing
 */

// ============ STATE ============
let wsConnection = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// ============ WEBSOCKET MANAGEMENT ============
async function connectWebSocket() {
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        console.log('[BG] WebSocket already connected');
        return;
    }

    try {
        console.log('[BG] Attempting WebSocket connection...');

        // Try to get auth token from DeTrade page
        const token = await getAuthToken();

        if (!token) {
            console.log('[BG] No auth token found, will use page scraping');
            broadcastMessage({ type: 'CONNECTION_STATUS', connected: false });
            return;
        }

        const wsUrl = `wss://websocket.detrade.com/ws?token=${token}`;
        wsConnection = new WebSocket(wsUrl);

        wsConnection.onopen = () => {
            console.log('[BG] WebSocket connected');
            isConnected = true;
            reconnectAttempts = 0;
            broadcastMessage({ type: 'CONNECTION_STATUS', connected: true });

            // Subscribe to market data
            wsConnection.send(JSON.stringify({
                type: 'subscribe',
                channel: 'market',
                symbol: 'STONKS'
            }));
        };

        wsConnection.onmessage = async (event) => {
            try {
                let data = event.data;

                // Handle binary data (compressed)
                if (data instanceof Blob) {
                    data = await decompressData(data);
                }

                const parsed = JSON.parse(data);
                handleMarketData(parsed);
            } catch (err) {
                console.error('[BG] Error parsing message:', err);
            }
        };

        wsConnection.onerror = (error) => {
            console.error('[BG] WebSocket error:', error);
            isConnected = false;
            broadcastMessage({ type: 'CONNECTION_STATUS', connected: false });
        };

        wsConnection.onclose = () => {
            console.log('[BG] WebSocket closed');
            isConnected = false;
            wsConnection = null;
            broadcastMessage({ type: 'CONNECTION_STATUS', connected: false });

            // Attempt reconnection
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                console.log(`[BG] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
                setTimeout(connectWebSocket, delay);
            }
        };

    } catch (error) {
        console.error('[BG] Failed to connect WebSocket:', error);
        broadcastMessage({ type: 'CONNECTION_STATUS', connected: false });
    }
}

async function getAuthToken() {
    try {
        const tabs = await chrome.tabs.query({ url: '*://detrade.com/*' });

        if (tabs.length === 0) {
            console.log('[BG] No DeTrade tab found');
            return null;
        }

        // Try to extract token from page
        const result = await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
                // Try localStorage
                const token = localStorage.getItem('auth_token') ||
                    localStorage.getItem('token') ||
                    sessionStorage.getItem('auth_token');
                return token;
            }
        });

        return result[0]?.result || null;
    } catch (error) {
        console.error('[BG] Error getting auth token:', error);
        return null;
    }
}

async function decompressData(blob) {
    try {
        const arrayBuffer = await blob.arrayBuffer();
        const compressed = new Uint8Array(arrayBuffer);

        // Use DecompressionStream API (available in service workers)
        const ds = new DecompressionStream('deflate');
        const writer = ds.writable.getWriter();
        writer.write(compressed);
        writer.close();

        const reader = ds.readable.getReader();
        const chunks = [];

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            chunks.push(value);
        }

        const decompressed = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
            decompressed.set(chunk, offset);
            offset += chunk.length;
        }

        return new TextDecoder().decode(decompressed);
    } catch (error) {
        console.error('[BG] Decompression failed:', error);
        // Return as-is if decompression fails
        return await blob.text();
    }
}

// ============ DATA HANDLING ============
function handleMarketData(data) {
    // Handle different message types from WebSocket
    if (data.type === 'ticker' || data.e === 'ticker') {
        const price = parseFloat(data.price || data.c || data.p);
        if (price) {
            broadcastMessage({
                type: 'PRICE_UPDATE',
                data: { price, timestamp: Date.now() }
            });
        }
    }

    if (data.type === 'kline' || data.e === 'kline') {
        const kline = data.k || data;
        broadcastMessage({
            type: 'CANDLE_UPDATE',
            data: {
                time: Math.floor((kline.t || kline.time) / 1000),
                open: parseFloat(kline.o || kline.open),
                high: parseFloat(kline.h || kline.high),
                low: parseFloat(kline.l || kline.low),
                close: parseFloat(kline.c || kline.close)
            }
        });
    }

    if (data.type === 'trade') {
        const price = parseFloat(data.price || data.p);
        if (price) {
            broadcastMessage({
                type: 'PRICE_UPDATE',
                data: { price, timestamp: Date.now() }
            });
        }
    }
}

// ============ MESSAGE BROADCASTING ============
async function broadcastMessage(message) {
    try {
        // Send to all extension pages (popup, sidepanel, etc.)
        chrome.runtime.sendMessage(message).catch(() => { });

        // Also try direct connection to sidepanel if available
    } catch (error) {
        // Ignore errors when no listeners
    }
}

// ============ MESSAGE LISTENER ============
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[BG] Received message:', message.type);

    switch (message.type) {
        case 'CONNECT_WEBSOCKET':
            connectWebSocket();
            sendResponse({ status: 'connecting' });
            break;

        case 'DISCONNECT_WEBSOCKET':
            if (wsConnection) {
                wsConnection.close();
                wsConnection = null;
            }
            isConnected = false;
            sendResponse({ status: 'disconnected' });
            break;

        case 'GET_CONNECTION_STATUS':
            sendResponse({ connected: isConnected });
            break;

        case 'SET_TIMEFRAME':
            // Re-subscribe with new timeframe if connected
            if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
                wsConnection.send(JSON.stringify({
                    type: 'subscribe',
                    channel: 'kline',
                    symbol: 'STONKS',
                    interval: message.timeframe
                }));
            }
            sendResponse({ status: 'ok' });
            break;

        default:
            sendResponse({ status: 'unknown_message' });
    }

    return true; // Keep channel open for async response
});

// ============ EXTENSION ACTION ============
chrome.action.onClicked.addListener((tab) => {
    // Open side panel when extension icon is clicked
    chrome.sidePanel.open({ tabId: tab.id });
});

// ============ SIDE PANEL BEHAVIOR ============
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ============ INSTALLATION ============
chrome.runtime.onInstalled.addListener(() => {
    console.log('[BG] DeTrade Trading Bot installed');
});

console.log('[BG] Background service worker started');
