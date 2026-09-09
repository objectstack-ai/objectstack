// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * **The pin for `@objectstack/cli`'s own `better-sqlite3` declaration**, and
 * for its agreement with the scaffold widening that exists because of it
 * (#16813).
 *
 * ## The report this is about
 *
 * A consumer that installs `@objectstack/cli` sees, whenever pnpm actually
 * runs the resolution step:
 *
 *     └─┬ @objectstack/cli 17.3.0
 *       └─┬ @objectstack/runtime 17.4.0
 *         └─┬ @objectstack/plugin-auth 17.4.0
 *           └─┬ better-auth 1.7.2
 *             └── ✕ unmet peer better-sqlite3@^12.0.0: found 13.0.3
 *
 * ⚠️ It is easy to conclude that this file's job is to stop, and that the fix
 * is to move the declaration below back inside `^12`. It is not, and the
 * measurement that says so is recorded here so the next reader does not have
 * to re-take it:
 *
 *  1. **The peer is optional and governs a configuration we never use.**
 *     better-auth's `better-sqlite3` peer is
 *     `peerDependenciesMeta.better-sqlite3.optional === true`, and it covers
 *     one thing: a raw better-sqlite3 `Database` handed to better-auth's
 *     `database` option. `AuthManager.createDatabaseConfig()` returns an
 *     ObjectQL adapter factory, or `undefined` for better-auth's in-memory
 *     adapter — never a `Database`.
 *  2. **better-auth cannot be incompatible with better-sqlite3 13, because it
 *     never touches it.** Of the 464 files in the published
 *     `better-auth@1.7.2` tarball, exactly one names better-sqlite3 —
 *     `package.json`, i.e. the peer declaration itself. Zero code files
 *     reference it (positive control: `kysely` names 9). It accepts a
 *     `Database` the caller constructs; its own sqlite test path uses node's
 *     built-in `node:sqlite`.
 *  3. **Pinning back to `^12` costs a second native module and buys nothing.**
 *     Measured on a bare project depending on `@objectstack/cli@17.3.0`:
 *     rewriting only this declaration to `^12.11.1` does clear the report, but
 *     the resolved tree then carries better-sqlite3 **12.11.1 and 13.0.3**,
 *     and the 12 copy is never loaded — this package loads better-sqlite3
 *     itself (`src/utils/sqlite-occupancy.ts`) and knex resolves 13.x through
 *     `@objectstack/driver-sql` either way. The scaffold's
 *     `allowedVersions` entry clears the same report with the resolution
 *     byte-identical (0 lines of lockfile diff).
 *
 * ⇒ 13 is the correct declaration and the upstream range is stale. What was
 * missing was not a different range but a gate holding the range to the
 * reasoning that justifies it, which is what this file is.
 *
 * ## Why the two assertions are one pin and not two
 *
 * `SCAFFOLD_ALLOWED_PEER_VERSIONS['better-auth>better-sqlite3']` widens
 * better-auth's peer to a **major**, and the only reason that major is right
 * is the declaration below. Held apart, either can move alone and stay green:
 * a declaration lifted to `^14` leaves the scaffold suppressing a report it no
 * longer matches (so the NEXT real skew arrives pre-silenced), and a
 * declaration dropped to `^12` leaves a suppression with no skew behind it —
 * the exact shape `init.test.ts` refuses for the retired
 * `@better-auth/scim>better-call` entry. So the major is read out of the
 * manifest and compared, rather than written down twice.
 *
 * `init.test.ts` pins the widening's literal value and its rendering; this
 * file pins what the widening is ABOUT. Neither restates the other.
 *
 * The manifest read stays inside this package (`test/` → package root), so it
 * is not a `check:cross-package-test-inputs` escape and needs no declaration.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// `.js`, not extensionless: this package is `moduleResolution: NodeNext`.
import { SCAFFOLD_ALLOWED_PEER_VERSIONS } from '../src/commands/init.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

// One line on purpose — `check:cross-package-test-inputs` reconstructs reads by
// source scan, and a split `resolve(HERE, …)` is a spelling it does not know.
const MANIFEST = resolve(HERE, '../package.json');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
  optionalDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
};

const WIDENING_KEY = 'better-auth>better-sqlite3';

/** The single major a caret/tilde range admits, or null if it admits more. */
function soleMajor(range: string): string | null {
  const m = /^[\^~]?(\d+)\.\d+\.\d+$/.exec(range.trim());
  return m ? m[1] : null;
}

describe('@objectstack/cli better-sqlite3 declaration (#16813)', () => {
  it('declares better-sqlite3 as an OPTIONAL dependency, not a hard one', () => {
    // Optional is load-bearing: `objectstack serve` must start on a host where
    // the native build failed, falling back to the wasm driver. A hard
    // dependency turns that degraded start into a failed install.
    expect(manifest.optionalDependencies?.['better-sqlite3']).toBeTypeOf('string');
    expect(manifest.dependencies?.['better-sqlite3']).toBeUndefined();
  });

  it('keeps the declaration on one major, so the scaffold can widen to it', () => {
    const declared = manifest.optionalDependencies?.['better-sqlite3'] ?? '';
    expect(
      soleMajor(declared),
      `better-sqlite3 is declared "${declared}"; this pin needs a range admitting exactly one major`,
    ).not.toBeNull();
  });

  it('widens better-auth\'s peer to the major this package actually declares', () => {
    // ⛔ Not "to 13" — that is `init.test.ts`'s assertion. This one says the
    // widening and the declaration are the SAME major, so neither can move
    // without the other.
    const declared = manifest.optionalDependencies?.['better-sqlite3'] ?? '';
    expect(SCAFFOLD_ALLOWED_PEER_VERSIONS[WIDENING_KEY]).toBe(soleMajor(declared));
  });

  it('refuses a retreat to better-sqlite3 12 (the report is not the defect)', () => {
    // The failure this guards is a well-meant one: reading the unmet-peer
    // report as a defect and "fixing" it here. Measured, that clears the line
    // only by installing a second native better-sqlite3 that nothing loads —
    // see this file's header for the three readings. If better-auth ever
    // WIDENS its peer upstream, the right change is to retire the scaffold
    // entry, not to move this declaration.
    const declared = manifest.optionalDependencies?.['better-sqlite3'] ?? '';
    expect(soleMajor(declared)).not.toBe('12');
  });
});
