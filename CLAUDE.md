# Project rules (always loaded - keep short)

User: Korean university sophomore building crypto/investing tools and web/app projects on a small budget. Tokens cost real money.

## Token saving
- Answer in Korean, short. Code first, at most 3 lines of explanation (ponytail mode is on).
- Read only the lines you need (Grep, Read with offset/limit). Never dump whole files, logs or transcripts; summarize.
- No subagents or parallel agents unless the task clearly needs them.
- Simplest thing that works: stdlib / native / existing dependency before a new library. No unrequested abstractions.
- Unclear big task: ask one question or propose a 3-step plan before coding.

## Route EVERY request (model + effort by stakes, not by topic)
Main session runs on the cheaper model (settings.json: sonnet). Before answering, silently pick a level; one-line tag only when you delegate (`Route: H -> deep-thinker[opus/high]`).
- L (lookup, rename, format, translate, summarize given text, run a command): answer inline, minimal thinking. Bulky mechanical work (many files, long logs) -> `quick-helper` [haiku/low].
- M (normal coding, web/app features, explanations, small bugs, drafts): answer inline. Default level.
- H -> `deep-thinker` [opus; model switch verified, `effort: high` NOT verified - subagents all reported effort 15]: architecture, security, money at risk (orders, keys, leverage, investment or spending decisions), legal/regulatory, business viability with real spend, a bug that survived one failed fix.
- Unsure between M and H: do M; escalate to H only if the first attempt fails or the user's money/keys are involved. Max one deep call per question; send it only the needed context. Never delegate small tasks (agent cold start costs tokens).
- Trading-bot builds use the fixed pipeline in `build-router` (architect -> coder -> reviewer -> helper).
- I cannot switch the main session's model or thinking level mid-chat; the user can with `/model`. Say so if asked to "use Opus for this" in the main session, and delegate instead.

## Skills to use automatically
- Video/Reels/YouTube link pasted -> `video-link`.
- Anything that can place orders or touches exchange/broker keys -> `trading-guard`.
- UI work -> `design-taste-frontend`, `ui-ux-pro-max`.
- Strategy backtest/validation -> `backtest-expert`. "Is the crypto market risk-on?" / regime question -> `crypto-regime-analyzer` (needs network to CoinGecko/Binance public data; works on the user's PC).
- Files: .xlsx/.csv -> `xlsx`, .docx -> `docx`, .pptx -> `pptx`, .pdf -> `pdf`. Cost/profit tables go in xlsx.
- Competitor price/review research, web app QA, form/click automation -> `agent-browser`. Respect each site's terms.
- Bug/test failure -> `systematic-debugging` (root cause first). Before saying "done/fixed" -> `verification-before-completion` (run it, show output).
- Vague feature request -> `brainstorming`, but only when requirements are unclear; skip it for clear tasks (token cost).
- Need a skill that is not installed -> `find-skills`.
- "Build a program/bot" (e.g. 자동매매 구축) -> `build-router`: it picks agent, model and effort by size and risk. Small tasks stay inline; only orders/keys/leverage get the strong-model pipeline (trade-architect, trade-coder, trade-reviewer, quick-helper in `.claude/agents/`).

## Hard stops
- Never run code that places live orders. Never read, print or commit API keys / `.env`.
- Never claim a strategy is profitable without backtest + paper-trade evidence.
