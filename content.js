/**
 * DeTrade Trading Bot - Content Script
 * Handles DOM interaction with DeTrade trading platform
 */

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
    const priceEl = findElement(SELECTORS.priceDisplay);

    if (priceEl) {
        const text = priceEl.textContent || priceEl.innerText;
        const match = text.match(/[\d,]+\.?\d*/);

        if (match) {
            return parseFloat(match[0].replace(/,/g, ''));
        }
    }

    // Try to find price in page
    const allText = document.body.innerText;
    const priceMatch = allText.match(/\b(\d{3,}\.?\d{0,2})\b/g);

    if (priceMatch && priceMatch.length > 0) {
        // Return the largest reasonable price (likely the main price)
        const prices = priceMatch.map(p => parseFloat(p)).filter(p => p > 100 && p < 100000);
        if (prices.length > 0) {
            return Math.max(...prices);
        }
    }

    return null;
}

// Start price scraping as backup
let priceScrapingInterval = null;

function startPriceScraping() {
    if (priceScrapingInterval) return;
    if (!isExtensionValid && !checkExtensionContext()) return;

    priceScrapingInterval = setInterval(() => {
        try {
            // Strict check: if runtime ID is gone, we are orphaned
            if (!chrome.runtime?.id) {
                console.log('[DeTrade Bot] Orphaned content script (no ID), stopping');
                isExtensionValid = false;
                clearAllIntervals();
                return;
            }

            if (!isExtensionValid) {
                clearAllIntervals();
                return;
            }

            const price = scrapeCurrentPrice();
            if (price) {
                safeSendMessage({
                    type: 'SCRAPED_PRICE',
                    data: { price, timestamp: Date.now() }
                });
            }
        } catch (e) {
            console.log('[DeTrade Bot] Interval error:', e.message);
            isExtensionValid = false;
            clearAllIntervals();
        }
    }, 1000);

    console.log('[DeTrade Bot] Price scraping started');
}

// ============ MESSAGE LISTENER ============
try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!isExtensionValid) {
            // Try to recover validity if context is back (unlikely in same script instance but good for safety)
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

        if (message.type === 'START_SCRAPING') {
            startPriceScraping();
            sendResponse({ status: 'started' });
            return true;
        }

        if (message.type === 'PING') {
            sendResponse({ status: 'alive', url: window.location.href });
            return true;
        }

        sendResponse({ error: 'Unknown message type' });
        return true;
    });
} catch (e) {
    console.log('[DeTrade Bot] Failed to add message listener:', e);
    isExtensionValid = false;
}

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

// Debug: Log available buttons on page
setTimeout(() => {
    if (!isExtensionValid && !checkExtensionContext()) return;

    const buttons = findAllButtons();
    console.log('[DeTrade Bot] Available buttons:', {
        buy: buttons.buy?.textContent?.trim(),
        sell: buttons.sell?.textContent?.trim(),
        close: buttons.close?.textContent?.trim()
    });
}, 2000);
