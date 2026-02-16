/**
 * DeTrade Bot - Strategy Module
 * Multi-Confirmation Entry System with Scoring
 */

const Strategy = {
    // Config
    emaPeriod: 10,
    slopeThreshold: 0.01,       // Reduced for faster signals
    bufferPoints: 10,           // Price must be X points away from EMA
    minScore: 3,                // Minimum score to take trade

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

    // Calculate candle body size
    getCandleBody(candle) {
        return Math.abs(candle.close - candle.open);
    },

    // Check if candles show momentum
    getMomentumScore(candles, direction) {
        if (candles.length < 3) return 0;

        const last3 = candles.slice(-3);
        let score = 0;

        // Count candles in same direction
        for (const candle of last3) {
            const isGreen = candle.close > candle.open;
            const isRed = candle.close < candle.open;

            if (direction === 'BUY' && isGreen) score++;
            if (direction === 'SELL' && isRed) score++;
        }

        // 2+ candles same direction = +1 point
        // 3 candles same direction = +2 points
        if (score >= 3) return 2;
        if (score >= 2) return 1;
        return 0;
    },

    // Main Signal Logic - Scoring System
    getSignal(state) {
        const { currentPrice, candles, ema, emaHistory, realPositions } = state;

        // Pre-checks
        if (candles.length < 20) return null;
        if (realPositions > 0) return null;
        if (!ema) return null;

        const lastCandle = candles[candles.length - 1];
        const previousCandle = candles[candles.length - 2];
        if (!previousCandle) return null;

        const previousClose = previousCandle.close;
        const emaSlope = this.getEMASlope(emaHistory);

        // Candle properties
        const isGreen = lastCandle.close > lastCandle.open;
        const isRed = lastCandle.close < lastCandle.open;
        const candleBody = this.getCandleBody(lastCandle);

        // ============ BUY SCORING ============
        if (currentPrice > ema) {
            let buyScore = 0;
            let reasons = [];

            // 1. EMA Crossover (+1)
            if (previousClose < ema && currentPrice > ema) {
                buyScore += 1;
                reasons.push('EMA cross');
            }

            // 2. Price above EMA (+1)
            if (currentPrice > ema) {
                buyScore += 1;
                reasons.push('Above EMA');
            }

            // 3. EMA slope positive (+1)
            if (emaSlope > this.slopeThreshold) {
                buyScore += 1;
                reasons.push(`Slope +${emaSlope.toFixed(3)}`);
            }

            // 4. Current candle is GREEN (+1)
            if (isGreen) {
                buyScore += 1;
                reasons.push('Green candle');
            }

            // 5. Buffer: Price is 10+ points above EMA (+1)
            if (currentPrice - ema >= this.bufferPoints) {
                buyScore += 1;
                reasons.push(`Buffer +${(currentPrice - ema).toFixed(1)}`);
            }

            // 6. Momentum: Last 2-3 candles green (+1 or +2)
            const momentumScore = this.getMomentumScore(candles, 'BUY');
            if (momentumScore > 0) {
                buyScore += momentumScore;
                reasons.push(`Momentum +${momentumScore}`);
            }

            // Check if score meets threshold
            if (buyScore >= this.minScore) {
                return {
                    type: 'BUY',
                    score: buyScore,
                    reason: `Score ${buyScore}: ${reasons.join(', ')}`
                };
            } else if (buyScore > 0) {
                return {
                    type: 'SKIP',
                    reason: `Weak BUY score ${buyScore}/${this.minScore}: ${reasons.join(', ')}`
                };
            }
        }

        // ============ SELL SCORING ============
        if (currentPrice < ema) {
            let sellScore = 0;
            let reasons = [];

            // 1. EMA Crossover (+1)
            if (previousClose > ema && currentPrice < ema) {
                sellScore += 1;
                reasons.push('EMA cross');
            }

            // 2. Price below EMA (+1)
            if (currentPrice < ema) {
                sellScore += 1;
                reasons.push('Below EMA');
            }

            // 3. EMA slope negative (+1)
            if (emaSlope < -this.slopeThreshold) {
                sellScore += 1;
                reasons.push(`Slope ${emaSlope.toFixed(3)}`);
            }

            // 4. Current candle is RED (+1)
            if (isRed) {
                sellScore += 1;
                reasons.push('Red candle');
            }

            // 5. Buffer: Price is 10+ points below EMA (+1)
            if (ema - currentPrice >= this.bufferPoints) {
                sellScore += 1;
                reasons.push(`Buffer -${(ema - currentPrice).toFixed(1)}`);
            }

            // 6. Momentum: Last 2-3 candles red (+1 or +2)
            const momentumScore = this.getMomentumScore(candles, 'SELL');
            if (momentumScore > 0) {
                sellScore += momentumScore;
                reasons.push(`Momentum +${momentumScore}`);
            }

            // Check if score meets threshold
            if (sellScore >= this.minScore) {
                return {
                    type: 'SELL',
                    score: sellScore,
                    reason: `Score ${sellScore}: ${reasons.join(', ')}`
                };
            } else if (sellScore > 0) {
                return {
                    type: 'SKIP',
                    reason: `Weak SELL score ${sellScore}/${this.minScore}: ${reasons.join(', ')}`
                };
            }
        }

        return null;
    }
};
