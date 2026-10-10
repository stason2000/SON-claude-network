import { cliConnector } from './cliConnector';

/** OpenCode — wraps the 'opencode' preset. */
export default cliConnector('opencode', {
  strengths: ['coding'],
  docsUrl: 'https://opencode.ai/docs',
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
