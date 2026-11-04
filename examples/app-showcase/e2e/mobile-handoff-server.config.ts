import showcase from '../objectstack.config.js';

/**
 * What `playwright.config.ts` boots: the showcase, with one app scheme registered
 * so `mobile-signin-handoff.spec.ts` has somewhere to hand a token.
 *
 * A deployment registers its app schemes in `AuthConfig.trustedAppSchemes`, and
 * `os serve` composes its `AuthPlugin` with no way to set that key from outside
 * yet, so this plugin patches the running manager: the same config the route and
 * the `one-time-token` plugin read, which is rebuilt on the next request. Once
 * `os serve` reads the list from its environment (`OS_TRUSTED_APP_SCHEMES`), this
 * file goes and `playwright.config.ts` sets that variable on its `webServer`.
 *
 * Mirrors `HANDOFF_APP_SCHEME` in the spec, which imports nothing from here because
 * this module pulls in the whole stack.
 */
const HANDOFF_APP_SCHEME = 'com.example.showcase.e2e';

const RegisterHandoffAppScheme = {
  name: 'com.example.showcase.e2e.handoff-app-scheme',
  version: '1.0.0',
  init: async (ctx: any) => {
    ctx.hook('kernel:ready', async () => {
      ctx.getService('auth').applyConfigPatch({ trustedAppSchemes: [HANDOFF_APP_SCHEME] });
    });
  },
};

export default {
  ...showcase,
  plugins: [...((showcase as { plugins?: unknown[] }).plugins ?? []), RegisterHandoffAppScheme],
};
