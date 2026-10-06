---
name: build-router
description: Picks the right agent, model and reasoning effort for a build request. Use when the user asks to build a program or bot, especially "자동매매 프로그램 구축", "트레이딩 봇 만들어줘", or any multi-file project. Skip for small edits and questions.
---

# build-router

Judge size and risk first, then spend model power only where a mistake costs money. Every agent call re-reads context, so do not delegate small work.

## 1. Classify

| Size/risk | Do |
|---|---|
| Tiny (one file, no orders, no keys) | Do it inline in this session. No agents. |
| Mechanical (tests, docs, boilerplate) | `quick-helper` (haiku, low) |
| Normal feature | `trade-coder` or inline (sonnet, medium) |
| New trading system, or anything touching orders / keys / leverage | Full pipeline below |

## 2. Full pipeline ("자동매매프로그램 구축해줘")

1. Missing market, exchange, or capital? Ask ONE short question, with a default. Otherwise assume spot/crypto, dry-run, small capital.
2. `trade-architect` (opus, high) -> one-page design. Show it to the user; wait for OK.
3. `trade-coder` (sonnet, medium) -> dry-run implementation + backtest. Dry-run/testnet only.
4. `trade-reviewer` (opus, high) -> money-at-risk findings. Fix, then re-review once.
5. `quick-helper` (haiku, low) -> tests, README, `.env.example`.
6. Report: what exists, backtest numbers, what is unverified, and the next gate (paper trading). Never start live trading.

Pass each agent only what it needs (design text, file paths), not the whole conversation.

## 3. Say it once

Tell the user which route you chose and why, in one line: `Route: full pipeline (orders+keys) -> architect[opus/high], coder[sonnet/med], reviewer[opus/high]`.

Limit: I cannot change the main session's model or thinking level. Agents carry their own model and effort. Keep the main session on a cheaper model (`/model` sonnet) and let the agents carry the expensive thinking.
