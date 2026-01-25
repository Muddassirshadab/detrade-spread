/**
 * DeTrade Trading Bot - Side Panel JavaScript
 * Handles chart, trading buttons, and bot agent logic
 * Now scrapes real data from DeTrade page
 */

// ============ STATE ============
const state = {
    isConnected: false,
    currentPrice: 0,
    previousPrice: 0,
    candles: [],
    ema: 0,
    emaHistory: [],
    position: {
        type: 'NONE', // 'LONG', 'SHORT', 'NONE'
        entryPrice: 0,
        pnl: 0,
        highestPnl: 0, // For trailing SL
        lowestPnl: 0   // For tracking
    },
    botEnabled: false,
    botStats: {
        trades: 0,
        wins: 0,
        totalPnl: 0
    },
    currentTimeframe: '15s',
    emaPeriod: 10, // Reduced from 50 for faster signals
    detradeTabId: null,
    priceHistory: [],
    // Trailing SL config
    trailingConfig: {
        trailAmount: 0.5, // Exit if price drops this much from peak
        minProfit: 0.3,   // Minimum profit before trailing kicks in
        maxLoss: 1.5      // Maximum allowed loss (hard SL)
    }
};

// ============ CHART SETUP ============
let chart = null;
let candleSeries = null;
let emaSeries = null;

function initChart() {
    const container = document.getElementById('chartContainer');

    chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 200,
        layout: {
            background: { type: 'solid', color: '#13132b' },
            textColor: '#a0a0c0'
        },
        grid: {
            vertLines: { color: '#2a2a5a' },
            horzLines: { color: '#2a2a5a' }
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal
        },
        rightPriceScale: {
            borderColor: '#2a2a5a'
        },
        timeScale: {
            borderColor: '#2a2a5a',
            timeVisible: true,
            secondsVisible: true
        }
    });

    candleSeries = chart.addCandlestickSeries({
        upColor: '#26a69a',
        downColor: '#ef5350',
        borderUpColor: '#26a69a',
        borderDownColor: '#ef5350',
        wickUpColor: '#26a69a',
        wickDownColor: '#ef5350'
    });

    emaSeries = chart.addLineSeries({
        color: '#ffca28',
        lineWidth: 2,
        title: 'EMA 50'
    });

    // Handle resize
    new ResizeObserver(() => {
        chart.applyOptions({ width: container.clientWidth });
    }).observe(container);
}

// ============ DETRADE TAB CONNECTION ============
async function findDetradeTab() {
    try {
        const tabs = await chrome.tabs.query({ url: '*://*.detrade.com/*' });

        if (tabs.length > 0) {
            state.detradeTabId = tabs[0].id;
            addLog(`✅ Found DeTrade tab (ID: ${tabs[0].id})`, 'success');

            // Inject content script if not already
            await injectContentScript(tabs[0].id);
            return true;
        } else {
            addLog('❌ DeTrade tab not found. Please open detrade.com', 'error');
            return false;
        }
    } catch (error) {
        addLog(`❌ Error finding tab: ${error.message}`, 'error');
        return false;
    }
}

async function injectContentScript(tabId) {
    try {
        // Check if content script is already running
        const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' }).catch(() => null);

        if (response && response.status === 'alive') {
            addLog('📌 Content script already active', 'info');
            return true;
        }

        // Inject the content script
        await chrome.scripting.executeScript({
            target: { tabId: tabId },
            files: ['content.js']
        });

        addLog('📌 Content script injected', 'success');
        return true;
    } catch (error) {
        addLog(`⚠️ Script injection: ${error.message}`, 'error');
        return false;
    }
}

// ============ PRICE SCRAPING ============
async function startPriceScraping() {
    if (!state.detradeTabId) {
        const found = await findDetradeTab();
        if (!found) return;
    }

    addLog('📊 Starting price scraping from DeTrade...', 'info');
    updateConnectionStatus(true);

    // Initial price fetch
    await fetchCurrentPrice();

    // Set up interval to fetch prices
    setInterval(async () => {
        await fetchCurrentPrice();
    }, 1000);
}

