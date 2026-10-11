import { cliConnector } from './cliConnector';

/** OpenCode — wraps the 'opencode' preset. */
export default cliConnector('opencode', {
  strengths: ['coding'],
  docsUrl: 'https://opencode.ai/docs',
  // Login: `opencode auth login` (CLI docs, auth subcommand).
  login: { mode: 'command', bins: ['opencode'], args: ['auth', 'login'], sourceUrl: 'https://opencode.ai/docs/cli/', checked: '2026-10-11' },
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
