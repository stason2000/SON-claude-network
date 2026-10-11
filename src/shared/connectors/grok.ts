import { cliConnector } from './cliConnector';

/** xAI Grok Build CLI — wraps the 'grok' preset. */
export default cliConnector('grok', {
  strengths: ['coding', 'research'],
  docsUrl: 'https://docs.x.ai/build/cli/reference',
  // Login: `grok login` — "Sign in" (CLI reference subcommands table).
  login: { mode: 'command', bins: ['grok'], args: ['login'], sourceUrl: 'https://docs.x.ai/build/cli/reference', checked: '2026-10-11' },
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
