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
    tradeCooldown: 3000, // 3 second cooldown
    currentPrice: 0,
    previousPrice: 0,
    candles: [],
    // Single EMA 15
    ema: 0,
    emaHistory: [],
    position: {
        type: 'NONE', // 'LONG', 'SHORT', 'NONE'
        entryPrice: 0,
        entryTime: 0, // Timestamp for time-based exit
        pnl: 0,
        highestPnl: 0, // For trailing SL
        highestPnlPercent: 0, // For % based trailing
        lowestPnl: 0,   // For tracking
        breakEvenActivated: false // Track if SL moved to breakeven
    },
    internalPnlPercent: 0, // Calculated PnL (not from DOM)
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
    // Trailing SL config - ULTRA TIGHT FOR 505x LEVERAGE
    // Liquidation at ~0.2%, so SL at 0.175% to exit BEFORE liquidation
    trailingConfig: {
        stopLossPercent: -0.175,   // Exit at -0.175% (before 0.2% liquidation!)
        breakEvenTrigger: 0.05,    // Move SL to 0% when +0.05% profit
        trailStartPercent: 0.2,    // Start trailing at +0.2%
        trailAmount: 0.05,         // Trail by 0.05% drop from peak
        timeoutSeconds: 30         // Exit if no profit after 30 seconds
    },
    // Consecutive loss detection
    consecutiveLosses: 0,          // Count of consecutive liquidations/losses
    lastTradeDirection: null,      // 'BUY' or 'SELL' - last trade direction
    directionFlipped: false,       // True if we flipped direction after 2 losses
    flipCooldownUntil: 0,          // Timestamp - wait until this time after flip
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

                // Position and PnL% scraping - IMPROVED VERSION
                let positionCount = 0;
                let floatingPnl = 0;
                let floatingPnlPercent = 0;

                try {
                    // METHOD 1: Find position count from "Positions(X)" text anywhere on page
                    const bodyText = document.body.innerText;
                    const posMatch = bodyText.match(/Positions\s*\(\s*(\d+)\s*\)/i);
                    if (posMatch) {
                        positionCount = parseInt(posMatch[1], 10);
                    }

                    console.log('[DeTrade Scraper] Position count:', positionCount);

                    // METHOD 2: If positions found, scrape PnL from table
                    if (positionCount > 0) {
                        // Find the positions table - usually the one with position data
                        const tables = document.querySelectorAll('table');

                        for (const table of tables) {
                            const rows = table.querySelectorAll('tbody tr');
                            if (rows.length === 0) continue;

                            // Get column headers to find correct columns
                            const headers = table.querySelectorAll('thead th, thead td');
                            let floatingPnlColIdx = -1;
                            let floatingPnlPctColIdx = -1;

                            headers.forEach((th, idx) => {
                                const headerText = th.textContent.trim().toLowerCase();
                                if (headerText.includes('floating pnl') && headerText.includes('%')) {
                                    floatingPnlPctColIdx = idx;
                                } else if (headerText.includes('floating pnl') && !headerText.includes('%')) {
                                    floatingPnlColIdx = idx;
                                }
                            });

                            console.log('[DeTrade Scraper] Found columns - PnL:', floatingPnlColIdx, 'PnL%:', floatingPnlPctColIdx);

                            // Get first row (first position)
                            const row = rows[0];
                            const cells = row.querySelectorAll('td');

                            // If we found the column indices, use them
                            if (floatingPnlPctColIdx >= 0 && cells[floatingPnlPctColIdx]) {
                                const pctText = cells[floatingPnlPctColIdx].textContent.trim();
                                // Extract number from text like "+84.27%" or "-5.5%"
                                const pctMatch = pctText.match(/([+-]?\d+\.?\d*)/);
                                if (pctMatch) {
                                    floatingPnlPercent = parseFloat(pctMatch[1]);
                                    console.log('[DeTrade Scraper] PnL% from column:', floatingPnlPercent);
                                }
                            }

                            if (floatingPnlColIdx >= 0 && cells[floatingPnlColIdx]) {
                                const pnlText = cells[floatingPnlColIdx].textContent.trim();
                                const pnlMatch = pnlText.match(/([+-]?\d+\.?\d*)/);
                                if (pnlMatch) {
                                    floatingPnl = parseFloat(pnlMatch[1]);
                                    console.log('[DeTrade Scraper] PnL from column:', floatingPnl);
                                }
                            }

                            // FALLBACK: If column headers not found, scan all cells
                            if (floatingPnlPercent === 0) {
                                for (let i = 0; i < cells.length; i++) {
                                    const cellText = cells[i].textContent.trim();

                                    // Look for percentage value (contains %)
                                    if (cellText.includes('%')) {
                                        const match = cellText.match(/([+-]?\d+\.?\d*)\s*%/);
                                        if (match) {
                                            const val = parseFloat(match[1]);
                                            // Floating PnL% is usually larger absolute value
                                            if (Math.abs(val) > Math.abs(floatingPnlPercent)) {
                                                floatingPnlPercent = val;
                                                console.log('[DeTrade Scraper] PnL% from scan:', floatingPnlPercent, 'cell:', i);
                                            }
                                        }
                                    }
                                }
                            }

                            // If we found data, stop looking at other tables
                            if (floatingPnlPercent !== 0 || floatingPnl !== 0) {
                                break;
                            }
                        }
                    }

                    console.log('[DeTrade Scraper] Final - Positions:', positionCount, 'PnL:', floatingPnl, 'PnL%:', floatingPnlPercent);

                } catch (e) {
                    console.error('[DeTrade Scraper] Error:', e);
                }

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

                // CRITICAL SYNC: If website shows 0 positions but bot thinks there's a position,
                // reset the internal state immediately
                if (state.position.type !== 'NONE') {
                    console.log('[DeTrade Bot] Website shows 0 positions, resetting internal state');
                    addLog(`🔄 Position closed on website - syncing state`, 'info');
                    state.position = {
                        type: 'NONE',
                        entryPrice: 0,
                        pnl: 0,
                        highestPnl: 0,
                        highestPnlPercent: 0,
                        lowestPnl: 0
                    };
                    updatePositionDisplay();
                    updateSignal('WAITING');
                }
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
                    updatePositionDisplay(); // Update position PnL display
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
    const config = state.trailingConfig;

    // ============ EXIT LOGIC (Internal PnL Calculation) ============
    // Check if we have an active position (internal state)
    if (state.position.type !== 'NONE' && state.position.entryPrice > 0) {

        // Calculate PnL internally based on entry price
        let pnlPercent = 0;
        if (state.position.type === 'LONG') {
            pnlPercent = ((currentPrice - state.position.entryPrice) / state.position.entryPrice) * 100;
        } else if (state.position.type === 'SHORT') {
            pnlPercent = ((state.position.entryPrice - currentPrice) / state.position.entryPrice) * 100;
        } else if (state.position.type === 'EXTERNAL') {
            // For external positions, use DOM PnL if available, else calculate
            pnlPercent = state.realPnlPercent !== 0 ? state.realPnlPercent :
                ((currentPrice - state.position.entryPrice) / state.position.entryPrice) * 100;
        }

        // Store internal PnL
        state.internalPnlPercent = pnlPercent;

        // Update highest PnL for trailing
        if (pnlPercent > state.position.highestPnlPercent) {
            state.position.highestPnlPercent = pnlPercent;
        }

        // Log PnL periodically (every chart update)
        if (Date.now() - state.lastChartUpdate < 100) {
            const pnlDisplay = pnlPercent >= 0 ? `+${pnlPercent.toFixed(3)}%` : `${pnlPercent.toFixed(3)}%`;
            addLog(`📊 Internal PnL: ${pnlDisplay} | Peak: +${state.position.highestPnlPercent.toFixed(3)}%`, 'info');
        }

        updatePositionDisplay();

        // ---- EXIT CHECKS ----

        // 1. STOP LOSS: Exit if loss exceeds threshold
        if (pnlPercent <= config.stopLossPercent) {
            addLog(`❌ STOP LOSS! PnL: ${pnlPercent.toFixed(3)}% (limit: ${config.stopLossPercent}%)`, 'error');
            executeTrade('CLOSE');
            recordTradeResult(pnlPercent);
            return;
        }

        // 2. TIME-BASED EXIT: Exit if no profit after timeout
        const timeInTrade = (Date.now() - state.position.entryTime) / 1000;
        if (timeInTrade >= config.timeoutSeconds && pnlPercent <= 0) {
            addLog(`⏰ TIMEOUT EXIT! ${timeInTrade.toFixed(0)}s, PnL: ${pnlPercent.toFixed(3)}%`, 'error');
            executeTrade('CLOSE');
            recordTradeResult(pnlPercent);
            return;
        }

        // 3. BREAKEVEN ACTIVATION: Move SL to 0 when profit hits trigger
        if (!state.position.breakEvenActivated && pnlPercent >= config.breakEvenTrigger) {
            state.position.breakEvenActivated = true;
            addLog(`🔒 BREAKEVEN ACTIVATED! PnL: +${pnlPercent.toFixed(3)}% - SL moved to 0%`, 'success');
        }

        // 4. BREAKEVEN EXIT: If breakeven activated and price dropped back to 0
        if (state.position.breakEvenActivated && pnlPercent <= 0) {
            addLog(`🔒 BREAKEVEN EXIT! PnL dropped to ${pnlPercent.toFixed(3)}%`, 'info');
            executeTrade('CLOSE');
            recordTradeResult(pnlPercent);
            return;
        }

        // 5. TRAILING STOP: If profit was above trailStart and dropped by trailAmount
        if (state.position.highestPnlPercent >= config.trailStartPercent) {
            const dropFromPeak = state.position.highestPnlPercent - pnlPercent;

            if (dropFromPeak >= config.trailAmount) {
                addLog(`📈 TRAILING SL! Peak: +${state.position.highestPnlPercent.toFixed(3)}%, Exit: ${pnlPercent.toFixed(3)}%`, 'success');
                executeTrade('CLOSE');
                recordTradeResult(pnlPercent);
                return;
            }
        }

        // Still in position, don't take new trades
        return;
    }

    // ============ SYNC WITH WEBSITE ============
    // If website shows positions but we don't track one, sync
    if (state.realPositions > 0 && state.position.type === 'NONE') {
        state.position.type = 'EXTERNAL';
        state.position.entryPrice = currentPrice;
        state.position.entryTime = Date.now();
        state.position.highestPnlPercent = state.realPnlPercent || 0;
        state.position.breakEvenActivated = false;
        addLog(`📊 Detected ${state.realPositions} position(s) on website - syncing`, 'info');
        return;
    }

    // ============ ENTRY LOGIC (Score-based with Time-Based Flip) ============
    // Only enter when no positions (internal or external)
    if (state.realPositions > 0) return; // Website has position

    // Need EMA for entry
    if (!state.ema) return;
    if (state.emaHistory.length < 2) return;

    // Check if flip period has expired (auto-deactivate after 5-10 seconds)
    if (state.directionFlipped && state.flipCooldownUntil > 0 && Date.now() > state.flipCooldownUntil) {
        state.directionFlipped = false;
        state.consecutiveLosses = 0; // Reset counter too
        addLog(`✅ Flip period ended. Back to NORMAL signals.`, 'info');
    }

    // Get signal from strategy
    const signal = Strategy.getSignal(state);

    if (signal && (signal.type === 'BUY' || signal.type === 'SELL')) {
        let finalDirection = signal.type;

        // If direction flipped (during 5-10 sec window), take opposite trade
        if (state.directionFlipped) {
            finalDirection = signal.type === 'BUY' ? 'SELL' : 'BUY';
            const remainingSec = ((state.flipCooldownUntil - Date.now()) / 1000).toFixed(1);
            addLog(`🔄 FLIP! Signal=${signal.type} → Taking ${finalDirection} (${remainingSec}s left)`, 'trade');
        }

        if (finalDirection === 'BUY') {
            addLog(`🔔 BUY: ${signal.reason}`, 'trade');
            updateSignal(`BUY (${signal.score})`, 'buy');
            state.lastTradeDirection = 'BUY';
            executeTrade('BUY');
        } else if (finalDirection === 'SELL') {
            addLog(`🔔 SELL: ${signal.reason}`, 'trade');
            updateSignal(`SELL (${signal.score})`, 'sell');
            state.lastTradeDirection = 'SELL';
            executeTrade('SELL');
        }
    } else if (signal && signal.type === 'SKIP') {
        // Uncomment to debug weak signals
        // addLog(`⚠️ ${signal.reason}`, 'info');
    }
}

