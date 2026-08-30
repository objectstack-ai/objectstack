// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13147] CENSUS PIN — who is still allowed to read `OS_PLATFORM_OWNER_EMAIL`
 * as a RAW string, and why exactly those.
 *
 * ## The defect this pin exists to make unrepeatable
 *
 * #11663 Choice 2B widened the variable's GRAMMAR: one address, or a
 * comma-separated list of them. The list parse landed in ONE place
 * (`@objectstack/core`'s `platform-admin.ts`) and the authorization derivation
 * consumed it — but every OTHER reader kept calling
 * `resolvePlatformOwnerEmail()` from `@objectstack/types`, which returns the
 * operator's value trimmed and otherwise verbatim, and kept treating that
 * string as ONE address. Six readers, and under a comma list four of them
 * silently did nothing: nobody was promoted, nobody was stamped, nobody
 * crossed the Layer 0 organization wall, and the boot diagnostic printed the
 * whole raw list where an address belongs. Every direction fail-closed, every
 * direction silent.
 *
 * The repair was to have all six ask the ONE parser. ⛔ The thing that would
 * undo it is not a bug in any of the six — it is a SEVENTH reader, written
 * later by someone who reaches for the resolver that is still (correctly)
 * exported and compares its result to an address. That is a two-line change
 * that no test of the six can see, and it fails silently in production the
 * same way the first six did.
 *
 * So this pin watches the POPULATION, not the behaviour: it enumerates every
 * raw read of the variable across both plugin packages and asserts the set is
 * exactly the sites where reading it raw is CORRECT.
 *
 * ## Why the two survivors are correct, and are not exceptions
 *
 * Both are in `auth-plugin.ts` and both use the resolver's result in a BOOLEAN
 * position only — they ask "did the operator declare anything at all?", never
 * "is this string an address?". That question is grammar-independent: it has
 * the same answer for one address and for a list of five, so widening the
 * grammar cannot change it. Nothing else in either package may read it raw.
 *
 * ⚠️ LIMIT, stated so it is not mistaken for more: this pin reads text. It
 * proves no NEW raw reader appeared; it cannot prove that a reader which asks
 * the parser then uses the answer correctly. That is what the per-reader
 * comma-list pins next door are for.
 *
 * ## How to make this pin green when it fires
 *
 * ⛔ Not by adding your file to the allow-list. A new reader that needs the
 * VALUE wants `resolvePlatformAdminEmails()` and
 * `isConfiguredPlatformAdminEmail()` from `@objectstack/core` — the same parser
 * every other reader asks. The allow-list grows only for another
 * grammar-independent truthiness check, and the entry has to say why.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * Seeded from `__dirname`, ⛔ not from `dirname(fileURLToPath(import.meta.url))`
 * — the spelling this file was first written with, and the spelling that cost a
 * CI round.
 *
 * This package is CJS-typed (no `"type": "module"`; it publishes
 * `dist/index.js` as CommonJS), so under `module: NodeNext` `import.meta` is a
 * **TS1470** however well it runs under vitest. That is normally invisible from
 * inside the package — its own `typecheck` script excludes `**\/*.test.ts` — but
 * this test layer IS in front of tsc, through the `@objectstack/plugin-auth`
 * `TEST_DEBT` entry in `check-type-check-coverage.mjs` under `scripts/`, a
 * ledger that may only SHRINK. (⚠️ The name is split exactly as the two sibling
 * files that record this trap split it: `check:cross-package-test-inputs`
 * resolves path-shaped tokens against this file's `REPO_ROOT` anchor, so
 * spelling it as one repo-relative path — even in prose — declares an input
 * this package does not have, and the gate says so.) The `import.meta` spelling pushed it 94 -> 95 and turned the
 * job red. `plugin-security/src/seed-write-refusal.test.ts` records the same
 * ratchet moving 11 -> 12 for the identical reason, so this is the second time
 * the trap has been paid for and written down.
 *
 * `__dirname` type-checks under this package's own config, is defined at
 * runtime by vitest's transform, and is one of the spellings
 * `check:cross-package-test-inputs` resolves STATICALLY — which this file needs,
 * because its walk of the sibling `plugin-security` source tree is an escaping
 * read that gate is there to see.
 */
const HERE = __dirname;
/** …/packages/plugins/plugin-auth/src → repo root */
const REPO_ROOT = resolve(HERE, '../../../..');
const PLUGIN_SRC_TREES = [
  join(REPO_ROOT, 'packages', 'plugins', 'plugin-auth', 'src'),
  join(REPO_ROOT, 'packages', 'plugins', 'plugin-security', 'src'),
];

/** The raw single-value resolver — the one whose result is NOT list-aware. */
const RAW_READER = 'resolvePlatformOwnerEmail';

/**
 * The complete allow-list, keyed by repo-relative path. Each value is every
 * source LINE in that file that names the raw resolver, verbatim and trimmed,
 * so that moving a call into a new expression fails this pin rather than
 * sliding through on a file-level exemption.
 */
const ALLOWED: Record<string, string[]> = {
  'packages/plugins/plugin-auth/src/auth-plugin.ts': [
    // The import itself.
    "import { PLATFORM_OWNER_EMAIL_ENV, resolvePlatformOwnerEmail, resolveTenancyPosture } from '@objectstack/types';",
    // The walled-boot refusal: "a walled posture must declare an owner". Pure
    // truthiness — it never compares the value to anything, so a list refuses
    // boot exactly as a single address does.
    'if (postureEnforcesWall(requestedPosture) && !resolvePlatformOwnerEmail()) {',
    // The verification-path probe's guard: only probe the store when an owner
    // was declared at all. Truthiness again — the probe itself asks the parser.
    'resolvePlatformOwnerEmail()',
  ],
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    // Tests may name the resolver freely — they are not deployment readers.
    if (entry.includes('.test.')) continue;
    out.push(full);
  }
  return out;
}

