import { cliConnector } from './cliConnector';

/** Claude Code (Anthropic) — wraps the 'claude' preset. */
export default cliConnector('claude', {
  strengths: ['coding', 'review', 'writing', 'general'],
  docsUrl: 'https://code.claude.com/docs/en/overview',
  // Login: `claude auth login` — "Sign in to your Anthropic account" (CLI reference).
  // Status: `claude auth status` — "Show authentication status as JSON … Exits with
  // code 0 if logged in, 1 if not." (same CLI reference page). Output is never read.
  login: {
    mode: 'command', bins: ['claude'], args: ['auth', 'login'], sourceUrl: 'https://code.claude.com/docs/en/cli-reference', checked: '2026-10-11',
    status: { args: ['auth', 'status'], loggedOutCodes: [1], sourceUrl: 'https://code.claude.com/docs/en/cli-reference', checked: '2026-10-11' }
  },
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
