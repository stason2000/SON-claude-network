import { cliConnector } from './cliConnector';

/** Cursor Agent CLI — wraps the 'cursor' preset. */
export default cliConnector('cursor', {
  strengths: ['coding'],
  docsUrl: 'https://cursor.com/docs/cli/overview',
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
