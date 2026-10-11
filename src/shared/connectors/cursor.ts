import { cliConnector } from './cliConnector';

/** Cursor Agent CLI — wraps the 'cursor' preset. */
export default cliConnector('cursor', {
  strengths: ['coding'],
  docsUrl: 'https://cursor.com/docs/cli/overview',
  // Login: `agent login` — "Log in using browser flow" (authentication docs). `cursor-agent` is tried as the legacy binary name this app's preset spawns.
  login: { mode: 'command', bins: ['agent', 'cursor-agent'], args: ['login'], sourceUrl: 'https://cursor.com/docs/cli/reference/authentication', checked: '2026-10-11' },
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
