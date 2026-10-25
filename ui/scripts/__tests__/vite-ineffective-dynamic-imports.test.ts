import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFEATED_LAZY_FIELD_WIDGETS,
  diffIneffectiveDynamicImports,
  formatIneffectiveDynamicImportFailure,
  formatIneffectiveDynamicImportStandDown,
  toRepoRelativeModuleId,
  viteIneffectiveDynamicImports,
} from '../vite-ineffective-dynamic-imports.ts';

/**
 * objectui#5325 — the console build emits 43 true-but-unactionable
 * `INEFFECTIVE_DYNAMIC_IMPORT` warnings. They are pinned to a ledger rather
 * than filtered away, so the signal survives and drift in EITHER direction
 * fails the build.
 *
 * This file tests the policy half. The graph half — which module ids rolldown
 * actually reports — is only exercisable by a real console build, exactly as
 * `scripts/check-eager-closure-budget.mjs` splits policy from
 * `emitEagerClosureReport`'s graph walk in `apps/console/vite.config.ts`.
 *
 * The plugin's hooks are ordinary functions on the returned object, though, so
 * the DECISION they make is driven directly here against a stub context (see
 * `drive` below). objectui#6093 turned that from a nicety into a requirement:
 * whether `closeBundle` throws is now conditional, and the condition has three
 * outcomes that a five-minute console build is a terrible way to check.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

describe('the ledger itself', () => {
  it('names files that still exist', () => {
    const gone = DEFEATED_LAZY_FIELD_WIDGETS.filter(
      (rel) => !fs.existsSync(path.join(REPO_ROOT, rel)),
    );
    // A stale entry would otherwise surface as a "did not fire" build failure,
    // which is a confusing way to learn that a widget was renamed or deleted.
    expect(gone).toEqual([]);
  });

  it('is sorted and free of duplicates', () => {
    expect([...DEFEATED_LAZY_FIELD_WIDGETS]).toEqual([...DEFEATED_LAZY_FIELD_WIDGETS].sort());
    expect(new Set(DEFEATED_LAZY_FIELD_WIDGETS).size).toBe(DEFEATED_LAZY_FIELD_WIDGETS.length);
  });

  it('holds only `packages/fields` widget modules, as repo-relative POSIX paths', () => {
    for (const rel of DEFEATED_LAZY_FIELD_WIDGETS) {
      expect(rel).toMatch(/^packages\/fields\/src\/widgets\/[A-Za-z]+\.tsx$/);
    }
  });

  it('excludes MarkdownContent — the control widget whose laziness is NOT defeated', () => {
    // It has a working `React.lazy` from `widgets/richTextDisplay.tsx`, is
    // re-exported by nothing, and has no static importer in production code, so
    // it emits no warning. Its ABSENCE here is what makes the ledger a
    // measurement of defeated laziness rather than a list of every widget.
    expect(DEFEATED_LAZY_FIELD_WIDGETS).not.toContain(
      'packages/fields/src/widgets/MarkdownContent.tsx',
    );
    expect(fs.existsSync(path.join(REPO_ROOT, 'packages/fields/src/widgets/MarkdownContent.tsx')))
      .toBe(true);
  });
});

describe('toRepoRelativeModuleId', () => {
  it('makes an in-repo absolute id repo-relative and POSIX', () => {
    const abs = path.join(REPO_ROOT, 'packages/fields/src/widgets/GridField.tsx');
    expect(toRepoRelativeModuleId(abs)).toBe('packages/fields/src/widgets/GridField.tsx');
  });

  it('strips Vite query suffixes and the virtual-module prefix', () => {
    const abs = path.join(REPO_ROOT, 'packages/fields/src/widgets/GridField.tsx');
    expect(toRepoRelativeModuleId(`${abs}?used`)).toBe('packages/fields/src/widgets/GridField.tsx');
    expect(toRepoRelativeModuleId(`\0${abs}`)).toBe('packages/fields/src/widgets/GridField.tsx');
  });

  it('leaves an out-of-repo id alone rather than emitting `../` soup', () => {
    // A `node_modules` id from a pnpm store outside the worktree must never
    // relativise into something that could collide with a ledger entry.
    const outside = path.resolve(REPO_ROOT, '..', 'elsewhere', 'x.js');
    expect(toRepoRelativeModuleId(outside)).toBe(outside.split(path.sep).join('/'));
  });
});

describe('diffIneffectiveDynamicImports', () => {
  const pinned = ['a.tsx', 'b.tsx'];

  it('is clean when the build sees exactly the pinned set', () => {
    expect(diffIneffectiveDynamicImports(['b.tsx', 'a.tsx'], pinned)).toEqual({
      unpinned: [],
      missing: [],
    });
  });

  it('reports a NEW ineffective dynamic import as unpinned', () => {
    expect(diffIneffectiveDynamicImports(['a.tsx', 'b.tsx', 'c.tsx'], pinned).unpinned)
      .toEqual(['c.tsx']);
  });

  it('reports a pinned entry that stopped firing as missing', () => {
    expect(diffIneffectiveDynamicImports(['a.tsx'], pinned).missing).toEqual(['b.tsx']);
  });

  it('reports a build that emitted NOTHING as every entry missing, not as clean', () => {
    // The counter-probe. objectui#5325 recorded a console build that died on 16
    // `MISSING_EXPORT` errors and therefore reported `0` of these warnings — a
    // zero that reads exactly like "fixed" unless a positive sighting is
    // demanded of every pinned entry.
    expect(diffIneffectiveDynamicImports([], pinned)).toEqual({
      unpinned: [],
      missing: ['a.tsx', 'b.tsx'],
    });
  });
});

describe('formatIneffectiveDynamicImportFailure', () => {
  it('names the offending modules and the file to edit, in both directions', () => {
    const text = formatIneffectiveDynamicImportFailure({
      unpinned: ['packages/fields/src/widgets/NewField.tsx'],
      missing: ['packages/fields/src/widgets/OldField.tsx'],
    });
    expect(text).toContain('+ packages/fields/src/widgets/NewField.tsx');
    expect(text).toContain('- packages/fields/src/widgets/OldField.tsx');
    expect(text).toContain('scripts/vite-ineffective-dynamic-imports.ts');
  });

  it('tells the reader to distrust the zero when entries stop firing', () => {
    // The wording is the whole user interface of this gate: a maintainer who
    // reads "did not fire" as "fixed" deletes 43 lines and switches the check
    // off. Pin the sentence that stops that.
    const text = formatIneffectiveDynamicImportFailure({ unpinned: [], missing: ['a.tsx'] });
    expect(text).toContain('distrust is the zero');
  });

  it('says nothing at all when there is no drift', () => {
    expect(formatIneffectiveDynamicImportFailure({ unpinned: [], missing: [] })).toBe('');
  });
});

describe('formatIneffectiveDynamicImportStandDown', () => {
  it('says the ledger was NOT checked, so silence cannot read as a pass', () => {
    const text = formatIneffectiveDynamicImportStandDown({ unpinned: [], missing: ['a.tsx'] });
    expect(text).toContain('NOT checked');
    expect(text).toContain('objectui#6093');
  });

  it('is one line and does not repeat the module list', () => {
    // The defect this stand-down exists for is 45 lines of field widgets landing
    // on top of a real build error. A stand-down that reprinted them would have
    // fixed nothing.
    const text = formatIneffectiveDynamicImportStandDown({
      unpinned: [],
      missing: [...DEFEATED_LAZY_FIELD_WIDGETS],
    });
    expect(text).not.toContain('\n');
    expect(text).not.toContain('packages/fields/src/widgets/GridField.tsx');
    expect(text).toContain(`${DEFEATED_LAZY_FIELD_WIDGETS.length} did not fire`);
  });
});

/**
 * objectui#6093 — `closeBundle` runs on a FAILED build too, and an error thrown
 * from it replaces that build's own error in `vite build`'s output. These drive
 * the plugin's hooks directly and assert the three states the fix is defined by;
 * the third is the control, because a "fix" that simply stopped the probe from
 * ever throwing would pass the first two.
 */
