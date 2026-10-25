import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { attachedDocs } from './helpers/attached-docs';
import {
  APP_CONTENT_PATH,
  DECLARED_LAZY_VIEWS_STILL_EAGER,
  EAGER_WALK_CONTROL,
  bareSideEffectImport,
  declaredSideEffectful,
  diffDeclaredLazyViews,
  formatDeclaredLazyViewFailure,
  nearestPackage,
  parseDeclaredLazyViews,
} from '../vite-declared-lazy-views.ts';

/**
 * objectui#6535 — six of the eight views `AppContent` declares with `lazy()`
 * were in the console's EAGER closure anyway. This file tests the POLICY half:
 * what is parsed out of AppContent, what may honestly be declared
 * side-effect-free, and which direction of ledger drift fails.
 *
 * The GRAPH half — which module ids rolldown actually reports, and whether
 * `moduleSideEffects` is honoured — is only exercisable by a real console
 * build, exactly as `scripts/check-eager-closure-budget.mjs` splits policy from
 * `emitEagerClosureReport`'s walk in `apps/console/vite.config.ts`.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const read = (repoRelative: string) => fs.readFileSync(path.join(REPO_ROOT, repoRelative), 'utf8');

describe('DECLARED_LAZY_VIEWS_STILL_EAGER', () => {
  it('is sorted and free of duplicates', () => {
    const entries = [...DECLARED_LAZY_VIEWS_STILL_EAGER];
    expect(entries).toEqual([...new Set(entries)]);
    expect(entries).toEqual([...entries].sort());
  });

  it('names files that exist', () => {
    // A ledger entry pointing at a deleted module would otherwise fail the
    // build as a `missing` sighting, which is a confusing way to learn a view
    // was renamed.
    for (const entry of DECLARED_LAZY_VIEWS_STILL_EAGER) {
      expect(fs.existsSync(path.join(REPO_ROOT, entry)), entry).toBe(true);
    }
  });

  it('only pins views that AppContent actually declares lazy', () => {
    const declared = parseDeclaredLazyViews(read(APP_CONTENT_PATH));
    for (const entry of DECLARED_LAZY_VIEWS_STILL_EAGER) {
      expect(declared, `${entry} is pinned but no longer declared lazy`).toContain(entry);
    }
  });
});

describe('parseDeclaredLazyViews', () => {
  it('finds every relative module AppContent declares, resolved to real files', () => {
    const declared = parseDeclaredLazyViews(read(APP_CONTENT_PATH));
    // The count is a measurement, asserted rather than merely observed because a
    // matcher that silently finds fewer makes every check downstream of it pass
    // vacuously. Eight single-file route views (objectui#6535), the
    // metadata-admin directory barrel that six declarations share, and the two
    // marketplace pages (objectui#6681 measured three; objectui#12733 retired the
    // Installed Apps one), and the app's report index (objectui#13020) = twelve
    // distinct files.
    expect(declared).toHaveLength(12);
    for (const view of declared) {
      expect(fs.existsSync(path.join(REPO_ROOT, view)), view).toBe(true);
    }
    expect(declared).toContain('packages/app-shell/src/views/ObjectDataPage.tsx');
    expect(declared).toContain('packages/app-shell/src/views/ComponentNavView.tsx');
    expect(declared).toContain('packages/app-shell/src/views/AppReportIndexView.tsx');
    // The three surfaces objectui#6535 deliberately looked away from and
    // objectui#6681 measured. Named individually: a bare length assertion goes
    // on passing if the widened matcher swaps one surface for another.
    expect(declared).toContain('packages/app-shell/src/views/metadata-admin/index.ts');
    expect(declared).toContain('packages/app-shell/src/console/marketplace/MarketplacePage.tsx');
    expect(declared).toContain(
      'packages/app-shell/src/console/marketplace/MarketplacePackagePage.tsx',
    );
  });

  it('sweeps in the directory barrel and the sibling directory, and dedupes the barrel', () => {
    const declared = parseDeclaredLazyViews(
      [
        "const A = lazy(() => import('../views/Alpha.js').then(m => ({ default: m.Alpha })));",
        "const B = lazy(() => import('../views/metadata-admin/index.js').then(m => ({ default: m.B })));",
        "const B2 = lazy(() => import('../views/metadata-admin/index.js').then(m => ({ default: m.B2 })));",
        "const C = lazy(() => import('./marketplace/MarketplacePage.js').then(m => ({ default: m.C })));",
      ].join('\n'),
      (p) =>
        p === 'packages/app-shell/src/views/Alpha.tsx' ||
        p === 'packages/app-shell/src/views/metadata-admin/index.ts' ||
        p === 'packages/app-shell/src/console/marketplace/MarketplacePage.tsx',
    );
    expect(declared).toEqual([
      'packages/app-shell/src/console/marketplace/MarketplacePage.tsx',
      'packages/app-shell/src/views/Alpha.tsx',
      'packages/app-shell/src/views/metadata-admin/index.ts',
    ]);
  });

  it('still ignores a PACKAGE specifier, which has no repo-relative source file', () => {
    // `@object-ui/plugin-designer` needs a resolver to become a path, and this
    // parser runs in `buildStart` before any module is loaded. Its chunk was
    // measured NOT eager on `b98352a15`, so this is a recorded blind spot rather
    // than a live one.
    const declared = parseDeclaredLazyViews(
      "const D = lazy(() => import('@object-ui/plugin-designer').then(m => ({ default: m.D })));",
      () => true,
    );
    expect(declared).toEqual([]);
  });

  it('resolves the NodeNext .js specifier to the real .tsx file rather than guessing', () => {
    const seen: string[] = [];
    const declared = parseDeclaredLazyViews(
      "const A = lazy(() => import('../views/Alpha.js'));",
      (p) => {
        seen.push(p);
        return p.endsWith('.ts');
      },
    );
    expect(seen).toEqual([
      'packages/app-shell/src/views/Alpha.tsx',
      'packages/app-shell/src/views/Alpha.ts',
    ]);
    expect(declared).toEqual(['packages/app-shell/src/views/Alpha.ts']);
  });

  it('returns nothing when the declarations are re-spelled — the counter-probe case', () => {
    expect(parseDeclaredLazyViews('const A = lazyLoad("../views/Alpha.js");')).toEqual([]);
  });
});

describe('bareSideEffectImport', () => {
  it('catches a bare side-effect import, which makes a purity claim false', () => {
    expect(bareSideEffectImport("import './record-approvals-renderer.js';\n")).toBe(
      "import './record-approvals-renderer.js';",
    );
  });

  it('does not mistake a named or default import for one', () => {
    expect(bareSideEffectImport("import { RecordDetailView } from './x.js';\n")).toBeNull();
    expect(bareSideEffectImport("import React from 'react';\n")).toBeNull();
  });

  it('agrees with the real sources: every unpinned declared view is pure', () => {
    // The plugin declares `moduleSideEffects: false` for exactly the declared
    // views it has NOT pinned, so this is the claim it makes about this repo.
    const pinned = new Set(DECLARED_LAZY_VIEWS_STILL_EAGER);
    const declared = parseDeclaredLazyViews(read(APP_CONTENT_PATH));
    const unpinned = declared.filter((view) => !pinned.has(view));
    expect(unpinned.length).toBeGreaterThan(0);
    for (const view of unpinned) {
      expect(bareSideEffectImport(read(view)), view).toBeNull();
    }
  });

  it('agrees with the real source that RecordDetailView is NOT pure', () => {
    // The positive control for the assertion above: a source that DOES carry
    // one, so a matcher that had stopped matching could not pass both.
    expect(bareSideEffectImport(read('packages/app-shell/src/views/RecordDetailView.tsx'))).toBe(
      "import './record-approvals-renderer.js';",
    );
  });
});

describe('declaredSideEffectful', () => {
  it('matches an exact `./path` entry, with or without the leading dot-slash', () => {
    const array = ['./src/index.ts', './src/views/metadata-admin/index.ts'];
    expect(declaredSideEffectful(array, 'src/views/metadata-admin/index.ts')).toBe(
      './src/views/metadata-admin/index.ts',
    );
    expect(declaredSideEffectful(array, 'src/views/RecordDetailView.tsx')).toBeNull();
  });

  it('reads `false` as "nothing is side-effectful" and `true`/absent the other way', () => {
    expect(declaredSideEffectful(false, 'src/anything.ts')).toBeNull();
    // Absent is not a refusal: it is the state this whole plugin was written
    // for, and the per-module declaration is what it replaces.
    expect(declaredSideEffectful(undefined, 'src/anything.ts')).toBeNull();
    expect(declaredSideEffectful(true, 'src/anything.ts')).toContain('sideEffects');
  });

  it('refuses on a glob rather than under-matching it', () => {
    // A guard that silently fails to match is the failure this function exists
    // to prevent, so the ambiguous case fails LOUD.
    expect(declaredSideEffectful(['./src/**/*.css'], 'src/views/Alpha.tsx')).toContain('glob');
  });

  it('agrees with the real package: register-builtins.ts is declared side-effectful', () => {
    // The subject. This is the file whose FIVE top-level registration calls
    // `bareSideEffectImport` cannot see, so without this guard the plugin would
    // declare it pure the moment someone deleted its ledger line
    // (objectui#6681). objectui#6776 MOVED those five calls out of the page
    // barrel and into this leaf; the guard's job and its blind spot are
    // unchanged, only the file that carries them.
    const owner = nearestPackage(
      'packages/app-shell/src/views/metadata-admin/register-builtins.ts',
      REPO_ROOT,
    );
    expect(owner?.packageJsonPath).toBe('packages/app-shell/package.json');
    expect(owner?.packageRelative).toBe('src/views/metadata-admin/register-builtins.ts');
    const manifest = JSON.parse(read(owner!.packageJsonPath)) as { sideEffects?: unknown };
    expect(declaredSideEffectful(manifest.sideEffects, owner!.packageRelative)).toBe(
      './src/views/metadata-admin/register-builtins.ts',
    );
    // The positive control in the same query shape: a declared-lazy module the
    // array does NOT name, so a matcher that answered "side-effectful" to
    // everything could not pass both.
    expect(
      declaredSideEffectful(manifest.sideEffects, 'src/console/marketplace/MarketplacePage.tsx'),
    ).toBeNull();
  });

  it('the page barrel is NOT declared side-effectful any more (objectui#6776)', () => {
    // The other half of the move, stated as a pin rather than left to the
    // ledger: `views/metadata-admin/index.ts` is what the console's six
    // `lazy()` declarations name, and it is shakeable ONLY while the published
    // `sideEffects` array does not name it. Re-adding it there — or putting a
    // bare `import './register-builtins.js';` back on the barrel, which
    // `bareSideEffectImport` reads as the same claim — puts 172,945 gzipped
    // bytes back into every console page load, silently.
    const owner = nearestPackage('packages/app-shell/src/views/metadata-admin/index.ts', REPO_ROOT);
    expect(owner?.packageJsonPath).toBe('packages/app-shell/package.json');
    const manifest = JSON.parse(read(owner!.packageJsonPath)) as { sideEffects?: unknown };
    expect(declaredSideEffectful(manifest.sideEffects, owner!.packageRelative)).toBeNull();
    expect(bareSideEffectImport(read('packages/app-shell/src/views/metadata-admin/index.ts'))).toBeNull();
  });

  it('the source-reading guard is blind to it, which is why this one exists', () => {
    // Stated as a test rather than a comment: if `bareSideEffectImport` ever
    // learns to see top-level calls, this expectation flips and the reader is
    // told, instead of two guards silently overlapping.
    expect(
      bareSideEffectImport(read('packages/app-shell/src/views/metadata-admin/index.ts')),
    ).toBeNull();
  });
});

