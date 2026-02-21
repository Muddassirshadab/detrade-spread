/**
 * Trade Executor - Side Panel JavaScript
 * Controls Start/Stop/Reverse and shows trade log
 */

// ============ STATE ============
let tradesExecuted = 0;

// ============ DOM ELEMENTS ============
const elements = {};

function initElements() {
    elements.startBtn = document.getElementById('startBtn');
    elements.stopBtn = document.getElementById('stopBtn');
    elements.reverseToggle = document.getElementById('reverseToggle');
    elements.serverUrl = document.getElementById('serverUrl');
    elements.connectionStatus = document.getElementById('connectionStatus');
    elements.connectedClients = document.getElementById('connectedClients');
    elements.tradesExecuted = document.getElementById('tradesExecuted');
    elements.lastDirection = document.getElementById('lastDirection');
    elements.logContainer = document.getElementById('logContainer');
    elements.clearLogBtn = document.getElementById('clearLogBtn');
}

// ============ UI UPDATES ============
function updateConnectionStatus(connected) {
    if (elements.connectionStatus) {
        const dot = elements.connectionStatus.querySelector('.status-dot');
        const text = elements.connectionStatus.querySelector('.status-text');
        if (dot && text) {
            dot.className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
            text.textContent = connected ? 'Connected' : 'Disconnected';
        }
    }
}

function updateButtons(isRunning) {
    elements.startBtn.disabled = isRunning;
    elements.stopBtn.disabled = !isRunning;
    elements.serverUrl.disabled = isRunning;

    if (isRunning) {
        elements.startBtn.classList.add('disabled');
        elements.stopBtn.classList.remove('disabled');
    } else {
        elements.startBtn.classList.remove('disabled');
        elements.stopBtn.classList.add('disabled');
    }
}

function addLog(message, type = 'info') {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    entry.innerHTML = `<span class="log-time">[${time}]</span> ${message}`;

    elements.logContainer.insertBefore(entry, elements.logContainer.firstChild);

    // Keep max 100 entries
    while (elements.logContainer.children.length > 100) {
        elements.logContainer.removeChild(elements.logContainer.lastChild);
    }
}

// ============ ACTIONS ============
function startExecutor() {
    const serverUrl = elements.serverUrl.value.trim();
    if (!serverUrl) {
        addLog('❌ Server URL is empty!', 'error');
        return;
    }

    addLog('🔌 Connecting to server...', 'info');

    chrome.runtime.sendMessage({
        type: 'START',
        serverUrl: serverUrl
    }, (response) => {
        if (response?.status === 'started') {
            updateButtons(true);
            addLog('✅ Executor started', 'success');
        }
    });
}

function stopExecutor() {
    chrome.runtime.sendMessage({ type: 'STOP' }, (response) => {
        if (response?.status === 'stopped') {
            updateButtons(false);
            updateConnectionStatus(false);
            addLog('⏹ Executor stopped', 'warn');
        }
    });
}

function toggleReverse(reversed) {
    chrome.runtime.sendMessage({
        type: 'SET_REVERSE',
        reversed: reversed
    }, (response) => {
        addLog(reversed ? '🔄 Reverse ON — trades will be flipped' : '➡️ Reverse OFF — normal mode', 'info');
    });
}

// ============ EVENT LISTENERS ============
function setupEventListeners() {
    elements.startBtn.addEventListener('click', startExecutor);
    elements.stopBtn.addEventListener('click', stopExecutor);

    elements.reverseToggle.addEventListener('change', (e) => {
        toggleReverse(e.target.checked);
    });

    elements.clearLogBtn.addEventListener('click', () => {
        elements.logContainer.innerHTML = '';
        addLog('🗑 Log cleared', 'info');
    });
}

// ============ MESSAGE LISTENER ============
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
        case 'CONNECTION_STATUS':
            updateConnectionStatus(message.connected);
            if (message.connected) {
                addLog('🟢 Connected to server', 'success');
            } else {
                addLog('🔴 Disconnected from server', 'error');
            }
            break;

        case 'TRADE_RESULT':
            tradesExecuted++;
            elements.tradesExecuted.textContent = tradesExecuted;

            const dirClass = message.direction === 'UP' ? 'up' : 'down';
            const dirEmoji = message.direction === 'UP' ? '🟢 ▲' : '🔴 ▼';
            elements.lastDirection.textContent = message.direction;
            elements.lastDirection.className = `stat-value ${dirClass}`;

            if (message.success) {
                addLog(`${dirEmoji} <strong>${message.direction}</strong> executed`, 'success');
            } else {
                addLog(`❌ ${message.direction} failed: ${message.error || 'unknown'}`, 'error');
            }
            break;
    }
});

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', () => {
    initElements();
    setupEventListeners();

    // Restore state from background
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
        if (state) {
            elements.serverUrl.value = state.serverUrl || 'http://localhost:3000';
            elements.reverseToggle.checked = state.isReversed || false;
            updateButtons(state.isRunning || false);
            updateConnectionStatus(state.isConnected || false);

            if (state.isRunning) {
                addLog('♻️ Restored — executor is running', 'info');
            }
        }
    });

    addLog('⚡ Trade Executor ready', 'success');
});
