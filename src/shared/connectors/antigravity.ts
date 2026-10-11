import { cliConnector } from './cliConnector';

/** Google Antigravity CLI (agy) — wraps the 'antigravity' preset. */
export default cliConnector('antigravity', {
  strengths: ['coding', 'general'],
  docsUrl: 'https://antigravity.google/docs/cli/reference',
  // Login: Launching `agy` with no saved session opens the browser sign-in (Installation and auth docs).
  login: { mode: 'first-run', bins: ['agy'], args: [], sourceUrl: 'https://antigravity.google/docs/cli/install', checked: '2026-10-11' },
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