function recordTradeResult(pnlPercent) {
    state.botStats.trades++;
    // Note: pnlPercent is used for win/loss calculation
    // For actual $ PnL, we'd need position size which varies
    state.botStats.totalPnl += pnlPercent; // Store as % for now

    const isLoss = pnlPercent < 0;
    const isLiquidation = pnlPercent <= -50; // -100% or similar = liquidation

    if (isLoss) {
        // Increment consecutive loss counter
        state.consecutiveLosses++;
        addLog(`📊 LOSS #${state.consecutiveLosses}: ${pnlPercent.toFixed(3)}%`, 'error');

        // After 2 consecutive losses, flip direction for 10 seconds
        if (state.consecutiveLosses >= 2) {
            state.directionFlipped = true;
            state.flipCooldownUntil = Date.now() + 10000; // Flip active for 10 seconds
            addLog(`🔄 2 consecutive losses! FLIP MODE for 10 seconds`, 'error');
        }
    } else {
        // Win - reset consecutive loss counter
        state.consecutiveLosses = 0;
        state.botStats.wins++;
        addLog(`📊 WIN: +${pnlPercent.toFixed(3)}%`, 'success');
    }

    updateBotStats();

    // Reset position with all fields
    state.position = {
        type: 'NONE',
        entryPrice: 0,
        entryTime: 0,
        pnl: 0,
        highestPnl: 0,
        highestPnlPercent: 0,
        lowestPnl: 0,
        breakEvenActivated: false
    };
    state.internalPnlPercent = 0;
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
                state.position = {
                    type: 'LONG',
                    entryPrice: state.currentPrice,
                    entryTime: Date.now(),
                    pnl: 0,
                    highestPnl: 0,
                    highestPnlPercent: 0,
                    lowestPnl: 0,
                    breakEvenActivated: false
                };
                addLog(`📥 LONG @ ${state.currentPrice.toFixed(2)}`, 'success');
            } else if (action === 'SELL') {
                state.position = {
                    type: 'SHORT',
                    entryPrice: state.currentPrice,
                    entryTime: Date.now(),
                    pnl: 0,
                    highestPnl: 0,
                    highestPnlPercent: 0,
                    lowestPnl: 0,
                    breakEvenActivated: false
                };
                addLog(`📥 SHORT @ ${state.currentPrice.toFixed(2)}`, 'success');
            } else if (action === 'CLOSE') {
                state.position = {
                    type: 'NONE',
                    entryPrice: 0,
                    entryTime: 0,
                    pnl: 0,
                    highestPnl: 0,
                    highestPnlPercent: 0,
                    lowestPnl: 0,
                    breakEvenActivated: false
                };
            }

            updatePositionDisplay();

            // Confirmation wait
            addLog(`⏳ Confirming...`, 'info');
            await new Promise(r => setTimeout(r, 1500));

        } else {
            addLog(`❌ Trade failed: ${response?.error || 'Unknown error'}`, 'error');

            // If CLOSE failed (button not found), assume LIQUIDATION happened
            if (action === 'CLOSE') {
                addLog(`💀 LIQUIDATION DETECTED! Close button not found - position already gone`, 'error');
                // Record as -100% loss (full liquidation)
                recordTradeResult(-100);
            }
        }
    } catch (error) {
        addLog(`❌ Error: ${error.message}`, 'error');

        // If we were trying to close and got error, assume liquidation
        if (state.position.type !== 'NONE') {
            addLog(`💀 Possible LIQUIDATION - resetting state`, 'error');
            recordTradeResult(-100);
        }

        // Try to re-find the tab
        state.detradeTabId = null;
        await findDetradeTab();
    } finally {
        // Release lock faster for high-frequency trading
        setTimeout(() => {
            state.isProcessingTrade = false;
            addLog(`🔓 Lock released`, 'info');
        }, 300);
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

    // Show position type based on internal state
    if (state.position.type !== 'NONE') {
        const posType = state.position.type;
        // Add BE indicator if breakeven is activated
        const beIndicator = state.position.breakEvenActivated ? ' 🔒' : '';
        typeEl.textContent = posType + beIndicator;
        typeEl.style.color = posType === 'LONG' ? '#26a69a' :
            posType === 'SHORT' ? '#ef5350' : '#ffca28'; // Yellow for external
    } else {
        typeEl.textContent = 'NONE';
        typeEl.style.color = '#a0a0c0';
    }

    entryEl.textContent = state.position.entryPrice > 0 ?
        state.position.entryPrice.toFixed(2) : '---.--';

    // Use INTERNAL PnL calculation (not DOM scrape)
    const pnlPct = state.internalPnlPercent;

    if (state.position.type !== 'NONE' && state.position.entryPrice > 0) {
        // Show internal PnL with peak
        const pnlText = pnlPct >= 0 ? `+${pnlPct.toFixed(3)}%` : `${pnlPct.toFixed(3)}%`;
        const peakText = state.position.highestPnlPercent > 0 ?
            ` (Peak: +${state.position.highestPnlPercent.toFixed(2)}%)` : '';
        pnlEl.textContent = pnlText + peakText;
    } else {
        pnlEl.textContent = '0.000%';
    }
    pnlEl.className = `pos-value pnl ${pnlPct >= 0 ? 'positive' : 'negative'}`;
}

function updateBotStats() {
    document.getElementById('totalTrades').textContent = state.botStats.trades;
    document.getElementById('winRate').textContent = state.botStats.trades > 0
        ? `${((state.botStats.wins / state.botStats.trades) * 100).toFixed(0)}%`
        : '0%';

    const totalPnl = state.botStats.totalPnl;
    const pnlEl = document.getElementById('totalPnl');
    // Show cumulative PnL percentage
    pnlEl.textContent = `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}%`;
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
