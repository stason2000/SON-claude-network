import { cliConnector } from './cliConnector';

/** Qwen Code CLI — wraps the 'qwen' preset. */
export default cliConnector('qwen', {
  strengths: ['coding'],
  docsUrl: 'https://qwenlm.github.io/qwen-code-docs/',
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
