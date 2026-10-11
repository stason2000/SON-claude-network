import { cliConnector } from './cliConnector';

/** Qwen Code CLI — wraps the 'qwen' preset. */
export default cliConnector('qwen', {
  strengths: ['coding'],
  docsUrl: 'https://qwenlm.github.io/qwen-code-docs/',
  // Login: The `qwen auth` command was removed; run `qwen` and use `/auth` (authentication docs).
  login: { mode: 'first-run', bins: ['qwen'], args: [], inside: '/auth', sourceUrl: 'https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/', checked: '2026-10-11' },
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
