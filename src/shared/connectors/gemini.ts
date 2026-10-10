import { cliConnector } from './cliConnector';

/** Google Gemini CLI — wraps the 'gemini' preset. */
export default cliConnector('gemini', {
  strengths: ['coding', 'research', 'general'],
  docsUrl: 'https://geminicli.com/docs/',
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