async function fetchCurrentPrice() {
    if (!state.detradeTabId) return;

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: state.detradeTabId },
            func: () => {
                // STRATEGY: Find the STONKS price displayed near the symbol name
                // Format on DeTrade: "STONKS ↓ 936.02 ▲ +7.84%"

                // Method 1: Find STONKS element and get the price next to it
                // Look for elements containing "STONKS" text
                const allElements = document.querySelectorAll('*');
                for (const el of allElements) {
                    const text = el.textContent?.trim();
                    // Match elements that have STONKS followed by price
                    // Pattern: STONKS [maybe ↓/↑] 936.02
                    if (text && text.includes('STONKS') && !text.includes('Demo account')) {
                        const match = text.match(/STONKS[^0-9]*(\d{3,4}\.\d{2})/);
                        if (match) {
                            const price = parseFloat(match[1]);
                            if (price > 0) {
                                return { price, source: 'stonks_element', debug: match[0] };
                            }
                        }
                    }
                }

                // Method 2: Look for the price in the header area (near Round ends)
                // The price format is like "936.02" with green/red coloring
                const headerArea = document.querySelector('[class*="header"], [class*="symbol"], [class*="pair"]');
                if (headerArea) {
                    const text = headerArea.innerText;
                    const match = text.match(/(\d{3,4}\.\d{2})/);
                    if (match) {
                        const price = parseFloat(match[1]);
                        // Exclude account balance (usually has comma like 1,146.787)
                        if (price > 0 && !match[0].includes(',')) {
                            return { price, source: 'header_area', debug: match[0] };
                        }
                    }
                }

                // Method 3: Find the first large price display
                // Look for standalone price elements (without comma = not account balance)
                const priceElements = [];
                document.querySelectorAll('span, div').forEach(el => {
                    const text = el.textContent?.trim();
                    // Match exactly a price like "936.02" without commas
                    if (text && /^\d{3,4}\.\d{2}$/.test(text)) {
                        const price = parseFloat(text);
                        priceElements.push({ el, price, text });
                    }
                });

                // Sort by price value (higher prices first, as STONKS price is usually prominent)
                priceElements.sort((a, b) => b.price - a.price);

                // Return the first price that's not on the chart axis (axis prices usually repeat)
                // Group by price and filter unique
                const uniquePrices = [...new Set(priceElements.map(p => p.price))];
                if (uniquePrices.length > 0) {
                    // The live price is usually shown once, chart axis shows multiples
                    for (const price of uniquePrices) {
                        const count = priceElements.filter(p => p.price === price).length;
                        if (count <= 2) { // Live price shows 1-2 times, axis shows more
                            return { price, source: 'unique_price', debug: `price=${price}, count=${count}` };
                        }
                    }
                    // Fallback to highest price
                    return { price: uniquePrices[0], source: 'highest_price', debug: uniquePrices[0] };
                }

                // Method 4: Parse from full page text, looking for STONKS price pattern
                const fullText = document.body.innerText;
                // Pattern: STONKS ↓ 936.02 or STONKS/USDT 936.02
                const fullMatch = fullText.match(/STONKS[\/\s↓↑▲▼]*(\d{3,4}\.\d{2})/i);
                if (fullMatch) {
                    return { price: parseFloat(fullMatch[1]), source: 'full_text', debug: fullMatch[0] };
                }

                // Method 5: Look for green/red colored price (live price indicator)
                const coloredEls = document.querySelectorAll('[style*="rgb(38, 166"], [style*="rgb(239, 83"], [class*="green"], [class*="red"]');
                for (const el of coloredEls) {
                    const text = el.textContent?.trim();
                    if (text && /^\d{3,4}\.\d{2}$/.test(text)) {
                        return { price: parseFloat(text), source: 'colored_element', debug: text };
                    }
                }

                return null;
            }
        });

        if (results && results[0] && results[0].result) {
            const { price, source, debug } = results[0].result;
            console.log(`[DeTrade Bot] Price: ${price} from ${source}`, debug);

            updatePrice(price);
            buildCandle(price);
            checkStrategy();
        }
    } catch (error) {
        console.error('Price fetch error:', error);
        if (error.message.includes('No tab with id') || error.message.includes('cannot be scripted')) {
            state.detradeTabId = null;
            updateConnectionStatus(false);
            addLog('⚠️ Connection lost, reconnecting...', 'error');
            await findDetradeTab();
        }
    }
}



