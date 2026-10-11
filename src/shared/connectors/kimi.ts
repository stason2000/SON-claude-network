import { cliConnector } from './cliConnector';

/** Kimi Code CLI — wraps the 'kimi' preset. */
export default cliConnector('kimi', {
  strengths: ['coding'],
  docsUrl: 'https://moonshotai.github.io/kimi-cli/',
  // Login: Run Kimi CLI and send `/login` (official README).
  login: { mode: 'first-run', bins: ['kimi'], args: [], inside: '/login', sourceUrl: 'https://github.com/MoonshotAI/kimi-cli', checked: '2026-10-11' },
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
