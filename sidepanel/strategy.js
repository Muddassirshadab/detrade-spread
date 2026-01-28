/**
 * DeTrade Bot - Strategy Module
 * Single EMA (15) with Price Crossover
 */

const Strategy = {
    // Config
    emaPeriod: 15,
    slopeThreshold: 0.02,

    // EMA Calculation
    calculateEMA(prices, period) {
        if (prices.length < period) return null;

        const k = 2 / (period + 1);
        let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

        for (let i = period; i < prices.length; i++) {
            ema = prices[i] * k + ema * (1 - k);
        }
        return ema;
    },

    getEMASlope(emaHistory) {
        if (emaHistory.length < 2) return 0;
        const last = emaHistory[emaHistory.length - 1].value;
        const prev = emaHistory[emaHistory.length - 2].value;
        return last - prev;
    },

    // Main Signal Logic - Price crosses EMA
    getSignal(state) {
        const { currentPrice, candles, ema, emaHistory, realPositions } = state;

        // Pre-checks
        if (candles.length < 20) return null; // Need enough candles
        if (realPositions > 0) return null; // Already in trade
        if (!ema) return null;

        const lastCandle = candles[candles.length - 1];
        const previousCandle = candles[candles.length - 2];
        if (!previousCandle) return null;

        const previousClose = previousCandle.close;
        const emaSlope = this.getEMASlope(emaHistory);

        // Candle Color
        const isGreen = lastCandle.close > lastCandle.open;
        const isRed = lastCandle.close < lastCandle.open;

        // BUY Signal: Price crosses ABOVE EMA
        if (currentPrice > ema && previousClose < ema) {
            if (emaSlope > this.slopeThreshold && isGreen) {
                return { type: 'BUY', reason: `Price crossed above EMA15 (slope: ${emaSlope.toFixed(3)})` };
            } else {
                return { type: 'SKIP', reason: `Weak slope (${emaSlope.toFixed(3)})` };
            }
        }

        // SELL Signal: Price crosses BELOW EMA
        if (currentPrice < ema && previousClose > ema) {
            if (emaSlope < -this.slopeThreshold && isRed) {
                return { type: 'SELL', reason: `Price crossed below EMA15 (slope: ${emaSlope.toFixed(3)})` };
            } else {
                return { type: 'SKIP', reason: `Weak slope (${emaSlope.toFixed(3)})` };
            }
        }

        return null;
    }
};