// ============ CANDLE BUILDING ============
function buildCandle(price) {
    const now = Math.floor(Date.now() / 1000);
    const timeframeSec = getTimeframeSeconds(state.currentTimeframe);
    const candleTime = Math.floor(now / timeframeSec) * timeframeSec;

    const lastCandle = state.candles[state.candles.length - 1];

    if (lastCandle && lastCandle.time === candleTime) {
        // Update existing candle
        lastCandle.high = Math.max(lastCandle.high, price);
        lastCandle.low = Math.min(lastCandle.low, price);
        lastCandle.close = price;
    } else {
        // Create new candle
        const open = lastCandle ? lastCandle.close : price;
        state.candles.push({
            time: candleTime,
            open: open,
            high: Math.max(open, price),
            low: Math.min(open, price),
            close: price
        });

        // Keep only last 200 candles
        if (state.candles.length > 200) {
            state.candles = state.candles.slice(-200);
        }
    }

    // Update chart
    candleSeries.setData(state.candles);
    updateEMA();
}

function getTimeframeSeconds(tf) {
    const map = {
        '5s': 5,
        '15s': 15,
        '30s': 30,
        '1m': 60,
        '5m': 300
    };
    return map[tf] || 15;
}

// ============ EMA CALCULATION ============
function calculateEMA(prices, period) {
    if (prices.length < period) return null;

    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

    for (let i = period; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }

    return ema;
}

function updateEMA() {
    const closePrices = state.candles.map(c => c.close);
    const ema = calculateEMA(closePrices, state.emaPeriod);

    if (ema) {
        state.ema = ema;
        document.getElementById('emaValue').textContent = `EMA(${state.emaPeriod}): ${ema.toFixed(2)}`;

        // Update EMA line on chart - rebuild entire series
        state.emaHistory = [];
        const k = 2 / (state.emaPeriod + 1);
        let runningEma = null;

        for (let i = 0; i < state.candles.length; i++) {
            if (i < state.emaPeriod - 1) continue;

            if (runningEma === null) {
                runningEma = closePrices.slice(0, state.emaPeriod).reduce((a, b) => a + b, 0) / state.emaPeriod;
            } else {
                runningEma = closePrices[i] * k + runningEma * (1 - k);
            }

            state.emaHistory.push({
                time: state.candles[i].time,
                value: runningEma
            });
        }

        emaSeries.setData(state.emaHistory);
    }
}

// ============ STRATEGY LOGIC ============
function checkStrategy() {
    // Allow trading with fewer candles for faster start
    if (!state.botEnabled) return;
    if (state.candles.length < 3) {
        // Not enough data yet
        return;
    }

    const currentPrice = state.currentPrice;
    const lastCandle = state.candles[state.candles.length - 1];
    const previousCandle = state.candles[state.candles.length - 2];

    if (!previousCandle) return;

    // Simple momentum-based entry (works without EMA too)
    const priceDirection = lastCandle.close - previousCandle.close;
    const hasEma = state.ema && state.candles.length >= state.emaPeriod;

    // Entry Logic
    if (state.position.type === 'NONE') {
        if (hasEma) {
            // EMA crossover strategy
            const previousClose = previousCandle.close;

            // BUY Signal: Price crosses above EMA
            if (previousClose < state.ema && currentPrice > state.ema) {
                addLog('🔔 BUY SIGNAL: Price crossed above EMA', 'trade');
                updateSignal('BUY', 'buy');
                executeTrade('BUY');
                return;
            }

            // SELL Signal: Price crosses below EMA
            if (previousClose > state.ema && currentPrice < state.ema) {
                addLog('🔔 SELL SIGNAL: Price crossed below EMA', 'trade');
                updateSignal('SELL', 'sell');
                executeTrade('SELL');
                return;
            }
        } else {
            // Momentum-based entry when EMA not ready
            // Buy on strong upward momentum
            if (priceDirection > 0.5) {
                addLog('🔔 BUY SIGNAL: Strong upward momentum', 'trade');
                updateSignal('BUY', 'buy');
                executeTrade('BUY');
                return;
            }
            // Sell on strong downward momentum
            if (priceDirection < -0.5) {
                addLog('🔔 SELL SIGNAL: Strong downward momentum', 'trade');
                updateSignal('SELL', 'sell');
                executeTrade('SELL');
                return;
            }
        }
    }

    // Exit Logic: Trailing Stop Loss
    if (state.position.type !== 'NONE') {
        const pnl = state.position.type === 'LONG'
            ? currentPrice - state.position.entryPrice
            : state.position.entryPrice - currentPrice;

        state.position.pnl = pnl;

        // Update highest P&L for trailing
        if (pnl > state.position.highestPnl) {
            state.position.highestPnl = pnl;
        }

        updatePositionDisplay();

        const { trailAmount, minProfit, maxLoss } = state.trailingConfig;

        // Hard Stop Loss: Exit immediately if loss exceeds max
        if (pnl <= -maxLoss) {
            addLog(`❌ STOP LOSS HIT! P&L: ${pnl.toFixed(2)}`, 'error');
            executeTrade('CLOSE');
            recordTradeResult(pnl);
            return;
        }

        // Trailing Stop Loss: If we had profit and it dropped by trailAmount
        if (state.position.highestPnl >= minProfit) {
            const dropFromPeak = state.position.highestPnl - pnl;

            if (dropFromPeak >= trailAmount) {
                addLog(`📈 TRAILING SL! Peak: +${state.position.highestPnl.toFixed(2)}, Exit: +${pnl.toFixed(2)}`, 'success');
                executeTrade('CLOSE');
                recordTradeResult(pnl);
                return;
            }
        }

        // Quick profit book: If profit > 2 points and starts dropping
        if (pnl >= 2 && state.position.highestPnl - pnl >= 0.3) {
            addLog(`✅ QUICK PROFIT! P&L: +${pnl.toFixed(2)}`, 'success');
            executeTrade('CLOSE');
            recordTradeResult(pnl);
            return;
        }
    }
}

