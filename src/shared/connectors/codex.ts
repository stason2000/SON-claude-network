import { cliConnector } from './cliConnector';

/** OpenAI Codex CLI — wraps the 'codex' preset. */
export default cliConnector('codex', {
  strengths: ['coding', 'review'],
  docsUrl: 'https://learn.chatgpt.com/docs/codex/cli',
  // Login: `codex login`, "then complete the browser flow" (Codex auth docs).
  login: { mode: 'command', bins: ['codex'], args: ['login'], sourceUrl: 'https://developers.openai.com/codex/auth', checked: '2026-10-11' },
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
