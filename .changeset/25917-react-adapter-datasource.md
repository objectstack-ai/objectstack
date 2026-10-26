---
'@object-ui/react': patch
'@object-ui/core': patch
'@object-ui/data-objectstack': patch
'@object-ui/app-shell': patch
'@object-ui/plugin-designer': patch
---

refactor(react): `AdapterCtx` / `useAdapter` are typed by `DataSource`, and `@object-ui/react` no longer depends on `@object-ui/data-objectstack`

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) PROBE -->

The runtime no longer depends on one adapter, so a bring-your-own backend installs `@object-ui/react` without the ObjectStack adapter, and learns at the type level which `DataSource` members it lacks.

- **`@object-ui/react`**: `AdapterCtx` and `useAdapter()` are typed by the protocol-level `DataSource` from `@object-ui/types`, not by `ObjectStackAdapter`. A new exported extension point, `AdapterContextRegister`, lets a host declare the concrete adapter its provider installs; `useAdapter()` then returns that adapter and an `AdapterCtx.Provider` value is checked against it. `ContextAdapter` names the resolved type. `@object-ui/data-objectstack` moves from `dependencies` to `devDependencies` (one boundary test still reads it).
- **`@object-ui/core`**: exports `API_ACCESS_DENIED_CODES` and `isApiAccessDeniedError`, the `enable`-block API denial predicate, moved here unchanged so `@object-ui/react` can classify the denial without the adapter.
- **`@object-ui/data-objectstack`**: re-exports both names from `@object-ui/core`; its published face is unchanged.
- **`@object-ui/app-shell`**: declares `ObjectStackAdapter` on `AdapterContextRegister`, and the declaration ships in its published types, so a host that mounts `AdapterProvider` keeps today's `useAdapter()` type.
- **`@object-ui/plugin-designer`**: declares the same adapter for its own pages, which read the ObjectStack client.

**BREAKING** (a type narrowing) for a TypeScript reader of `useAdapter()` / `AdapterCtx` from `@object-ui/react` that reads an `ObjectStackAdapter` member `DataSource` does not declare (`getClient`, `probeAppAccess`, `probeMetaItemAccess`, `getConnectionState`, `onConnectionStateChange`, `clearCache`, `queryDataset`, …) and does not import `@object-ui/app-shell`. Runtime behaviour is unchanged: the context holds the same adapter object as before.

- **Before.** `useAdapter()` returned `ObjectStackAdapter | null` whatever the host installed.
- **Now.** It returns `DataSource | null` unless the host declares its adapter, and reading `getClient` off it is `error TS2339`.
- **Fix.** Either declare the adapter your provider installs, once, in your own package:

  ```ts
  import type { ObjectStackAdapter } from '@object-ui/data-objectstack';

  declare module '@object-ui/react' {
    interface AdapterContextRegister {
      adapter: ObjectStackAdapter;
    }
  }
  ```

  or narrow at the call site that needs the ObjectStack-only member, and keep reading `DataSource` members everywhere else.