function recordTradeResult(pnl) {
    state.botStats.trades++;
    state.botStats.totalPnl += pnl;
    if (pnl > 0) state.botStats.wins++;

    updateBotStats();

    // Reset position with all fields
    state.position = { type: 'NONE', entryPrice: 0, pnl: 0, highestPnl: 0, lowestPnl: 0 };
    updatePositionDisplay();
    updateSignal('WAITING');
}

// ============ TRADE EXECUTION ============
async function executeTrade(action) {
    addLog(`📤 Sending ${action} signal to DeTrade...`, 'info');

    if (!state.detradeTabId) {
        const found = await findDetradeTab();
        if (!found) {
            addLog('❌ Cannot execute trade - DeTrade tab not found', 'error');
            return;
        }
    }

    try {
        // First ensure content script is injected
        await injectContentScript(state.detradeTabId);

        // Small delay to let content script initialize
        await new Promise(r => setTimeout(r, 100));

        // Send trade command
        const response = await chrome.tabs.sendMessage(state.detradeTabId, {
            type: 'EXECUTE_TRADE',
            action: action
        });

        if (response && response.success) {
            addLog(`✅ ${action} executed successfully!`, 'success');

            if (action === 'BUY') {
                state.position = { type: 'LONG', entryPrice: state.currentPrice, pnl: 0, highestPnl: 0, lowestPnl: 0 };
            } else if (action === 'SELL') {
                state.position = { type: 'SHORT', entryPrice: state.currentPrice, pnl: 0, highestPnl: 0, lowestPnl: 0 };
            } else if (action === 'CLOSE') {
                state.position = { type: 'NONE', entryPrice: 0, pnl: 0, highestPnl: 0, lowestPnl: 0 };
            }

            updatePositionDisplay();
        } else {
            addLog(`❌ Trade failed: ${response?.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        addLog(`❌ Error: ${error.message}`, 'error');

        // Try to re-find the tab
        state.detradeTabId = null;
        await findDetradeTab();
    }
}

// ============ UI UPDATES ============
function updatePrice(price) {
    state.previousPrice = state.currentPrice;
    state.currentPrice = price;

    const priceEl = document.getElementById('currentPrice');
    const changeEl = document.getElementById('priceChange');

    priceEl.textContent = price.toFixed(2);

    if (state.previousPrice !== 0) {
        const change = ((price - state.previousPrice) / state.previousPrice) * 100;
        const changeText = change >= 0 ? `+${change.toFixed(2)}%` : `${change.toFixed(2)}%`;
        changeEl.textContent = changeText;
        changeEl.className = `price-change ${change >= 0 ? 'positive' : 'negative'}`;
    }
}

function updateSignal(signal, className = '') {
    const signalEl = document.getElementById('currentSignal');
    signalEl.textContent = signal;
    signalEl.className = `signal-value ${className}`;
}

function updatePositionDisplay() {
    const typeEl = document.getElementById('positionType');
    const entryEl = document.getElementById('entryPrice');
    const pnlEl = document.getElementById('currentPnl');

    typeEl.textContent = state.position.type;
    typeEl.style.color = state.position.type === 'LONG' ? '#26a69a' :
        state.position.type === 'SHORT' ? '#ef5350' : '#a0a0c0';

    entryEl.textContent = state.position.entryPrice > 0 ?
        state.position.entryPrice.toFixed(2) : '---.--';

    const pnl = state.position.pnl;
    pnlEl.textContent = `$${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`;
    pnlEl.className = `pos-value pnl ${pnl >= 0 ? 'positive' : 'negative'}`;
}

function updateBotStats() {
    document.getElementById('totalTrades').textContent = state.botStats.trades;
    document.getElementById('winRate').textContent = state.botStats.trades > 0
        ? `${((state.botStats.wins / state.botStats.trades) * 100).toFixed(0)}%`
        : '0%';

    const totalPnl = state.botStats.totalPnl;
    const pnlEl = document.getElementById('totalPnl');
    pnlEl.textContent = `$${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}`;
    pnlEl.style.color = totalPnl >= 0 ? '#26a69a' : '#ef5350';
}

function updateConnectionStatus(connected) {
    state.isConnected = connected;
    const statusEl = document.getElementById('connectionStatus');
    const dotEl = statusEl.querySelector('.status-dot');
    const textEl = statusEl.querySelector('.status-text');

    dotEl.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
    textEl.textContent = connected ? 'Connected' : 'Disconnected';
}

function addLog(message, type = 'info') {
    const container = document.getElementById('logContainer');
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;

    const time = new Date().toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    entry.textContent = `[${time}] ${message}`;
    container.insertBefore(entry, container.firstChild);

    // Keep only last 50 logs
    while (container.children.length > 50) {
        container.removeChild(container.lastChild);
    }
}

// ============ EVENT LISTENERS ============
function setupEventListeners() {
    // Buy button
    document.getElementById('buyBtn').addEventListener('click', () => {
        addLog('👆 Manual BUY triggered', 'info');
        executeTrade('BUY');
    });

    // Sell button
    document.getElementById('sellBtn').addEventListener('click', () => {
        addLog('👆 Manual SELL triggered', 'info');
        executeTrade('SELL');
    });

    // Close button
    document.getElementById('closeBtn').addEventListener('click', () => {
        addLog('👆 Manual CLOSE triggered', 'info');
        executeTrade('CLOSE');
    });

    // Bot toggle
    document.getElementById('botToggle').addEventListener('change', (e) => {
        state.botEnabled = e.target.checked;
        const statusEl = document.getElementById('botStatus');

        if (state.botEnabled) {
            statusEl.textContent = '🟢 Bot is RUNNING';
            statusEl.className = 'bot-status-text active';
            addLog('🤖 Bot Agent STARTED', 'success');
        } else {
            statusEl.textContent = 'Bot is OFF';
            statusEl.className = 'bot-status-text';
            addLog('🤖 Bot Agent STOPPED', 'info');
        }
    });

    // Timeframe buttons
    document.querySelectorAll('.tf-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const tf = btn.dataset.tf;
            state.currentTimeframe = tf;
            document.getElementById('currentTimeframe').textContent = tf;

            // Clear candles for new timeframe
            state.candles = [];
            state.emaHistory = [];
            candleSeries.setData([]);
            emaSeries.setData([]);

            addLog(`⏱️ Timeframe changed to ${tf}`, 'info');
        });
    });

    // Clear log
    document.getElementById('clearLogBtn').addEventListener('click', () => {
        document.getElementById('logContainer').innerHTML = '';
        addLog('Log cleared', 'info');
    });
}

// ============ TAB CHANGE LISTENER ============
function setupTabListener() {
    // Listen for tab updates
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete' && tab.url && tab.url.includes('detrade.com')) {
            state.detradeTabId = tabId;
            addLog('🔄 DeTrade tab updated', 'info');
        }
    });

    // Listen for tab removal
    chrome.tabs.onRemoved.addListener((tabId) => {
        if (tabId === state.detradeTabId) {
            state.detradeTabId = null;
            updateConnectionStatus(false);
            addLog('⚠️ DeTrade tab closed', 'error');
        }
    });
}

// ============ INITIALIZATION ============
document.addEventListener('DOMContentLoaded', async () => {
    initChart();
    setupEventListeners();
    setupTabListener();

    addLog('🚀 DeTrade Bot initialized', 'success');
    addLog('🔍 Looking for DeTrade tab...', 'info');

    // Start price scraping from DeTrade
    await startPriceScraping();
});