describe('the counter-probe on a build that did not finish', () => {
  const pinned = ['a.tsx', 'b.tsx'];

  /**
   * The plugin's hooks, as this file needs to CALL them. Vite's `Plugin` types
   * every hook as `ObjectHook<Fn>` — a function-or-object union — which is
   * unusable for a direct call, so the shape is restated here. `writeBundle` is
   * spelled in its object form on purpose: that this hook is `order: 'post'` is
   * load-bearing, not incidental, and a test below pins it.
   */
  type LedgerHooks = {
    configResolved: (config: { build: { write: boolean } }) => void;
    buildEnd: (error?: Error) => void;
    renderError: () => void;
    writeBundle: { order?: string; handler: () => void };
    onLog: (level: string, log: { code: string; id: string; ids: string[] }) => unknown;
    closeBundle: () => void;
  };

  const hooksOf = (): LedgerHooks =>
    viteIneffectiveDynamicImports(pinned) as unknown as LedgerHooks;

  /** A stub of the bits of rolldown's plugin context these hooks touch. */
  function drive(
    run: (hooks: {
      configResolved: (write: boolean) => void;
      buildEnd: (error?: Error) => void;
      renderError: () => void;
      writeBundle: () => void;
      sight: (id: string) => void;
      closeBundle: () => void;
    }) => void,
  ): { errors: string[]; infos: string[] } {
    const errors: string[] = [];
    const infos: string[] = [];
    const ctx = {
      error(message: string) {
        errors.push(message);
        // The real `this.error` throws; a stub that returned would let the code
        // under test run on past a failure it never survives in production.
        throw new Error(message);
      },
      info(message: string) {
        infos.push(message);
      },
    };
    const plugin = hooksOf();
    const hooks = {
      configResolved: (write: boolean) => plugin.configResolved.call(ctx, { build: { write } }),
      buildEnd: (error?: Error) => plugin.buildEnd.call(ctx, error),
      renderError: () => plugin.renderError.call(ctx),
      writeBundle: () => plugin.writeBundle.handler.call(ctx),
      sight: (id: string) => {
        plugin.onLog.call(ctx, 'warn', { code: 'INEFFECTIVE_DYNAMIC_IMPORT', id, ids: [] });
      },
      closeBundle: () => {
        try {
          plugin.closeBundle.call(ctx);
        } catch {
          // recorded in `errors` above; swallowed so the assertions can read it
        }
      },
    };
    run(hooks);
    return { errors, infos };
  }

  it('declares `writeBundle` at `order: post` so a LATER plugin cannot arm it', () => {
    // With the default order this hook runs before a later plugin's
    // `writeBundle`, so that plugin's failure would leave the marker set and the
    // probe would mask it — the very defect, one plugin further down the array.
    const plugin = hooksOf();
    expect(plugin.writeBundle.order).toBe('post');
    expect(typeof plugin.writeBundle.handler).toBe('function');
  });

  it('STATE 1 — build failed before output was written: silent, so the real error stands', () => {
    // `writeBundle` never runs. This is the failure objectui#6093 was measured
    // on: `emit-eager-closure-report` throwing from its own `writeBundle`.
    const { errors, infos } = drive((h) => {
      h.configResolved(true);
      h.buildEnd();
      h.closeBundle();
    });
    expect(errors).toEqual([]);
    expect(infos).toHaveLength(1);
    expect(infos[0]).toContain('NOT checked');
  });

  it('STATE 1b — a build-phase error reaches `buildEnd`, and that alone stands it down', () => {
    const { errors } = drive((h) => {
      h.configResolved(true);
      h.buildEnd(new Error('16 MISSING_EXPORT errors'));
      h.writeBundle();
      h.closeBundle();
    });
    expect(errors).toEqual([]);
  });

  it('STATE 1c — a render-phase error reaches `renderError`, and stands it down too', () => {
    const { errors } = drive((h) => {
      h.configResolved(true);
      h.renderError();
      h.writeBundle();
      h.closeBundle();
    });
    expect(errors).toEqual([]);
  });

  it('STATE 2 — build succeeded and every pinned entry fired: silent, no drift', () => {
    const { errors, infos } = drive((h) => {
      h.configResolved(true);
      h.sight('a.tsx');
      h.sight('b.tsx');
      h.buildEnd();
      h.writeBundle();
      h.closeBundle();
    });
    expect(errors).toEqual([]);
    // The one summary line the plugin prints in place of the pinned warnings.
    expect(infos.join('\n')).toContain('all pinned');
  });

  it('STATE 3 (the control) — build SUCCEEDED and nothing fired: still errors', () => {
    // Without this, the fix above is indistinguishable from switching the gate
    // off. This is the case the counter-probe was written for.
    const { errors } = drive((h) => {
      h.configResolved(true);
      h.buildEnd();
      h.writeBundle();
      h.closeBundle();
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('2 pinned ineffective dynamic import(s) did NOT fire');
    expect(errors[0]).toContain('distrust is the zero');
  });

  it('STATE 3b (the other direction) — an UNPINNED sighting on a finished build still fails', () => {
    const { errors } = drive((h) => {
      h.configResolved(true);
      h.sight('a.tsx');
      h.sight('b.tsx');
      h.sight('c.tsx');
      h.buildEnd();
      h.writeBundle();
      h.closeBundle();
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('+ c.tsx');
  });

  it('keeps the probe ARMED on a `write: false` build, which never calls `writeBundle`', () => {
    // The one build that legitimately reaches `closeBundle` with no
    // `writeBundle`. Reading it as "did not finish" would disarm the probe with
    // no witness — the failure mode with no symptom, so it is refused.
    const { errors } = drive((h) => {
      h.configResolved(false);
      h.buildEnd();
      h.closeBundle();
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('did NOT fire');
  });
});
