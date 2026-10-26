/**
 * The designer's declaration of the adapter its host installs into
 * `AdapterCtx`.
 *
 * `@object-ui/react` types `AdapterCtx` / `useAdapter` by the protocol-level
 * `DataSource`, so the runtime does not depend on any one adapter
 * (objectstack#25917). The designer's app pages read the ObjectStack client
 * (`getClient`), a member beyond `DataSource`, and run inside the ObjectStack
 * Console, whose shell installs an `ObjectStackAdapter`; so the designer
 * declares that adapter here, in the package that already depends on it.
 *
 * Imported by each page that reads such a member, so every program that
 * compiles the page (the build and the test type-check) sees the declaration.
 */

import type { ObjectStackAdapter } from '@object-ui/data-objectstack';

declare module '@object-ui/react' {
  interface AdapterContextRegister {
    adapter: ObjectStackAdapter;
  }
}

export {};
