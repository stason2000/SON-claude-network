import { cliConnector } from './cliConnector';

/** Charm Crush — wraps the 'crush' preset. */
export default cliConnector('crush', {
  strengths: ['coding'],
  docsUrl: 'https://charm.land/crush',
  // Login: Getting Started: pick a model in the picker and follow the steps to authenticate (official README).
  login: { mode: 'first-run', bins: ['crush'], args: [], sourceUrl: 'https://github.com/charmbracelet/crush', checked: '2026-10-11' },
  verified: true,
  verifiedNote: 'Official docs page read 2026-10-10; spawn flags come from the existing agentProvider preset (not re-verified here).'
});
