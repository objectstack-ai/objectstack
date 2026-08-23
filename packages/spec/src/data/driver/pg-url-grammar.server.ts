// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The pg-grammar arm of the postgres `url` refinement — the ONLY module in
 * this package that may import `pg-connection-string` (#11072).
 *
 * ## Why this lives in its own module
 *
 * `pg-connection-string@2.14.0` is Node-only by construction: its `parse`
 * reaches `require('fs')` (runtime-guarded, bundler-static), it declares no
 * `browser` field and no `browser` export condition, so ANY browser bundler
 * that reaches it must resolve `fs` and fails (measured on objectui's docs
 * site — Next.js/Turbopack, `Module not found: Can't resolve 'fs'`).
 *
 * The maintainer's 2026-08-22 ruling on #11072 (Option A) declares the
 * boundary at this producer: the affected entries gain a `browser` export
 * condition pointing at a build with the driver-config validators excluded —
 * the postgres URL refinement degrades to the shape-only checks it already
 * performs before `parse`. This module is the seam that makes the exclusion
 * buildable: the browser tsup pass (`tsup.config.ts`,
 * `swapServerOnlyGrammarArm`) resolves every import of `./pg-url-grammar.server`
 * to `./pg-url-grammar.browser` instead, and
 * `check:browser-reachable-entries` proves the swap happened by scanning the
 * emitted browser bundles for `pg-connection-string` and Node builtins.
 *
 * Node-side behaviour is unchanged: the checks below are the exact #9091
 * checks `postgres.zod.ts` ran inline before #11072, in the same order, with
 * the same messages (the existing pins in `postgres.test.ts` hold them).
 *
 * ⛔ Do NOT import `pg-connection-string` anywhere else in `src/` — a second
 * import site lands in the browser bundles (the swap is keyed to THIS module
 * specifier, on purpose: a silent blanket alias would degrade future call
 * sites nobody audited) and `check:browser-reachable-entries` goes red.
 */

import { parse as parsePostgresUrl } from 'pg-connection-string';

/**
 * Refusal prescription for a `url` that `pg` itself cannot parse (#9091).
 *
 * The gap this closes: `postgres.zod.ts`'s describe text documents a grammar
 * (`postgresql://[user@][host][:port][/dbname][?params]`) that nothing
 * enforced. The shared `credentialFreeUrl` / `placeholderFree` checks are
 * string-boundary scans by design — their refusal to parse is load-bearing
 * for mongo's multi-host and `+srv` forms (#8696), so the parse question is
 * asked HERE, per-driver, of the postgres client's own grammar: `parse` from
 * `pg-connection-string@2.14.0`, the parser `pg@8.22.0` itself runs a
 * connection string through (`ConnectionParameters`). What that parser
 * throws on (measured: libpq's multi-host `h1:5432,h2:5433` form —
 * `ERR_INVALID_URL`; a non-numeric port; a malformed percent-escape) used to
 * parse green at publish and then fail at connect with a bare `Invalid URL`
 * whose own `input` field `pg` redacts — an error naming neither the value
 * nor the datasource. Same posture as #8873's runtime arm: ask `pg`'s
 * grammar, never re-model it.
 */
const PG_UNPARSEABLE_URL_REFUSED = (key: string, detail: string): string =>
  `this \`${key}\` is not a connection URL \`pg\` can open — \`pg-connection-string\` (the `
  + `parser \`pg\` itself uses) refuses it: ${detail}. The datasource would publish green and `
  + 'then fail at connect time with an error that names neither the value nor the datasource. '
  + 'Expected format: `postgresql://[user@][host][:port][/dbname][?params]`. Note that `pg` '
  + "does not implement libpq's multi-host form (`host1:port1,host2:port2`) — a multi-host "
  + 'DSN fails exactly this way; point the URL at a single host (or a proxy in front of the '
  + 'cluster) instead. Runtime-environment DSNs (`OS_DATABASE_URL` and friends) do not pass '
  + 'through this publish door and are unaffected.';

/**
 * Refusal for a value `pg` "parses" only by resolving it against its
 * placeholder base URL (#9091 — the structurally-unusable half).
 *
 * `pg-connection-string` parses via `new URL(str, 'postgres://base')`, so a
 * value that is not an absolute URL at all (`not a url`, a libpq
 * keyword/value string like `host=x dbname=y`) does not throw — it resolves
 * RELATIVE to the base, and the client then connects to the literal host
 * `base` with the whole authored value as the database name. That is a
 * "successful" parse of a configuration the author never wrote, so it is
 * refused as unusable rather than accepted as what `pg` happens to do.
 */
const PG_RELATIVE_URL_REFUSED = (key: string): string =>
  `this \`${key}\` is not a URL: it has no scheme, so \`pg\` would parse it only by resolving `
  + 'it against an internal placeholder base and then connect to the literal host `base` — a '
  + 'host that was never named — with the authored text as the database name. Write a real '
  + 'connection URL: `postgresql://[user@][host][:port][/dbname][?params]` (a unix-socket '
  + 'path starting with `/` is also accepted). Runtime-environment DSNs (`OS_DATABASE_URL` '
  + 'and friends) do not pass through this publish door and are unaffected.';

/** Can WHATWG `URL` parse this string as an ABSOLUTE URL (no base)? */
function isAbsoluteUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Did `parse` succeed only by resolving the value against its placeholder
 * base? Mirrors the parser's own preprocessing (space/percent re-encoding,
 * then the `@/` → `@___DUMMY___/` empty-host retry — the retry form,
 * `postgresql://user@/db`, is libpq's real empty-host-with-userinfo spelling
 * and stays accepted) so the two cannot disagree about which branch ran.
 */
function pgParsedRelativeToBase(value: string): boolean {
  const str = / |%[^a-f0-9]|%[a-f0-9][^a-f0-9]/i.test(value)
    ? encodeURI(value).replace(/%25(\d\d)/g, '%$1')
    : value;
  return !isAbsoluteUrl(str) && !isAbsoluteUrl(str.replace('@/', '@___DUMMY___/'));
}

/**
 * The #9091 pg-grammar findings for one authored `url` value: at most one
 * refusal message, `[]` when `pg`'s own parser genuinely opens the value.
 *
 * Called by `postgres.zod.ts` AFTER its shape-only pre-parse checks (the
 * unix-socket short-circuit and the fs-reading `?sslcert=`/`?sslkey=`/
 * `?sslrootcert=` refusal), so `parse` is never handed a value that would
 * make it read the validating machine's filesystem.
 *
 * The browser twin (`pg-url-grammar.browser.ts`) answers `[]` for every
 * value: publish-time validation never legitimately runs in a browser, so
 * the grammar arm is dead weight there by construction (#11072).
 */
export function pgUrlGrammarFindings(value: string, key: string): string[] {
  try {
    parsePostgresUrl(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return [PG_UNPARSEABLE_URL_REFUSED(key, detail)];
  }
  if (pgParsedRelativeToBase(value)) {
    return [PG_RELATIVE_URL_REFUSED(key)];
  }
  return [];
}