/** repo-relative, POSIX-spelled, so the allow-list keys are platform-stable. */
const rel = (full: string) => relative(REPO_ROOT, full).split(sep).join('/');

describe('[#13147] OS_PLATFORM_OWNER_EMAIL raw-reader census', () => {
  const found: Record<string, string[]> = {};
  for (const tree of PLUGIN_SRC_TREES) {
    for (const file of sourceFiles(tree)) {
      const hits = readFileSync(file, 'utf8')
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.includes(RAW_READER))
        // JSDoc and comments discuss the resolver by name on purpose; a reader
        // is code. A `*`-led or `//`-led line is prose.
        .filter((l) => !l.startsWith('*') && !l.startsWith('//') && !l.startsWith('/*'));
      if (hits.length > 0) found[rel(file)] = hits;
    }
  }

  it('the CONTROL: this scan can see the resolver at all', () => {
    // A zero without a control is not a reading — an empty `found` would
    // otherwise pass this whole file whether the population is clean or the
    // walk is broken.
    expect(Object.keys(found).length).toBeGreaterThan(0);
    expect(PLUGIN_SRC_TREES.every((t) => sourceFiles(t).length > 20)).toBe(true);
  });

  it('every raw reader in plugin-auth / plugin-security is a pinned grammar-independent site', () => {
    expect(found).toEqual(ALLOWED);
  });

  it('every pinned site uses the value as a BOOLEAN, never as an address', () => {
    for (const [file, lines] of Object.entries(ALLOWED)) {
      for (const line of lines) {
        if (line.startsWith('import ')) continue;
        // No comparison operator and no string method anywhere on the line:
        // the moment a pinned site starts asking "is this string equal to /
        // lowercase of / included in …", it has stopped being grammar-
        // independent and belongs on the parser instead.
        expect(/[=!]==|\.toLowerCase\(|\.includes\(|\.split\(|\.trim\(/.test(line), `${file}: ${line}`).toBe(
          false,
        );
      }
    }
  });
});
