/**
 * The app shell's declaration of the adapter it installs into `AdapterCtx`.
 *
 * `@object-ui/react` types `AdapterCtx` / `useAdapter` by the protocol-level
 * `DataSource`, so the runtime does not depend on any one adapter
 * (objectstack#25917). This shell's `AdapterProvider` installs an
 * `ObjectStackAdapter`, and shell code reads its members beyond `DataSource`
 * (`getClient`, the access probes, the connection state), so the shell
 * declares that adapter here, in the package that already depends on it.
 *
 * Imported from this package's entry so the declaration rides its published
 * types: a host that mounts `AdapterProvider` reads the same adapter type.
 */

import type { ObjectStackAdapter } from '@object-ui/data-objectstack';

declare module '@object-ui/react' {
  interface AdapterContextRegister {
    adapter: ObjectStackAdapter;
  }
}

export {};
