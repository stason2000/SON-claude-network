import { cliConnector } from './cliConnector';

/** GitHub Copilot CLI — wraps the 'copilot' preset. */
export default cliConnector('copilot', {
  strengths: ['coding', 'review'],
  docsUrl: 'https://docs.github.com/copilot/concepts/agents/about-copilot-cli',
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
