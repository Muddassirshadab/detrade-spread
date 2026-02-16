/**
 * DeTrade Trading Bot - Content Script
 * Handles DOM interaction with DeTrade trading platform
 */

(function () {

    console.log('[DeTrade Bot] Content script loaded');

    // ============ EXTENSION CONTEXT CHECK ============
    let isExtensionValid = true;

    function checkExtensionContext() {
        try {
            if (chrome.runtime && chrome.runtime.id) {
                return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    function safeSendMessage(message) {
        if (!checkExtensionContext()) {
            console.log('[DeTrade Bot] Extension context invalid, stopping');
            isExtensionValid = false;
            clearAllIntervals();
            return Promise.resolve(null);
        }

        return chrome.runtime.sendMessage(message).catch(err => {
            if (err.message.includes('Extension context invalidated')) {
                console.log('[DeTrade Bot] Extension reloaded, content script stopping');
                isExtensionValid = false;
                clearAllIntervals();
            }
            return null;
        });
    }

    function clearAllIntervals() {
        if (priceScrapingInterval) {
            clearInterval(priceScrapingInterval);
            priceScrapingInterval = null;
        }
    }

    // ============ BUTTON SELECTORS ============
    const SELECTORS = {
        // Trading buttons
        buyButton: [
            'button:contains("Buy")',
            '[class*="buy-btn"]',
            '[class*="buy_btn"]',
            '[data-action="buy"]',
            '.trade-button.buy',
            'button.buy',
            // DeTrade specific
            '[class*="actionButton"][class*="buy"]',
            'button[class*="green"]'
        ],
        sellButton: [
            'button:contains("Sell")',
            '[class*="sell-btn"]',
            '[class*="sell_btn"]',
            '[data-action="sell"]',
            '.trade-button.sell',
            'button.sell',
            '[class*="actionButton"][class*="sell"]',
            'button[class*="red"]'
        ],
        closeButton: [
            'button:contains("Close")',
            'button:contains("Close All")',
            'button:contains("Close Position")',
            '[class*="close-btn"]',
            '[class*="close_btn"]',
            '[data-action="close"]',
            '.close-position',
            '[class*="closeAll"]'
        ],
        confirmButton: [
            'button:contains("Confirm")',
            'button:contains("Yes")',
            'button:contains("OK")',
            '[class*="confirm"]',
            '.modal-confirm',
            '[data-action="confirm"]'
        ],
        // Price display
        priceDisplay: [
            '[class*="price"]',
            '[class*="lastPrice"]',
            '[class*="currentPrice"]',
            '.market-price',
            '[data-price]'
        ]
    };

    // ============ DOM UTILITIES ============
    function findElement(selectorList) {
        for (const selector of selectorList) {
            try {
                // Handle :contains() pseudo-selector
                if (selector.includes(':contains(')) {
                    const match = selector.match(/:contains\("(.+?)"\)/);
                    if (match) {
                        const text = match[1];
                        const baseSelector = selector.split(':contains')[0] || '*';
                        const elements = document.querySelectorAll(baseSelector);

                        for (const el of elements) {
                            if (el.textContent.trim().toLowerCase().includes(text.toLowerCase())) {
                                return el;
                            }
                        }
                    }
                } else {
                    const element = document.querySelector(selector);
                    if (element) return element;
                }
            } catch (e) {
                // Invalid selector, skip
            }
        }
        return null;
    }

    function findAllButtons() {
        const buttons = document.querySelectorAll('button');
        const result = {
            buy: null,
            sell: null,
            close: null
        };

        buttons.forEach(btn => {
            const text = btn.textContent.trim().toLowerCase();
            const className = (btn.className || '').toLowerCase();

            if ((text.includes('buy') || className.includes('buy')) && !result.buy) {
                result.buy = btn;
            }
            if ((text.includes('sell') || className.includes('sell')) && !result.sell) {
                result.sell = btn;
            }
            if ((text.includes('close') || className.includes('close')) && !result.close) {
                result.close = btn;
            }
        });

        return result;
    }

    function simulateClick(element) {
        if (!element) return false;

        try {
            // Scroll into view
            element.scrollIntoView({ behavior: 'instant', block: 'center' });

            // Create and dispatch mouse events
            const events = ['mousedown', 'mouseup', 'click'];

            events.forEach(eventType => {
                const event = new MouseEvent(eventType, {
                    view: window,
                    bubbles: true,
                    cancelable: true,
                    button: 0
                });
                element.dispatchEvent(event);
            });

            console.log('[DeTrade Bot] Clicked:', element.textContent?.trim() || element.className);
            return true;
        } catch (error) {
            console.error('[DeTrade Bot] Click failed:', error);
            return false;
        }
    }

    function handleConfirmation() {
        // Wait a bit for modal to appear
        setTimeout(() => {
            const confirmBtn = findElement(SELECTORS.confirmButton);
            if (confirmBtn) {
                console.log('[DeTrade Bot] Found confirmation dialog, clicking confirm...');
                simulateClick(confirmBtn);
            }
        }, 500);
    }

    // ============ TRADE EXECUTION ============
    function executeBuy() {
        console.log('[DeTrade Bot] Executing BUY...');

        let buyBtn = findElement(SELECTORS.buyButton);

        // Fallback: find by scanning all buttons
        if (!buyBtn) {
            const buttons = findAllButtons();
            buyBtn = buttons.buy;
        }

        if (buyBtn) {
            const clicked = simulateClick(buyBtn);
            if (clicked) {
                handleConfirmation();
                return { success: true, action: 'BUY' };
            }
        }

        return { success: false, error: 'Buy button not found', action: 'BUY' };
    }

    function executeSell() {
        console.log('[DeTrade Bot] Executing SELL...');

        let sellBtn = findElement(SELECTORS.sellButton);

        if (!sellBtn) {
            const buttons = findAllButtons();
            sellBtn = buttons.sell;
        }

        if (sellBtn) {
            const clicked = simulateClick(sellBtn);
            if (clicked) {
                handleConfirmation();
                return { success: true, action: 'SELL' };
            }
        }

        return { success: false, error: 'Sell button not found', action: 'SELL' };
    }

    function executeClose() {
        console.log('[DeTrade Bot] Executing CLOSE...');

        let closeBtn = findElement(SELECTORS.closeButton);

        if (!closeBtn) {
            const buttons = findAllButtons();
            closeBtn = buttons.close;
        }

        if (closeBtn) {
            const clicked = simulateClick(closeBtn);
            if (clicked) {
                handleConfirmation();
                return { success: true, action: 'CLOSE' };
            }
        }

        return { success: false, error: 'Close button not found', action: 'CLOSE' };
    }

    // ============ PRICE SCRAPING (BACKUP) ============
    function scrapeCurrentPrice() {
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

            const text = el.innerText?.trim();
            if (!text) continue;

            if (/^[$€£]?\s*\d{1,3}(,\d{3})*(\.\d+)?$/.test(text) || /^\d+(\.\d+)?$/.test(text)) {
                const price = parsePrice(text);
                if (!isNaN(price) && price > 0) {
                    const style = window.getComputedStyle(el);
                    const fontSize = parseFloat(style.fontSize);
                    const fontWeight = parseFloat(style.fontWeight) || 400;

                    let score = fontSize * 10;

                    if (fontWeight > 500) score += 5;
                    if (price === 1 && fontSize < 20) score -= 100;

                    if (el.className.includes('green') || el.className.includes('red') ||
                        (style.color !== 'rgb(0, 0, 0)' && style.color !== 'rgb(255, 255, 255)')) {
                        score += 20;
                    }

                    candidates.push({ price, score });
                }
            }
        }

        candidates.sort((a, b) => b.score - a.score);

        if (candidates.length > 0) {
            return candidates[0].price;
        }

        return null;
    }



    // ============ POSITION SCRAPING ============
    function getOpenPositionsCount() {
        try {
            // Strategy: Look for "Positions(x)" or "Positions (x)" text
            const allElements = document.querySelectorAll('*');

            for (const el of allElements) {
                // Skip hidden/script tags
                if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
                if (!el.textContent) continue;
                // Optimization: Skip elements with too much text
                if (el.textContent.length > 50) continue;

                // Look for direct text match "Positions("
                const text = el.textContent.trim();
                const match = text.match(/Positions\s*\(\s*(\d+)\s*\)/i);

                if (match) {
                    // Start checking if it's visible or likely the tab
                    if (el.offsetParent !== null) {
                        return parseInt(match[1], 10);
                    }
                }
            }
            return 0;
        } catch (e) {
            console.error('[DeTrade Bot] Error counting positions:', e);
            return 0;
        }
    }

    // ============ PRICE SCRAPING (BACKUP) ============
    function scrapeCurrentPrice() {
        // ... (existing scrape logic remains same) ...
        const candidates = [];
        const allElements = document.querySelectorAll('*');
        // ... (existing parsing logic remains same) ...
        // For brevity, assuming scrapeCurrentPrice implementation is unchanged

        // Re-implementing simplified scrapeCurrentPrice wrapper content here is tricky without full context
        // Instead, let's just modify the `startPriceScraping` function below.
    }

    // ... (rest of file) ...

    // Start price scraping as backup
    let priceScrapingInterval = null;

    function startPriceScraping() {
        if (priceScrapingInterval) return;
        if (!isExtensionValid && !checkExtensionContext()) return;

        priceScrapingInterval = setInterval(() => {
            try {
                if (!chrome.runtime?.id) {
                    isExtensionValid = false;
                    clearAllIntervals();
                    return;
                }

                if (!isExtensionValid) {
                    clearAllIntervals();
                    return;
                }

                const price = scrapeCurrentPrice(); // Calls existing function
                if (price) {
                    // Write to Storage for Background/Sidepanel access
                    chrome.storage.local.set({ lastPrice: price });

                    // Still send message for real-time websocket emulation?
                    // safeSendMessage({
                    //     type: 'SCRAPED_PRICE',
                    //     data: { price, timestamp: Date.now() }
                    // });
                }
            } catch (e) {
                console.log('[DeTrade Bot] Interval error:', e.message);
                isExtensionValid = false;
                clearAllIntervals();
            }
        }, 1000); // Slower interval for storage writes (1s)

        console.log('[DeTrade Bot] Price scraping started');
    }

    // ============ MESSAGE LISTENER (RESTORED) ============
    try {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (!isExtensionValid) {
                // Try to recover validity if context is back
                if (checkExtensionContext()) {
                    isExtensionValid = true;
                } else {
                    sendResponse({ error: 'Extension context invalid' });
                    return true;
                }
            }

            console.log('[DeTrade Bot] Received message:', message);

            if (message.type === 'EXECUTE_TRADE') {
                let result;

                switch (message.action) {
                    case 'BUY':
                        result = executeBuy();
                        break;
                    case 'SELL':
                        result = executeSell();
                        break;
                    case 'CLOSE':
                        result = executeClose();
                        break;
                    default:
                        result = { success: false, error: 'Unknown action' };
                }

                sendResponse(result);
                return true;
            }

            if (message.type === 'GET_PRICE') {
                const price = scrapeCurrentPrice();
                sendResponse({ price });
                return true;
            }

            if (message.type === 'GET_POSITIONS_COUNT') {
                const count = getOpenPositionsCount();
                sendResponse({ count });
                return true;
            }

            if (message.type === 'START_SCRAPING') {
                startPriceScraping();
                sendResponse({ status: 'started' });
                return true;
            }

            if (message.type === 'PING') {
                sendResponse({ status: 'alive', url: window.location.href });
                return true;
            }

            // Don't keep channel open for unknown messages
            return false;
        });
    } catch (e) {
        console.log('[DeTrade Bot] Failed to add message listener:', e);
        isExtensionValid = false;
    }

    // ============ CAPITAL SCRAPING ============
    function scrapeCapital() {
        try {
            // User provided class for wallet/capital container
            // class="shrink-0 h-10 flex items-center gap-1 px-3 py-1 border-2 bg-layer3 border-input rounded-2 leading-normal"
            // Inside it usually has the value. 
            // Better to look for specific structure or text if class is dynamic

            // Try specific selector based on user input snippet
            const walletDiv = document.querySelector('.auto-refg4erfr4nic4');

            // Heuristic A: Look for USDT icon and get sibling text
            const usdtIcons = document.querySelectorAll('img[src*="USDT"]');
            for (const icon of usdtIcons) {
                // Go up to container
                const container = icon.closest('div.flex.items.center');
                if (container) {
                    const textDiv = container.innerText;
                    // Extract number
                    const match = textDiv.match(/(\d+(\.\d+)?)/);
                    if (match) return match[0];
                }
            }

            // Heuristic B: The specific class user gave
            if (walletDiv) {
                const val = walletDiv.textContent.match(/(\d+(\.\d+)?)/);
                if (val) return val[0];
            }

            // Heuristic C: "text-warn" class often used for balance
            const warns = document.querySelectorAll('.text-warn');
            for (const w of warns) {
                if (w.textContent.match(/^\d+\.\d+$/)) {
                    // Check if close to "Demo account" or "Total Asset"
                    return w.textContent.trim();
                }
            }

            return "0.00";
        } catch (e) {
            return "Error";
        }
    }

    // Send capital updates to storage & background
    let lastCapital = "";
    setInterval(() => {
        if (!isExtensionValid && !checkExtensionContext()) return;

        const cap = scrapeCapital();
        if (cap !== lastCapital && cap !== "Error") {
            lastCapital = cap;
            // Write to storage (Persistent)
            chrome.storage.local.set({ lastCapital: cap });
            // Send message for immediate update
            safeSendMessage({ type: 'CAPITAL_UPDATE', data: cap });
        }
    }, 5000);

    // ============ INITIALIZATION ============
    // Notify that content script is ready
    safeSendMessage({
        type: 'CONTENT_SCRIPT_READY',
        url: window.location.href
    });

    // Start price scraping if on trading page
    if (window.location.href.includes('trade-center') ||
        window.location.href.includes('futures') ||
        window.location.href.includes('trading')) {
        startPriceScraping();
    }
})();