describe('nearestPackage', () => {
  it('walks up to the owning package, not the repo root', () => {
    expect(nearestPackage('packages/app-shell/src/views/ObjectView.tsx', REPO_ROOT)).toEqual({
      packageJsonPath: 'packages/app-shell/package.json',
      packageRelative: 'src/views/ObjectView.tsx',
    });
  });
});

describe('EAGER_WALK_CONTROL', () => {
  it('is a real file that AppContent imports STATICALLY', () => {
    // The plugin's counter-probe 2 asserts this module is eager. That only
    // means anything while AppContent still imports it outside a `lazy()`.
    expect(fs.existsSync(path.join(REPO_ROOT, EAGER_WALK_CONTROL))).toBe(true);
    const appContent = read(APP_CONTENT_PATH);
    expect(appContent).toContain("import { ObjectView } from '../views/ObjectView.js';");
    expect(parseDeclaredLazyViews(appContent)).not.toContain(EAGER_WALK_CONTROL);
  });
});

describe('diffDeclaredLazyViews', () => {
  const pinned = [
    'packages/app-shell/src/views/RecordDetailView.tsx',
    'packages/app-shell/src/views/metadata-admin/index.ts',
  ];

  it('is clean when the eager set is exactly the ledger', () => {
    const diff = diffDeclaredLazyViews(pinned, pinned);
    expect(diff).toEqual({ unpinned: [], missing: [] });
    expect(formatDeclaredLazyViewFailure(diff)).toBeNull();
  });

  it('reports a NEW eager view as unpinned', () => {
    const diff = diffDeclaredLazyViews([...pinned, 'packages/app-shell/src/views/PageView.tsx'], pinned);
    expect(diff.unpinned).toEqual(['packages/app-shell/src/views/PageView.tsx']);
    expect(diff.missing).toEqual([]);
    expect(formatDeclaredLazyViewFailure(diff)).toContain('views/PageView.tsx');
  });

  it('reports a pinned view that stopped being eager as missing — the counter-probe', () => {
    // The dangerous reading is ZERO. A walk that has gone blind reports no
    // eager views at all, which without this half is indistinguishable from
    // "someone fixed them".
    const diff = diffDeclaredLazyViews([], pinned);
    expect(diff.unpinned).toEqual([]);
    expect(diff.missing).toEqual(pinned);
    const message = formatDeclaredLazyViewFailure(diff);
    expect(message).toContain('NO LONGER in the eager closure');
    expect(message).toContain('gone blind');
  });

  it('defaults to the shipped ledger', () => {
    expect(diffDeclaredLazyViews(DECLARED_LAZY_VIEWS_STILL_EAGER)).toEqual({
      unpinned: [],
      missing: [],
    });
  });
});

