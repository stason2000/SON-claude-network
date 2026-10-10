import { cliConnector } from './cliConnector';

/** OpenAI Codex CLI — wraps the 'codex' preset. */
export default cliConnector('codex', {
  strengths: ['coding', 'review'],
  docsUrl: 'https://learn.chatgpt.com/docs/codex/cli',
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
