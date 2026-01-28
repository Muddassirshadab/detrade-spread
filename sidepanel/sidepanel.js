/**
 * DeTrade Trading Bot - Side Panel JavaScript
 * Handles chart, trading buttons, and bot agent logic
 * Now scrapes real data from DeTrade page
 */

// ============ STATE ============
const state = {
    isConnected: false,
    isProcessingTrade: false, // Lock to prevent concurrent trades
    lastTradeTime: 0, // Cooldown timestamp
    tradeCooldown: 5000, // 5 second cooldown between trades
    currentPrice: 0,
    previousPrice: 0,
    candles: [],
    // Single EMA 15
    ema: 0,
    emaHistory: [],
    position: {
        type: 'NONE', // 'LONG', 'SHORT', 'NONE'
        entryPrice: 0,
        pnl: 0,
        highestPnl: 0, // For trailing SL
        highestPnlPercent: 0, // For % based trailing
        lowestPnl: 0   // For tracking
    },
    realPositions: 0, // Real positions from website
    realPnl: 0, // Real floating PnL from DOM (in $)
    realPnlPercent: 0, // Real floating PnL% from DOM
    botEnabled: false,
    botStats: {
        trades: 0,
        wins: 0,
        totalPnl: 0
    },
    currentTimeframe: '15s',
    emaPeriod: 15, // EMA period
    detradeTabId: null,
    priceHistory: [],
    // Trailing SL config - PERCENTAGE BASED
    trailingConfig: {
        stopLossPercent: -5,   // Exit at -5%
        trailStartPercent: 2,  // Start trailing at +2%
        trailAmount: 1         // Trail by 1%
    },
    // Optimization: separate logic loop from UI loop
    lastChartUpdate: 0
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

    // Single EMA 15 (Yellow)
    emaSeries = chart.addLineSeries({
        color: '#ffca28',
        lineWidth: 2,
        title: 'EMA 15'
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
    }, 50);
}

