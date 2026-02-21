/**
 * Trade Executor - Background Service Worker
 * Connects to Trade Signal Server via SSE and forwards signals to content script
 */

// ============ STATE ============
let sseConnection = null;
let isConnected = false;
let isRunning = false;
let isReversed = false;
let serverUrl = 'http://localhost:3000';

// ============ SSE CONNECTION ============
let reconnectTimeout = null;

async function connectToServer() {
    if (!isRunning) return;

    if (sseConnection) {
        sseConnection.close();
        sseConnection = null;
    }

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    try {
        // Enforce exact URL even if cached was bad
        let safeUrl = serverUrl || 'http://localhost:3000';
        if (!safeUrl.endsWith('/events')) {
            safeUrl = safeUrl.replace(/\/$/, '') + '/events';
        }
        serverUrl = safeUrl;
        chrome.storage.local.set({ serverUrl });

        console.log('[BG] Connecting to formatted serverUrl:', serverUrl);

        const eventSource = new EventSource(serverUrl);

        eventSource.onopen = () => {
            console.log('[BG] SSE connected to server');
            isConnected = true;
            broadcastToExtension({ type: 'CONNECTION_STATUS', connected: true });
        };

        eventSource.onmessage = async (event) => {
            try {
                const data = JSON.parse(event.data);
                console.log('[BG] Received from server:', data);

                if (data.type === 'trade' && isRunning) {
                    let direction = data.direction; // "UP" or "DOWN"

                    // Apply reverse
                    if (isReversed) {
                        direction = direction === 'UP' ? 'DOWN' : 'UP';
                        console.log('[BG] Reverse ON — flipped to:', direction);
                    }

                    // Forward to content script
                    await executeOnAllDetradeTabs(direction);
                }
            } catch (err) {
                console.error('[BG] Error processing SSE message:', err);
            }
        };

        eventSource.onerror = (error) => {
            console.error('[BG] SSE error -> Disconnecting');
            isConnected = false;
            broadcastToExtension({ type: 'CONNECTION_STATUS', connected: false });
            eventSource.close();
            sseConnection = null;

            if (isRunning) {
                console.log('[BG] Scheduling reconnect in 3s...');
                reconnectTimeout = setTimeout(connectToServer, 3000);
            }
        };

        sseConnection = eventSource;

    } catch (error) {
        console.error('[BG] Failed to connect:', error);
        isConnected = false;
        broadcastToExtension({ type: 'CONNECTION_STATUS', connected: false });

        if (isRunning) {
            reconnectTimeout = setTimeout(connectToServer, 3000);
        }
    }
}

function disconnectFromServer() {
    if (sseConnection) {
        sseConnection.close();
        sseConnection = null;
    }
    isConnected = false;
    console.log('[BG] Disconnected from server');
    broadcastToExtension({ type: 'CONNECTION_STATUS', connected: false });
}

// ============ TRADE EXECUTION ============
async function executeOnAllDetradeTabs(direction) {
    try {
        const tabs = await chrome.tabs.query({
            url: ['https://detrade.com/*', 'https://*.detrade.com/*']
        });

        if (tabs.length === 0) {
            console.log('[BG] No DeTrade tabs found!');
            broadcastToExtension({
                type: 'TRADE_RESULT',
                success: false,
                error: 'No DeTrade tab open',
                direction,
                timestamp: Date.now()
            });
            return;
        }

        // Send only to the FIRST active/functional tab to prevent duplicate counting
        let executed = false;
        for (const tab of tabs) {
            try {
                const response = await chrome.tabs.sendMessage(tab.id, {
                    type: 'EXECUTE_TRADE',
                    direction: direction
                });

                if (response?.success) {
                    console.log(`[BG] Tab ${tab.id} Executed successfully.`);
                    broadcastToExtension({
                        type: 'TRADE_RESULT',
                        success: true,
                        direction: direction,
                        tabId: tab.id,
                        tabTitle: tab.title,
                        timestamp: Date.now()
                    });
                    executed = true;
                    break; // Stop after first success
                }
            } catch (err) {
                console.log(`[BG] Tab ${tab.id} not reachable, trying next...`);
            }
        }

        if (!executed) {
            broadcastToExtension({
                type: 'TRADE_RESULT',
                success: false,
                error: 'All tabs failed to respond',
                direction,
                timestamp: Date.now()
            });
        }

    } catch (error) {
        console.error('[BG] Error finding tabs:', error);
    }
}

// ============ MESSAGE BROADCASTING ============
function broadcastToExtension(message) {
    try {
        chrome.runtime.sendMessage(message).catch(() => { });
    } catch (error) { }
}

// ============ MESSAGE LISTENER ============
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[BG] Received:', message.type);

    switch (message.type) {
        case 'START':
            isRunning = true;
            let rawUrl = message.serverUrl || serverUrl || 'http://localhost:3000';
            // Auto append /events if the user just typed the root UI URL
            if (!rawUrl.endsWith('/events')) {
                rawUrl = rawUrl.replace(/\/$/, '') + '/events';
            }
            serverUrl = rawUrl;
            chrome.storage.local.set({ isRunning: true, serverUrl });
            connectToServer();
            sendResponse({ status: 'started' });
            break;

        case 'STOP':
            isRunning = false;
            chrome.storage.local.set({ isRunning: false });
            disconnectFromServer();
            sendResponse({ status: 'stopped' });
            break;

        case 'SET_REVERSE':
            isReversed = message.reversed;
            chrome.storage.local.set({ isReversed });
            console.log('[BG] Reverse set to:', isReversed);
            sendResponse({ reversed: isReversed });
            break;

        case 'GET_STATE':
            sendResponse({
                isRunning,
                isConnected,
                isReversed,
                serverUrl
            });
            break;

        case 'CONTENT_SCRIPT_READY':
            console.log('[BG] Content script ready on:', message.url);
            sendResponse({ status: 'acknowledged' });
            break;

        default:
            sendResponse({ status: 'unknown' });
    }

    return true;
});

// ============ EXTENSION ACTION ============
chrome.action.onClicked.addListener((tab) => {
    chrome.sidePanel.open({ tabId: tab.id });
});

// ============ SIDE PANEL BEHAVIOR ============
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// ============ RESTORE STATE ON STARTUP ============
chrome.storage.local.get(['isRunning', 'isReversed', 'serverUrl'], (result) => {
    if (result.serverUrl) serverUrl = result.serverUrl;
    if (result.isReversed) isReversed = result.isReversed;
    if (result.isRunning) {
        isRunning = true;
        connectToServer();
    }
});

// ============ INSTALLATION ============
chrome.runtime.onInstalled.addListener(() => {
    console.log('[BG] Trade Executor extension installed');
    chrome.storage.local.set({
        isRunning: false,
        isReversed: false,
        serverUrl: 'http://localhost:3000/events'
    });
});

// ============ KEEP ALIVE (PREVENT SW SLEEP) ============
chrome.alarms.create('keepAlive', { periodInMinutes: 0.25 }); // 15 seconds

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
        if (isRunning) {
            console.log('[BG] Keep-alive tick...');
            // If the connection randomly dropped without triggering onerror, reconnect
            if (!sseConnection || sseConnection.readyState === EventSource.CLOSED) {
                console.log('[BG] Connection found dead during keep-alive. Reconnecting...');
                connectToServer();
            }
        }
    }
});

console.log('[BG] Trade Executor background worker started');
