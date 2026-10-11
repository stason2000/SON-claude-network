import { cliConnector } from './cliConnector';

/** Google Gemini CLI — wraps the 'gemini' preset. */
export default cliConnector('gemini', {
  strengths: ['coding', 'research', 'general'],
  docsUrl: 'https://geminicli.com/docs/',
  // Login: No login subcommand: start Gemini CLI and pick "Sign in with Google" (authentication docs).
  login: { mode: 'first-run', bins: ['gemini'], args: [], sourceUrl: 'https://geminicli.com/docs/get-started/authentication/', checked: '2026-10-11' },
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
