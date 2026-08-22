// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The browser twin of `pg-url-grammar.server.ts` (#11072).
 *
 * The browser tsup pass (`tsup.config.ts`, `swapServerOnlyGrammarArm`)
 * resolves every import of `./pg-url-grammar.server` to this module, so the
 * `browser`-conditioned bundles carry no `pg-connection-string` — the
 * dependency whose `parse` statically resolves `require('fs')` and breaks
 * every browser bundler that reaches it (measured on objectui's docs site).
 *
 * Per the maintainer's 2026-08-22 ruling on #11072 (Option A), the postgres
 * `url` refinement DEGRADES here to the shape-only checks it already
 * performs before `parse` — the unix-socket short-circuit and the fs-reading
 * query-parameter refusal, both of which live in `postgres.zod.ts` and run
 * in every build. The pg-grammar arm answers "no findings" because
 * publish-time validation never legitimately runs in a browser: a datasource
 * publish is a server-side act, and every byte of the grammar check in a
 * client bundle is dead weight by construction. Node consumers keep the full
 * DSN refusal — Option B (moving the refinement to a server-only entry) was
 * REJECTED because it would widen `./data`'s accept set for Node too.
 *
 * Keep this module dependency-free. `check:browser-reachable-entries` scans
 * the emitted browser bundles and refuses `pg-connection-string` and every
 * Node builtin, with a positive control on the Node-side bundles.
 */

/**
 * Browser build: no pg-grammar findings, for every value — see the module
 * doc. The signature is the contract shared with the node twin; the
 * parameters are deliberately unread.
 */
export function pgUrlGrammarFindings(_value: string, _key: string): string[] {
  return [];
}
