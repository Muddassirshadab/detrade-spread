/**
 * DeTrade Bot - Strategy Module
 * logic for EMA and Signals
 */

const Strategy = {
    // Config
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

    // Main Signal Logic
    getSignal(state) {
        const { currentPrice, candles, ema, emaHistory, emaPeriod, realPositions } = state;

        // 1. Pre-checks
        if (candles.length < 3) return null;
        if (realPositions > 0) return null; // Already in trade

        const lastCandle = candles[candles.length - 1];
        const previousCandle = candles[candles.length - 2];
        if (!previousCandle) return null;

        const previousClose = previousCandle.close;
        const hasEma = ema && candles.length >= emaPeriod;

        if (!hasEma) return null;

        const emaSlope = this.getEMASlope(emaHistory);

        // Candle Color
        const isGreen = lastCandle.close > lastCandle.open;
        const isRed = lastCandle.close < lastCandle.open;

        // BUY Signal
        if (currentPrice > ema && previousClose < ema) {
            if (emaSlope > this.slopeThreshold && isGreen) {
                return { type: 'BUY', reason: `High Slope (${emaSlope.toFixed(3)}) + Green Candle` };
            } else {
                return { type: 'SKIP', reason: `Weak Slope (${emaSlope.toFixed(3)})` };
            }
        }

        // SELL Signal
        if (currentPrice < ema && previousClose > ema) {
            if (emaSlope < -this.slopeThreshold && isRed) {
                return { type: 'SELL', reason: `Low Slope (${emaSlope.toFixed(3)}) + Red Candle` };
            } else {
                return { type: 'SKIP', reason: `Weak Slope (${emaSlope.toFixed(3)})` };
            }
        }

        return null;
    }
};