describe('formatDeclaredLazyViewFailure', () => {
  it('carries the per-view explanation so the reader does not rebuild the graph by hand', () => {
    const diff = diffDeclaredLazyViews(['packages/app-shell/src/views/PageView.tsx'], []);
    const message = formatDeclaredLazyViewFailure(
      diff,
      new Map([['packages/app-shell/src/views/PageView.tsx', 'in eager chunk `assets/PageView-x.js`']]),
    );
    expect(message).toContain('in eager chunk `assets/PageView-x.js`');
  });

  it('reports both directions of drift at once', () => {
    const message = formatDeclaredLazyViewFailure({
      unpinned: ['packages/app-shell/src/views/PageView.tsx'],
      missing: ['packages/app-shell/src/views/RecordDetailView.tsx'],
    });
    expect(message).toContain('views/PageView.tsx');
    expect(message).toContain('views/RecordDetailView.tsx');
  });
});

/**
 * objectui#7289 — the VALUE half of the attached-prose pin objectui#7046 built
 * for `scripts/check-eager-closure-budget.mjs`, applied here.
 *
 * Same defect, one file over: a constant carries a value, a paragraph beside it
 * explains that value, and nothing makes the two agree. objectui#6785 was the
 * same rot in this very file's prose and was repaired BY HAND, so nothing
 * stopped the next paragraph from going stale. {@link attachedDocs} locates the
 * block attached to an export structurally — the JSDoc ending immediately
 * before the declaration plus every comment lexically inside it, code stripped
 * — so these pins carry no line numbers to rot.
 *
 * ⚠️ Only the value half transfers, and that was MEASURED before it was
 * written. This file carries five 9-hex commit citations in prose, and it
 * exports no constant carrying a commit string as data — so the commit half of
 * objectui#7046's pin has nothing live to check those five against, and
 * copying it here would ship a vacuously green test: the defect one layer up,
 * which is the wall objectui#7046 itself hit on `PER_CHUNK_BASELINE`. The five
 * hashes are deliberately left unguarded; see the PR body for the reading.
 *
 * ⚠️ Non-vacuous, also measured: all three constants FAILED this pin when it
 * was written. Not one of the three paragraphs named the path its constant
 * carries — the ledger's bullet said `RecordDetailView`, the two control
 * constants' blocks named no path at all — and the three sentences that now do
 * are the only edit this card made to `scripts/vite-declared-lazy-views.ts`.
 */
