---
name: trading-guard
description: Safety rules for any crypto/stock/futures auto-trading work - strategies, bots, exchange or broker API code, backtests, API keys. Use whenever code can place real orders or touches exchange/broker credentials.
---

# trading-guard

Most retail futures bots lose money after fees, slippage and funding. Assume the edge is zero until the backtest AND paper trading say otherwise. Never promise returns.

## Order of work (no skipping)

1. Backtest with fees + slippage + funding. Out-of-sample split. Report max drawdown and trade count, not just return.
2. Paper trade: Binance/Bybit testnet, `freqtrade --dry-run`, or broker mock account (e.g. KIS 모의투자). Min 2-4 weeks.
3. Live with a loss you can afford to lose entirely. Smallest size first. Scale only after live results match paper.

## Hard rules

- Keys: env vars or a gitignored `.env`. Never in code, chat, commits, logs. Exchange key permission = read + trade only. NO withdrawal. IP-whitelist it. Found a key in a diff → stop and say so.
- Default to testnet/dry-run. Switching to live needs the user to say so explicitly in this conversation, every time. Never run live-order code yourself.
- Risk defaults: risk per trade <= 1% of account, leverage <= 3x, daily loss limit with auto-stop, max open positions, exchange-side stop-loss (not only in the bot).
- The bot is plain deterministic code. No LLM call inside the order loop (cost, latency, hallucination).
- Handle: API errors, rate limits, partial fills, lot/tick rounding, duplicate orders (idempotent client IDs), restart with open positions. Log every order.
- Leverage/futures: say liquidation price and worst-case loss before writing the strategy.
- Rules, tax and reporting depend on country and date. Korean residents using overseas exchanges: tell the user to check current rules; do not assert them.

## Output

State expected value after costs, worst case loss in currency, and what is not yet verified. Short.
