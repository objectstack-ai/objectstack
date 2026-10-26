// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `@object-ui/plugin-chatbot` SDUI node types, registered LAZILY
 * (objectui#13410).
 *
 * Until objectui#13410 the console never registered these itself. They were
 * registered as a side effect: `@object-ui/app-shell` imported helpers from the
 * plugin's package root, the root re-exports `./renderer`, and evaluating that
 * module runs the three `ComponentRegistry.register` calls. That same import is
 * what put the whole chat UI in every first page load, so app-shell now takes
 * its helpers from the side-effect-free `@object-ui/plugin-chatbot/core`, and
 * nothing in the eager graph evaluates the renderer any more. These stubs keep
 * the three types resolvable: the first node of one that renders loads the
 * plugin, whose top-level registrations then replace the stub.
 *
 * ⛔ Deliberately NOT in `./register-plugins`. That module is also the
 * registration graph `dev/manifest-registry.ts` turns into the shipped
 * `dist/sdui.manifest.json`, and the host's metadata save door judges page
 * sources against that file. These three types were never in it; listing them
 * there would make the save door start accepting them, which is a product
 * decision this bundle-size change does not make.
 */

import { ComponentRegistry } from '@object-ui/core';

ComponentRegistry.registerLazy('chatbot', () => import('@object-ui/plugin-chatbot'), {
  namespace: 'plugin-chatbot',
});
ComponentRegistry.registerLazy('chatbot-enhanced', () => import('@object-ui/plugin-chatbot'), {
  namespace: 'plugin-chatbot',
});
ComponentRegistry.registerLazy('chatbot-floating', () => import('@object-ui/plugin-chatbot'), {
  namespace: 'plugin-chatbot',
});
