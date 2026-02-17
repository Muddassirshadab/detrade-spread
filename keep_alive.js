/**
 * DeTrade Bot - Keep Alive Optimization
 * Forces the browser to continue rendering even when backgrounded/headless due to RDP disconnect.
 * Replaces requestAnimationFrame with setTimeout to bypass browser throttling.
 */
(function () {
    console.log('[DeTrade Bot] 🟢 Injecting Keep-Alive Optimization...');

    // 1. Block Visibility API to always return "visible"
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));

    // 2. Monkey-patch requestAnimationFrame to use setTimeout
    // Browsers stop rAF when tab is hidden/headless, so we fallback to 60fps timer
    const originalRAF = window.requestAnimationFrame;

    window.requestAnimationFrame = function (callback) {
        if (document.hidden) {
            // Force 60fps using setTimeout
            return setTimeout(() => callback(performance.now()), 16);
        } else {
            // Use native if visible (better performance)
            return originalRAF(callback);
        }
    };

    console.log('[DeTrade Bot] 🚀 Keep-Alive Active: Forced rendering enabled.');
})();
