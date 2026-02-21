/**
 * Trade Executor - Content Script
 * Clicks Up/Down buttons on DeTrade page based on signals from background
 */

(function () {
    console.log('[Trade Executor] Content script loaded');

    // ============ EXTENSION CONTEXT CHECK ============
    let isExtensionValid = true;

    function checkExtensionContext() {
        try {
            return !!(chrome.runtime && chrome.runtime.id);
        } catch (e) {
            return false;
        }
    }

    // ============ BUTTON CLICK ============
    function simulateClick(element) {
        if (!element) return false;

        try {
            // Dispatch standard mouse events
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

            // Explicitly call the native click method as a strong fallback for background tabs
            try {
                if (typeof element.click === 'function') {
                    element.click();
                }
            } catch (e) { }

            console.log('[Trade Executor] Clicked:', element.textContent?.trim());
            return true;
        } catch (error) {
            console.error('[Trade Executor] Click failed:', error);
            return false;
        }
    }

    function executeTradeClick(direction) {
        // direction = "UP" or "DOWN"
        console.log('[Trade Executor] Executing:', direction);

        const container = document.getElementById('up-or-down-button');
        if (!container) {
            console.error('[Trade Executor] #up-or-down-button not found!');
            return { success: false, error: 'Trade button container not found' };
        }

        const buttons = container.querySelectorAll('button');
        if (buttons.length < 2) {
            console.error('[Trade Executor] Not enough buttons in container');
            return { success: false, error: 'Buttons not found inside container' };
        }

        // First button = Up, Second button = Down
        let targetButton;
        if (direction === 'UP') {
            targetButton = buttons[0]; // Up button
        } else {
            targetButton = buttons[1]; // Down button
        }

        const clicked = simulateClick(targetButton);
        return {
            success: clicked,
            direction: direction,
            timestamp: Date.now()
        };
    }

    // ============ MESSAGE LISTENER ============
    try {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (!isExtensionValid) {
                if (checkExtensionContext()) {
                    isExtensionValid = true;
                } else {
                    sendResponse({ error: 'Extension context invalid' });
                    return true;
                }
            }

            if (message.type === 'EXECUTE_TRADE') {
                const result = executeTradeClick(message.direction);
                console.log('[Trade Executor] Result:', result);
                sendResponse(result);
                return true;
            }

            if (message.type === 'PING') {
                sendResponse({ status: 'alive', url: window.location.href });
                return true;
            }

            return false;
        });
    } catch (e) {
        console.log('[Trade Executor] Failed to add message listener:', e);
        isExtensionValid = false;
    }

    // Notify background that content script is ready
    try {
        chrome.runtime.sendMessage({
            type: 'CONTENT_SCRIPT_READY',
            url: window.location.href
        }).catch(() => { });
    } catch (e) { }

    console.log('[Trade Executor] Ready - waiting for trade signals');
})();
