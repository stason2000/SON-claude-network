import { cliConnector } from './cliConnector';

/** xAI Grok Build CLI — wraps the 'grok' preset. */
export default cliConnector('grok', {
  strengths: ['coding', 'research'],
  docsUrl: 'https://docs.x.ai/build/cli/reference',
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
