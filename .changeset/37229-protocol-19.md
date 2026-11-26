---
"@objectstack/spec": minor
"@objectstack/mcp": patch
---

The runtime protocol moves to 19: `PROTOCOL_VERSION` reads `'19.0.0'`, so a runtime built from this release refuses a manifest that declares `engines.protocol: '^18'`.

Clause-②: yes (narrowing)
Metadata-protocol: narrowed

**BREAKING for app and package authors on the v19 prerelease line.** The load-time handshake (ADR-0087 D1) compares the major of a manifest's `engines.protocol` range with `PROTOCOL_VERSION`. At protocol 19 a range that admits only 18 is refused before any metadata loads, with the diagnostic `OS_PROTOCOL_INCOMPATIBLE` naming the declared range and the runtime's protocol.

- **What you change.** In each manifest you author (`objectstack.config.ts`, and every package manifest in a multi-package app), move `engines: { protocol: '^18' }` to `engines: { protocol: '^19' }`. `os migrate meta --from 18 --write` rewrites the range for you in a root `defineStack` manifest, at the key the handshake reads. A manifest `composeStacks` composes from several packages has no one literal to rewrite, so there the command writes nothing and lists the range for you to change by hand in each package manifest. The upgrade guide's protocol 19 step carries the same prescription (`protocol-18-range-refused`).
- **Who is affected.** Only a project that installs a `19.0.0-next.N` prerelease. The npm dist-tag `latest` stays on 18.x until 19.0 GA, and an 18.x runtime keeps admitting `'^18'` and refuses `'^19'`, so move the range together with the `@objectstack/*` versions, not before them.
- **What moved in this repository.** Every example app, `examples/app-multi-package`'s two packages, the three connector apps under `packages/apps/`, the docs snippets and the two examples in `@objectstack/mcp`'s README now declare `'^19'`. The `create-objectstack` blank template keeps the scaffolder's own major until the version pass stamps it `'^19'` together with its `@objectstack/*` versions.

<!-- adr-0087: registered protocol-18-range-refused -->
