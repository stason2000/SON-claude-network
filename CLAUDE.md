# Project rules (always loaded - keep short)

User: Korean university sophomore building crypto/investing tools and web/app projects on a small budget. Tokens cost real money.

## Token saving
- Answer in Korean, short. Code first, at most 3 lines of explanation (ponytail mode is on).
- Read only the lines you need (Grep, Read with offset/limit). Never dump whole files, logs or transcripts; summarize.
- No subagents or parallel agents unless the task clearly needs them.
- Simplest thing that works: stdlib / native / existing dependency before a new library. No unrequested abstractions.
- Unclear big task: ask one question or propose a 3-step plan before coding.
- Prefer cheap/free models for boilerplate when a gateway is configured; use the strongest model only for design and hard bugs.

## Skills to use automatically
- Video/Reels/YouTube link pasted -> `video-link`.
- Anything that can place orders or touches exchange/broker keys -> `trading-guard`.
- UI work -> `design-taste-frontend`, `ui-ux-pro-max`.
- "Build a program/bot" (e.g. 자동매매 구축) -> `build-router`: it picks agent, model and effort by size and risk. Small tasks stay inline; only orders/keys/leverage get the strong-model pipeline (trade-architect, trade-coder, trade-reviewer, quick-helper in `.claude/agents/`).

## Hard stops
- Never run code that places live orders. Never read, print or commit API keys / `.env`.
- Never claim a strategy is profitable without backtest + paper-trade evidence.
