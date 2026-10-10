import { cliConnector } from './cliConnector';

/** Claude Code (Anthropic) — wraps the 'claude' preset. */
export default cliConnector('claude', {
  strengths: ['coding', 'review', 'writing', 'general'],
  docsUrl: 'https://code.claude.com/docs/en/overview',
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
