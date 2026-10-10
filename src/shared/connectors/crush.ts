import { cliConnector } from './cliConnector';

/** Charm Crush — wraps the 'crush' preset. */
export default cliConnector('crush', {
  strengths: ['coding'],
  docsUrl: 'https://charm.land/crush',
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
