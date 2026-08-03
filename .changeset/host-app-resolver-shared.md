---
"@objectstack/types": minor
"@objectstack/verify": minor
"@objectstack/cli": patch
---

fix(verify): resolve the enterprise organizations package from the HOST APP (#4700)

`bootStack(app, { multiTenant: true })` — and therefore `objectstack verify
--multi-tenant` — could never load `@objectstack/organizations`. Node ESM
resolves a bare `import()` against the **importer's own realpath**, which for
`packages/verify` is inside the framework workspace, while the enterprise
package is cloud-private and only ever lives in the verified app's
`node_modules`. Every real host app fell into the catch and was told to
"Install/link it in this workspace" — about a package it had already installed.
Same defect class as cloud#1013, which fixed `objectstack serve`; #4699 fixed
that one call site and this issue tracked the two the sweep left behind.

**New: `@objectstack/types/node`.** The host-app resolver (`createHostRequire` /
`createHostImporter`) moved out of `packages/cli/src/utils/import-from-host.ts`
— where `@objectstack/verify` and the dogfood suite could not import it without
inverting the dependency direction — into a **node-only subpath export** of
`@objectstack/types`. One behaviour, one source; the CLI now consumes it and its
private copy is deleted.

It is a subpath and **not** the root export because `@objectstack/types` is a
dependency of `@objectstack/hono` ("edge-compatible REST API server for
Cloudflare Workers, Deno, Bun, and Node") and of the plugin layer a `LiteKernel`
boots on Workers. The root entry reaches zero `node:` builtins, and a Workers
bundle breaks on `node:module` even when nothing calls it. `tsup` emits the two
entries as separate self-contained bundles (`splitting: false`), and a test
walks the root's import graph and fails on the first reachable `node:`
specifier, so the isolation is enforced rather than merely intended. Same
arrangement `@objectstack/metadata` already ships for its `./node` subpath.

**New: `BootOptions.hostRoot`** (optional, defaults to `process.cwd()`) names
the app whose `node_modules` supplies those optional packages — for a harness
booting an app that is not the working directory.

**The dogfood multi-org gates had never run.** Two suites probed availability
with the same bare `import()` and so were **constant-false** — not "false
because absent" but false by construction, in every environment including the
cloud CI whose comment claimed it ran them. The #1994 cross-tenant RLS proof and
the attachments cross-tenant isolation block had therefore never executed while
the suite reported green (Prime Directive #10, test-suite edition). They now
resolve like the runtime does, and `OS_TEST_MULTI_ORG_ENABLED=1` declares that a
run is expected to ship the package — turning a silent skip into a loud failure,
so a run can no longer pass by quietly not running the gates it exists for.
