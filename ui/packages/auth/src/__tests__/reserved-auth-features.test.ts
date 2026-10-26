/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#2514 — `features.passkeys` and `features.magicLink` are **reserved**:
 * the server advertises them on `GET /api/v1/auth/config`, this package declares
 * them so the payload types cleanly, and nothing consumes them. A deployer who
 * turns one on gets no entry point on the login page, which is exactly the lie
 * the audit (framework#2874 P2②) found and the maintainer's 2026-08-03 ruling
 * chose to close by documentation rather than by building the UI.
 *
 * ## What this pin is for
 *
 * Documentation that a thing does not exist is only true for as long as the thing
 * does not exist, and nothing else in the repo notices when that changes. The
 * failure this guards is silent in **both** directions:
 *
 * - Someone builds a consumer and leaves the "reserved" wording in place. The docs
 *   then understate the product — a deployer reads "turning this on adds no entry
 *   point" about a flag that now adds one, and disables a working feature.
 * - Someone deletes or dilutes the reserved marking without building anything. The
 *   flag goes back to being advertised with no warning attached, which is the
 *   original defect restored.
 *
 * So the three artifacts are pinned as one unit: the **declaration**, its
 * **doc comment**, and the **README section**. Any of them moving alone reds.
 *
 * ## ⛔ Retirement checklist — when a consumer lands deliberately (objectui#4179)
 *
 * The reserved status is meant to end. When the passkey / magic-link login UI is
 * built, that PR deletes all of this together — the pin is not an obstacle to
 * clear, it is the checklist:
 *
 * 1. the RESERVED doc comments on `passkeys` / `magicLink` in `../types.ts`;
 * 2. the "Reserved flags" subsection of `packages/auth/README.md`;
 * 3. **this file**.
 *
 * Deleting only #3 to make the suite green is the one wrong move: it leaves the
 * docs asserting a falsehood with nothing left to catch it.
 *
 * ## Why the consumer sweep is a blunt string match
 *
 * It follows the `scripts/__tests__/ci-cd-pipeline-doc.test.ts` pattern (#4170):
 * read the real files, compare them, pin the inverse direction too. A type-aware
 * "is this identifier read anywhere" analysis would be more precise and much more
 * fragile, and it would still miss the reachable path that has no static reference
 * at all — `AppContent` hands the whole `features` object to `ExpressionProvider`,
 * so metadata can reach `${features.passkeys}` without any source file naming it.
 * The sweep therefore covers authored metadata (`.json`) as well as `.ts`/`.tsx`,
 * and matches the identifiers case-sensitively with word boundaries so that prose
 * about unrelated server-side "magic link" emails (the identity-import wizard's
 * hint text) does not count as a consumer.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = path.resolve(packageRoot, '..', '..');

const typesPath = path.join(packageRoot, 'src/types.ts');
const readmePath = path.join(packageRoot, 'README.md');

const typesSource = readFileSync(typesPath, 'utf8');
const readme = readFileSync(readmePath, 'utf8');

/** The two flags, and the login-surface entry point each one would gate if built. */
const RESERVED_FLAGS = ['passkeys', 'magicLink'] as const;

/** The follow-up card that ends the reserved status. Named in all three artifacts. */
const FEATURE_CARD = '4179';

/**
 * The declaration line for `flag` plus the block comment immediately above it
 * (empty string when there is none — only whitespace may separate the two, so a
 * comment attached to some other member cannot be mistaken for this one).
 */
function declarationOf(flag: string): { index: number; doc: string } | null {
  const match = new RegExp(`^[ \\t]*${flag}\\?: boolean;$`, 'm').exec(typesSource);
  if (!match) return null;

  const before = typesSource.slice(0, match.index);
  const close = before.lastIndexOf('*/');
  const open = before.lastIndexOf('/**');
  const attached = close !== -1 && open !== -1 && open < close && before.slice(close + 2).trim() === '';

  return { index: match.index, doc: attached ? before.slice(open, close + 2) : '' };
}

/**
 * A block comment as prose: leaders stripped and wrapping undone, so an assertion
 * about a sentence is not defeated by where the sentence happens to wrap.
 */
function asProse(doc: string): string {
  return doc
    .replace(/^\s*\/\*\*/, '')
    .replace(/\*\/\s*$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\* ?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

describe('reserved auth feature flags — declaration', () => {
  it.each(RESERVED_FLAGS)('`%s` is still declared on AuthPublicConfig.features', (flag) => {
    const declaration = declarationOf(flag);
    expect(declaration, `${flag} must still be declared in packages/auth/src/types.ts`).not.toBeNull();

    const interfaceStart = typesSource.indexOf('export interface AuthPublicConfig {');
    const featuresStart = typesSource.indexOf('features?: {', interfaceStart);
    expect(interfaceStart, 'AuthPublicConfig must still be declared').toBeGreaterThan(-1);
    expect(featuresStart, 'AuthPublicConfig.features must still be declared').toBeGreaterThan(-1);
    expect(
      declaration!.index,
      `${flag} must live inside AuthPublicConfig.features, not somewhere else in the file`,
    ).toBeGreaterThan(featuresStart);
  });

  it.each(RESERVED_FLAGS)('`%s` carries a doc comment marking it RESERVED', (flag) => {
    const doc = asProse(declarationOf(flag)!.doc);
    expect(
      doc,
      `${flag} must carry a doc comment immediately above it saying RESERVED — see this file's retirement checklist`,
    ).toMatch(/RESERVED/);
  });

  it.each(RESERVED_FLAGS)('the doc comment on `%s` says enabling it adds no UI', (flag) => {
    const doc = asProse(declarationOf(flag)!.doc);
    // The operative promise to a deployer: the flag changes nothing they can see.
    expect(doc, `the doc comment on ${flag} must state that enabling it adds **no** entry point`).toMatch(
      /adds \*\*no\*\* .*entry point/,
    );
  });

  it.each(RESERVED_FLAGS)('the doc comment on `%s` points at the follow-up card', (flag) => {
    const doc = asProse(declarationOf(flag)!.doc);
    expect(doc, `the doc comment on ${flag} must reference objectui#${FEATURE_CARD}`).toContain(
      `objectui#${FEATURE_CARD}`,
    );
  });
});

describe('reserved auth feature flags — README', () => {
  /**
   * The reserved subsection only, so a stray match elsewhere on the page cannot
   * satisfy these assertions.
   *
   * Resolved per-test rather than once at collection time on purpose: an
   * `expect` in a `describe` body aborts the whole FILE, so deleting the section
   * would have taken the declaration and consumer-sweep suites down with it and
   * reported "no tests" instead of naming what broke.
   */
  function reservedSection(): string {
    const start = readme.indexOf('### Reserved flags');
    expect(start, 'packages/auth/README.md must keep a "### Reserved flags" subsection').toBeGreaterThan(-1);
    const rest = readme.slice(start);
    const next = rest.indexOf('\n## ');
    return next === -1 ? rest : rest.slice(0, next);
  }

  it.each(RESERVED_FLAGS)('documents `features.%s` as Reserved', (flag) => {
    const row = reservedSection()
      .split('\n')
      .find((line) => line.startsWith('|') && line.includes(`features.${flag}`));
    expect(row, `the README's reserved table must have a row for features.${flag}`).toBeDefined();
    expect(row, `the features.${flag} row must be marked **Reserved**`).toContain('**Reserved**');
  });

  it('states plainly that enabling either flag adds no login entry point', () => {
    expect(reservedSection()).toMatch(/adds no entry point to the login\s+page/);
  });

  it('links the follow-up card that retires the reserved status', () => {
    expect(reservedSection()).toContain(`objectstack-ai/objectui/issues/${FEATURE_CARD}`);
  });

  it('does not claim `twoFactor` is reserved — its non-consumption is by design', () => {
    // objectui#2514 is explicit that twoFactor is a different case: the capability
    // IS implemented here, the challenge is server-remediation driven (framework
    // ADR-0069), so LoginForm not reading the flag is deliberate, not a gap.
    const row = reservedSection()
      .split('\n')
      .find((line) => line.startsWith('|') && line.includes('features.twoFactor'));
    expect(row, 'twoFactor must not appear in the reserved table').toBeUndefined();
  });
});

/**
 * The inverse pin. Everything above documents an absence; this is what proves the
 * absence is real, and it is the assertion that fires when someone builds the UI.
 */
describe('reserved auth feature flags — nothing consumes them', () => {
  const SWEEP_ROOTS = ['packages', 'apps', 'examples'];
  const SWEEP_EXTENSIONS = new Set(['.ts', '.tsx', '.json']);
  const UNSCANNED = new Set(['node_modules', 'dist', 'build', '.next', '.turbo', 'coverage']);

  /** The declaration site and this pin are the two legitimate mentions. */
  const ALLOWED = new Set([
    path.join(packageRoot, 'src/types.ts'),
    fileURLToPath(import.meta.url),
  ]);

  function collect(dir: string, out: string[] = []): string[] {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!UNSCANNED.has(entry.name)) collect(full, out);
      } else if (SWEEP_EXTENSIONS.has(path.extname(entry.name))) {
        out.push(full);
      }
    }
    return out;
  }

  // The `src` tree of every workspace under each sweep root — the authored source
  // of each package, app and example.
  const sourceFiles = SWEEP_ROOTS.flatMap((root) => {
    const rootDir = path.join(repoRoot, root);
    let workspaces;
    try {
      workspaces = readdirSync(rootDir, { withFileTypes: true });
    } catch {
      return [];
    }
    return workspaces
      .filter((entry) => entry.isDirectory() && !UNSCANNED.has(entry.name))
      .flatMap((entry) => collect(path.join(rootDir, entry.name, 'src')));
  }).filter((file) => !ALLOWED.has(file));

  it('the sweep itself reads a non-trivial number of files', () => {
    // Without this, a bad path would make every assertion below pass vacuously —
    // the exact way a "nothing consumes it" pin rots into a permanently green test.
    expect(sourceFiles.length).toBeGreaterThan(500);
  });

  it('the sweep can actually see a consumed sibling flag', () => {
    // Calibration: `features.sso` IS consumed. If the sweep cannot find that, its
    // silence about passkeys/magicLink means nothing.
    const ssoConsumers = sourceFiles.filter((file) => /\bsso\b/.test(readFileSync(file, 'utf8')));
    expect(ssoConsumers.length).toBeGreaterThan(0);
  });

  it.each(RESERVED_FLAGS)('no source file reads `%s`', (flag) => {
    const pattern = new RegExp(`\\b${flag}\\b`);
    const consumers = sourceFiles
      .filter((file) => pattern.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(repoRoot, file));

    expect(
      consumers,
      [
        `\`${flag}\` is now referenced outside its declaration:`,
        ...consumers.map((file) => `  - ${file}`),
        '',
        'If a consumer landed deliberately (objectui#4179), this pin has done its job —',
        'retire the whole reserved unit in the SAME PR: the RESERVED doc comments in',
        'packages/auth/src/types.ts, the "Reserved flags" subsection of',
        'packages/auth/README.md, and this file. Do not delete this file alone.',
      ].join('\n'),
    ).toEqual([]);
  });
});
