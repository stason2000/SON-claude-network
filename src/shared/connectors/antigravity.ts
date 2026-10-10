import { cliConnector } from './cliConnector';

/** Google Antigravity CLI (agy) — wraps the 'antigravity' preset. */
export default cliConnector('antigravity', {
  strengths: ['coding', 'general'],
  docsUrl: 'https://antigravity.google/docs/cli/reference',
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