async function fetchCurrentPrice() {
    if (!state.detradeTabId) return;

    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: state.detradeTabId },
            func: () => {
                // STRATEGY: Find the main price by looking for the LARGEST numeric text on screen

                // Helper to parse price string
                const parsePrice = (str) => {
                    const clean = str.replace(/[^0-9.]/g, '');
                    return parseFloat(clean);
                };

                const candidates = [];
                const allElements = document.querySelectorAll('*');

                for (const el of allElements) {
                    // Skip hidden elements, inputs, and scripts
                    if (el.offsetParent === null) continue;
                    if (['INPUT', 'SELECT', 'SCRIPT', 'STYLE'].includes(el.tagName)) continue;

                    // Get text and clean it
                    const text = el.innerText?.trim();
                    if (!text) continue;

                    // Strict number check
                    if (/^[$€£]?\s*\d{1,3}(,\d{3})*(\.\d+)?$/.test(text) || /^\d+(\.\d+)?$/.test(text)) {
                        const price = parsePrice(text);

                        // Filter out unreasonably small integers that look like UI elements unless they are very large text
                        if (!isNaN(price) && price > 0) {
                            const style = window.getComputedStyle(el);
                            const fontSize = parseFloat(style.fontSize);
                            const fontWeight = parseFloat(style.fontWeight) || 400;

                            let score = fontSize * 10; // Base score on size

                            // Weight bold text
                            if (fontWeight > 500) score += 5;

                            // Penalize integer 1 (often a default qty)
                            if (price === 1 && fontSize < 20) score -= 100;

                            // Bonus for color (green/red/up/down) indicating change
                            const color = style.color;
                            if (el.className.includes('green') || el.className.includes('red') ||
                                (color !== 'rgb(0, 0, 0)' && color !== 'rgb(255, 255, 255)')) {
                                score += 20;
                            }

                            candidates.push({ price, score, debug: text, elClass: el.className });
                        }
                    }
                }

                // Sort by score descending (Largest font wins)
                candidates.sort((a, b) => b.score - a.score);

                // Position and PnL% scraping
                let positionCount = 0;
                let floatingPnl = 0;
                let floatingPnlPercent = 0;

                try {
                    // First find position count from "Positions(X)" text
                    const allElements = document.querySelectorAll('*');
                    for (const el of allElements) {
                        try {
                            if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
                            if (el.children.length > 0) continue;

                            const text = el.textContent.trim();
                            const match = text.match(/Positions\s*\(\s*(\d+)\s*\)/i);
                            if (match) {
                                positionCount = parseInt(match[1], 10);
                                break;
                            }
                        } catch (e) { }
                    }

                    // If there are positions, scrape PnL% from table
                    if (positionCount > 0) {
                        // Find table rows in positions table
                        const tables = document.querySelectorAll('table');
                        for (const table of tables) {
                            const rows = table.querySelectorAll('tbody tr');
                            if (rows.length > 0) {
                                const row = rows[0]; // First position
                                const cells = row.querySelectorAll('td');

                                // Look for cells with PnL values (typically columns 5-6)
                                for (const cell of cells) {
                                    const text = cell.textContent.trim();

                                    // Match Floating PnL (e.g., "-$2.449" or "$5.20")
                                    const pnlMatch = text.match(/^[+-]?\$?([\d,.]+)$/);
                                    if (pnlMatch && !floatingPnl) {
                                        const val = parseFloat(text.replace(/[$,]/g, ''));
                                        if (!isNaN(val) && Math.abs(val) < 10000) {
                                            floatingPnl = val;
                                        }
                                    }

                                    // Match Floating PnL% (e.g., "-244.96%" or "+5.25%")
                                    const pctMatch = text.match(/^([+-]?[\d,.]+)\s*%$/);
                                    if (pctMatch) {
                                        floatingPnlPercent = parseFloat(pctMatch[1].replace(/,/g, ''));
                                    }
                                }
                            }
                        }
                    }
                } catch (e) { }

                if (candidates.length > 0) {
                    return {
                        price: candidates[0].price,
                        source: 'largest_font',
                        debug: candidates[0],
                        positions: positionCount,
                        floatingPnl: floatingPnl,
                        floatingPnlPercent: floatingPnlPercent
                    };
                }

                return { price: null, positions: positionCount, floatingPnl: 0, floatingPnlPercent: 0 };
            }
        });

        if (results && results[0] && results[0].result) {
            const { price, source, debug, positions, floatingPnl, floatingPnlPercent } = results[0].result;

            // Update real positions and PnL
            if (typeof positions === 'number') {
                state.realPositions = positions;
            }

            // Store real PnL% from DOM
            if (positions > 0) {
                state.realPnl = floatingPnl || 0;
                state.realPnlPercent = floatingPnlPercent || 0;
            } else {
                state.realPnl = 0;
                state.realPnlPercent = 0;
            }

            if (price) {
                // Optimization: Always update Logic, but throttle UI/Chart
                const now = Date.now();

                // 1. Update Strategy/Logic (Every 50ms)
                state.currentPrice = price;
                checkStrategy();

                // 2. Update UI/Chart (Throttle to 1s to save CPU)
                if (now - state.lastChartUpdate >= 1000) {
                    if (positions > 0) {
                        console.log(`[DeTrade Bot] Price: ${price}, Positions: ${positions}, PnL%: ${floatingPnlPercent}%`);
                    } else {
                        console.log(`[DeTrade Bot] Price: ${price}, No positions`);
                    }
                    updatePrice(price);
                    buildCandle(price);
                    state.lastChartUpdate = now;
                }
            }
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


function updateEMA() {
    const closePrices = state.candles.map(c => c.close);
    const period = state.emaPeriod; // 15

    const ema = Strategy.calculateEMA(closePrices, period);

    if (ema) {
        state.ema = ema;
        document.getElementById('emaValue').textContent = `EMA(${period}): ${ema.toFixed(2)}`;

        // Build EMA history for chart
        state.emaHistory = [];
        const k = 2 / (period + 1);
        let runningEma = null;

        for (let i = 0; i < state.candles.length; i++) {
            if (i < period - 1) continue;

            if (runningEma === null) {
                runningEma = closePrices.slice(0, period).reduce((a, b) => a + b, 0) / period;
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

// getEMASlope moved to Strategy.js

// ============ STRATEGY LOGIC ============
function checkStrategy() {
    // Pre-checks
    if (!state.botEnabled) return;
    if (state.candles.length < 20) return; // Need enough for EMA15
    if (state.isProcessingTrade) return;

    // Cooldown check
    const timeSinceLastTrade = Date.now() - state.lastTradeTime;
    if (timeSinceLastTrade < state.tradeCooldown) {
        return;
    }

    const currentPrice = state.currentPrice;

    // ============ EXIT LOGIC (Real PnL% based) ============
    // Check exits first - use REAL PnL% from DOM
    if (state.realPositions > 0 && state.position.type !== 'NONE') {
        const { stopLossPercent, trailStartPercent, trailAmount } = state.trailingConfig;
        const realPnlPct = state.realPnlPercent;

        // Update highest PnL% for trailing
        if (realPnlPct > state.position.highestPnlPercent) {
            state.position.highestPnlPercent = realPnlPct;
        }

        // Log current PnL% periodically
        if (Date.now() - state.lastChartUpdate < 100) {
            addLog(`📊 Real PnL: ${state.realPnl >= 0 ? '+' : ''}$${state.realPnl.toFixed(2)} (${realPnlPct >= 0 ? '+' : ''}${realPnlPct.toFixed(2)}%)`, 'info');
        }

        updatePositionDisplay();

        // STOP LOSS: Exit if loss exceeds threshold
        if (realPnlPct <= stopLossPercent) {
            addLog(`❌ STOP LOSS HIT! PnL: ${realPnlPct.toFixed(2)}% (threshold: ${stopLossPercent}%)`, 'error');
            executeTrade('CLOSE');
            recordTradeResult(state.realPnl);
            return;
        }

        // TRAILING STOP: If profit was above trailStart and dropped by trailAmount
        if (state.position.highestPnlPercent >= trailStartPercent) {
            const dropFromPeak = state.position.highestPnlPercent - realPnlPct;

            if (dropFromPeak >= trailAmount) {
                addLog(`📈 TRAILING SL! Peak: +${state.position.highestPnlPercent.toFixed(2)}%, Exit: ${realPnlPct.toFixed(2)}%`, 'success');
                executeTrade('CLOSE');
                recordTradeResult(state.realPnl);
                return;
            }
        }

        // Currently in position, don't take new trades
        return;
    }

    // ============ ENTRY LOGIC (EMA Crossover) ============
    // Only enter when no real positions exist
    if (state.realPositions > 0) {
        // Sync internal state if needed
        if (state.position.type === 'NONE') {
            addLog(`📊 Detected ${state.realPositions} real position(s) on website`, 'info');
        }
        return;
    }

    // Need EMA for entry
    if (!state.ema) return;
    if (state.emaHistory.length < 2) return;

    // Entry - only when no positions
    if (state.position.type === 'NONE' && state.realPositions === 0) {
        const signal = Strategy.getSignal(state);

        if (signal) {
            if (signal.type === 'BUY') {
                addLog(`🔔 BUY SIGNAL: ${signal.reason}`, 'trade');
                updateSignal('BUY', 'buy');
                executeTrade('BUY');
            } else if (signal.type === 'SELL') {
                addLog(`🔔 SELL SIGNAL: ${signal.reason}`, 'trade');
                updateSignal('SELL', 'sell');
                executeTrade('SELL');
            } else if (signal.type === 'SKIP') {
                // addLog(`⚠️ Skipped: ${signal.reason}`, 'info');
            }
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
    // Double-check lock before executing
    if (state.isProcessingTrade) {
        addLog(`⚠️ Trade ${action} blocked: Already processing`, 'info');
        return;
    }

    // Set lock IMMEDIATELY
    state.isProcessingTrade = true;
    state.lastTradeTime = Date.now();

    addLog(`📤 Sending ${action} signal to DeTrade...`, 'info');

    if (!state.detradeTabId) {
        const found = await findDetradeTab();
        if (!found) {
            addLog('❌ Cannot execute trade - DeTrade tab not found', 'error');
            state.isProcessingTrade = false;
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

            // Wait for website to update position data
            addLog(`⏳ Waiting for position confirmation...`, 'info');
            await new Promise(r => setTimeout(r, 2000));

        } else {
            addLog(`❌ Trade failed: ${response?.error || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        addLog(`❌ Error: ${error.message}`, 'error');

        // Try to re-find the tab
        state.detradeTabId = null;
        await findDetradeTab();
    } finally {
        // Release lock after additional safety delay
        setTimeout(() => {
            state.isProcessingTrade = false;
            addLog(`🔓 Trade lock released, cooldown: ${state.tradeCooldown / 1000}s`, 'info');
        }, 1000);
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

            // Clear candles and EMA for new timeframe
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
