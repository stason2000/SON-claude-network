import { cliConnector } from './cliConnector';

/** Pi coding agent — wraps the 'pi' preset. */
export default cliConnector('pi', {
  strengths: ['coding'],
  docsUrl: 'https://pi.dev/docs/latest',
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