describe('the prose attached to the exported constants (objectui#7289)', () => {
  const source = read('scripts/vite-declared-lazy-views.ts');

  /** The paths a constant carries AS DATA, found by walking its value. */
  function pathsCarriedBy(value: unknown): string[] {
    const found: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') {
        found.push(v);
        return;
      }
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(value);
    return [...new Set(found)];
  }

  const PINNED = {
    APP_CONTENT_PATH,
    EAGER_WALK_CONTROL,
    DECLARED_LAZY_VIEWS_STILL_EAGER,
  } as const;

  it('locates the block attached to each constant, and only that block', () => {
    const appContent = attachedDocs(source, 'APP_CONTENT_PATH');
    const control = attachedDocs(source, 'EAGER_WALK_CONTROL');
    const ledger = attachedDocs(source, 'DECLARED_LAZY_VIEWS_STILL_EAGER');

    // Controls that MUST hit: a phrase verified to be inside each attached
    // block. A locator that quietly found the wrong span would pass every pin
    // below by scanning prose that says nothing about these constants.
    expect(appContent.prose).toContain('declarations are the subject');
    expect(control.prose).toContain('The positive control for the eager walk');
    expect(ledger.prose).toContain('Deleting a line is a MEASUREMENT');

    // ...and the neighbours are not swept in. These three declarations sit
    // consecutively with nothing but their own blocks between them, so an
    // over-wide span shows up as one constant's block reaching into another's.
    expect(appContent.prose).not.toContain('Repo root');
    expect(appContent.prose).not.toContain('The positive control for the eager walk');
    expect(control.prose).not.toContain('declarations are the subject');
    expect(ledger.prose).not.toContain('The positive control for the eager walk');
    expect(ledger.prose).not.toContain('Pull the modules out of');

    // The code is not prose. Without this the positive pin below would be
    // satisfiable by the ledger's own entry line.
    expect(ledger.code).toContain("'packages/app-shell/src/views/RecordDetailView.tsx'");
    expect(ledger.prose).not.toContain("'packages/app-shell/src/views/RecordDetailView.tsx'");
  });

  /**
   * The positive pin: every path a constant carries must appear in the prose
   * attached to that same constant. An entry added, removed or re-pathed
   * without touching the paragraph that explains it reds here instead of
   * drifting — which is the whole of what objectui#6785 had to be fixed by
   * hand.
   */
  it.each(Object.keys(PINNED))('pins every path %s carries into its own attached prose', (name) => {
    const { prose } = attachedDocs(source, name);
    const carried = pathsCarriedBy(PINNED[name as keyof typeof PINNED]);
    expect(carried.filter((entry) => !prose.includes(entry))).toEqual([]);
  });

  /**
   * What each constant carries AS DATA, recorded so the pin above cannot go
   * vacuous in silence. The two controls carry exactly themselves; the ledger
   * carries one entry.
   *
   * ⚠️ The ledger EMPTYING is a win, not a failure — the block above this
   * declaration says it in as many words ("Deleting a line is a MEASUREMENT,
   * never a repair"), and the `missing` half of the diff is what licenses the
   * deletion. So this number going down is not a regression; it is the line
   * where that win gets recorded, alongside the paragraph the deleted entry
   * took with it. A pin over an empty set passes without checking anything,
   * and that silence is what this case exists to break.
   */
  it('records what each constant carries as data, so the pin cannot go vacuous', () => {
    expect(pathsCarriedBy(APP_CONTENT_PATH)).toEqual([APP_CONTENT_PATH]);
    expect(pathsCarriedBy(EAGER_WALK_CONTROL)).toEqual([EAGER_WALK_CONTROL]);
    expect(pathsCarriedBy(DECLARED_LAZY_VIEWS_STILL_EAGER)).toHaveLength(1);
  });
});
