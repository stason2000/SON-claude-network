import { cliConnector } from './cliConnector';

/** GitHub Copilot CLI — wraps the 'copilot' preset. */
export default cliConnector('copilot', {
  strengths: ['coding', 'review'],
  docsUrl: 'https://docs.github.com/copilot/concepts/agents/about-copilot-cli',
  // Login: `copilot login` ("Authenticate with copilot login").
  login: { mode: 'command', bins: ['copilot'], args: ['login'], sourceUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli', checked: '2026-10-11' },
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
