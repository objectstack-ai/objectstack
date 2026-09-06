// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/cli/console` — the public entry for mounting the Console SPA.
 *
 * ## Why this entry exists (#16046)
 *
 * Until this file landed, `./console` pointed its subpath straight at
 * `dist/utils/console.js` — an INTERNAL module with 13 top-level exports and no
 * surface pin of any kind, neither names nor shapes. Two assertions did exist
 * (re-measured at `0ea5f9d9f79`): `./console` is among the declared `exports`
 * KEYS, and the specifier RESOLVES from the packed tarball. Both answer *is the
 * door open*; neither can answer *what is behind it*. So
 * every export that module gained was published the moment it landed: an
 * accidental `export *` widening, or a symbol added for an internal reason,
 * became public API silently, with nothing that would notice.
 *
 * That is a strictly weaker position than the one #15630 repaired on
 * `./hook-body`, where a pin at least held the ratified names. This file is the
 * same remedy applied one door over: the subpath stays — cloud's
 * `objectos-runtime` node server depends on it, and sealing it would be #13662
 * and #15325 a third time — but it now points at a barrel that re-exports the
 * intended public face BY NAME, no star.
 *
 * `test/published-subpath-console.pin.test.ts` holds the packed `.d.ts` to
 * exactly these names AND their shapes, so a widening is a deliberate,
 * reviewed, `minor`-bumped act rather than a side effect of a refactor.
 *
 * ⛔ Do not add to this list to make something convenient reachable. A new name
 * here is a new public contract on a published package.
 *
 * ## What the public face is, and why it is these three
 *
 * The one ledgered out-of-repo consumer
 * (`packages/qa/downstream-contract/consumer-specifiers.ledger.json`) mounts the
 * Console SPA through exactly `resolveConsolePath` / `hasConsoleDist` /
 * `createConsoleStaticPlugin`. Those three are the face.
 *
 * ### The two the ruling left to a measurement, and how it came out
 *
 * The #16046 ruling admitted `decideConsoleMount` and `createRuntimeAssetsPlugin`
 * "only if the implementer finds an intended external caller", stating that
 * `commands/serve.ts`'s own use does not count because it is in-package. Both
 * are EXCLUDED, on four readings taken at `0ea5f9d9f79`:
 *
 *   1. Every reference to either name in this repo is inside `packages/cli/`
 *      — `commands/serve.ts`, `utils/console.ts` itself, and two of this
 *      package's own tests — plus one historical `CHANGELOG.md` line. No
 *      caller outside the package exists to be intended.
 *   2. The consumer-specifier ledger — this repo's owned, shrink-only record of
 *      what out-of-repo consumers import, and the only place such a claim is
 *      written down at all — names three functions for this specifier and
 *      neither of these two.
 *   3. `decideConsoleMount`'s own docblock scopes it to `isDev` only and says
 *      "Published installs carry no pin, so no production or cloud deployment
 *      can reach the refusal." The sole ledgered consumer IS a cloud
 *      deployment, so the source says the external caller cannot reach the
 *      behaviour this function exists to produce.
 *   4. GitHub code search over `org:objectstack-ai` (2026-09-06) returns, for
 *      `@objectstack/cli/console` and for the two names themselves, hits in
 *      THIS repository only — zero in `objectui`. That zero counts only
 *      because it carries a control: `repo:objectstack-ai/objectui console`
 *      answers 1,640 hits from the same index in the same session, so objectui
 *      is genuinely indexed and its zero is a measurement rather than a silence.
 *
 * ⚠️ `cloud` is NOT MEASURED, which is a different thing from zero. The same
 * control run against it — `repo:objectstack-ai/cloud objectstack` — answers 0
 * hits with `incomplete_results: true`: the index does not cover that
 * repository from this seat, and no checkout of it is reachable either. An
 * unreachable repository never reads as "no consumers". So for `cloud` the
 * evidence is second-hand BY CONSTRUCTION — the consumer-specifier ledger,
 * which names exactly the three, and the #16046 ruling that reads it the same
 * way. If a consumer of either name ever surfaces, the remedy is
 * the one #13123's body prescribes and #13662 applied: re-open the name here
 * deliberately, with a changeset, and ledger the consumer. ⛔ Not a deep
 * `dist/` import, and not a local reimplementation.
 *
 * ## What retiring the other names does and does not do
 *
 * Nothing is deleted: `utils/console.ts` keeps all 13 exports and every
 * in-package caller keeps importing it directly. What changes is only which of
 * them a PUBLISHED specifier can name.
 *
 * One consequence is worth stating because it is invisible from the export list.
 * `ResolveConsoleOptions` is retired, but it is still `resolveConsolePath`'s
 * parameter type, so a consumer keeps passing the same options object — the
 * shape stays reachable STRUCTURALLY through the signature — and loses only the
 * ability to NAME the type through this subpath. The pin asserts both halves, so
 * neither can drift silently.
 */

export { resolveConsolePath, hasConsoleDist, createConsoleStaticPlugin } from './utils/console.js';
