import { cliConnector } from './cliConnector';

/** OpenAI Codex CLI — wraps the 'codex' preset. */
export default cliConnector('codex', {
  strengths: ['coding', 'review'],
  docsUrl: 'https://learn.chatgpt.com/docs/codex/cli',
  // Login: `codex login`, "then complete the browser flow" (Codex auth docs).
  // Status: `codex login status` — "Print the active authentication mode and exit
  // with 0 when logged in." (Codex CLI reference). The docs name no logged-out code,
  // so only exit 0 is trusted; anything else falls back to the manual button.
  login: {
    mode: 'command', bins: ['codex'], args: ['login'], sourceUrl: 'https://developers.openai.com/codex/auth', checked: '2026-10-11',
    status: { args: ['login', 'status'], loggedOutCodes: [], sourceUrl: 'https://developers.openai.com/codex/cli/reference', checked: '2026-10-11' }
  },
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
