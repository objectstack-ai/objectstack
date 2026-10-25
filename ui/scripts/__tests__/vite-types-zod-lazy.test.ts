import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONSUMER_TEST,
  EAGER_WALK_CONTROL,
  TYPES_ZOD_TEST,
  judgeTypesZodLazy,
  type ChunkFacts,
} from '../vite-types-zod-lazy.ts';

/**
 * objectui#10065 — the `packages/types/src/zod/**` validators rode the EAGER
 * `framework` chunk although their only live consumer in the console bundle
 * sits behind a lazy boundary. This file tests the POLICY half: which shapes of
 * emitted bundle are a pass, which are a refusal, and which refusal is reported
 * when two are true at once.
 *
 * The GRAPH half — which module ids rolldown actually reports and which chunk
 * it writes them to — is only exercisable by a real console build, the same
 * split `scripts/check-eager-closure-budget.mjs` keeps from the closure walk in
 * the console's own config.
 */

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const VITE_CONFIG = path.join(REPO_ROOT, 'apps/console/vite.config.ts');
const read = (repoRelative: string) => fs.readFileSync(path.join(REPO_ROOT, repoRelative), 'utf8');

const ZOD_MODULE = '/repo/packages/types/src/zod/objectql.zod.ts';
const MAP_MODULE = '/repo/packages/plugin-map/src/ObjectMap.tsx';
const REACT_DOM = '/repo/node_modules/react-dom/index.js';
const GRID_MODULE = '/repo/packages/plugin-grid/src/ObjectGrid.tsx';

function chunk(
  fileName: string,
  moduleIds: string[],
  imports: string[] = [],
  isEntry = false,
): ChunkFacts {
  return { fileName, isEntry, imports, moduleIds };
}

/**
 * The bundle shape this change produces: the entry reaches react and the grid
 * statically, the map view only dynamically, and the validators hang off the
 * map's chunk.
 */
function healthyBundle(): ChunkFacts[] {
  return [
    chunk('index.js', ['/repo/apps/console/src/main.tsx'], ['vendor-react.js', 'plugin-grid.js'], true),
    chunk('vendor-react.js', [REACT_DOM]),
    chunk('plugin-grid.js', [GRID_MODULE]),
    chunk('plugin-map.js', [MAP_MODULE], ['types-zod.js']),
    chunk('types-zod.js', [ZOD_MODULE]),
  ];
}

describe('the healthy shape', () => {
  it('passes, and says what it checked rather than just "ok"', () => {
    const verdict = judgeTypesZodLazy(healthyBundle());
    expect(verdict.ok).toBe(true);
    // The success line is the only place a reader learns the guard had a
    // subject at all, so it carries the counts rather than a bare tick.
    expect(verdict.message).toContain('lazy and still reachable');
    expect(verdict.message).toContain('plugin-map');
  });
});

describe('the two failures this guard exists for', () => {
  it('reds when an eager chunk statically imports the validators', () => {
    const facts = healthyBundle().map((c) =>
      c.fileName === 'plugin-grid.js' ? { ...c, imports: ['types-zod.js'] } : c,
    );
    const verdict = judgeTypesZodLazy(facts);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('back in the EAGER closure');
    // Naming the importing chunk is the whole diagnostic value: the byte
    // ceilings already report THAT the bundle grew.
    expect(verdict.message).toContain('plugin-grid.js');
  });

  it('reds when the validators are no longer reachable from plugin-map', () => {
    // The shape that LOOKS like a saving — the eager closure gets smaller and
    // every byte ceiling goes greener while the map view breaks at runtime.
    const facts = healthyBundle().map((c) =>
      c.fileName === 'plugin-map.js' ? { ...c, imports: [] } : c,
    );
    const verdict = judgeTypesZodLazy(facts);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('NO LONGER REACHABLE');
    expect(verdict.message).toContain('ObjectMapConfigSchema');
  });

  it('reports the REACHABILITY failure first when both are true at once', () => {
    // Both halves broken: the validators are orphaned from plugin-map AND an
    // eager chunk holds them. The ordering is a deliberate property — a
    // deletion is the silent failure and must not be reported as a size
    // regression, which an author would "fix" by deleting more.
    const facts: ChunkFacts[] = [
      chunk('index.js', ['/repo/apps/console/src/main.tsx'], ['vendor-react.js', 'types-zod.js'], true),
      chunk('vendor-react.js', [REACT_DOM]),
      chunk('plugin-map.js', [MAP_MODULE]),
      chunk('types-zod.js', [ZOD_MODULE]),
    ];
    const verdict = judgeTypesZodLazy(facts);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('NO LONGER REACHABLE');
    expect(verdict.message).not.toContain('back in the EAGER closure');
  });
});

describe('every probe fails CLOSED — a matcher that matches nothing agrees with everything', () => {
  it('refuses a verdict when no chunk holds a validator module', () => {
    const facts = healthyBundle().filter((c) => c.fileName !== 'types-zod.js');
    const verdict = judgeTypesZodLazy(facts);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('counter-probe failed');
    // Without this probe the bundle above is indistinguishable from a correct
    // one: nothing matches, so nothing is eager and nothing is unreachable.
    expect(verdict.message).toContain('types');
  });

  it('refuses a verdict when no chunk holds a plugin-map module', () => {
    const facts = healthyBundle().map((c) =>
      c.fileName === 'plugin-map.js' ? { ...c, moduleIds: [] } : c,
    );
    const verdict = judgeTypesZodLazy(facts);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('counter-probe failed');
    expect(verdict.message).toContain('nothing to walk from');
  });

  it('refuses a verdict when the eager walk cannot see react-dom', () => {
    // A walk that finds too little reports "nothing is eager", which is the
    // exact verdict this guard would otherwise publish as good news.
    const facts = healthyBundle().map((c) =>
      c.fileName === 'index.js' ? { ...c, imports: ['plugin-grid.js'] } : c,
    );
    const verdict = judgeTypesZodLazy(facts);
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain('counter-probe failed');
    expect(verdict.message).toContain('react-dom');
  });
});

describe('the source edge, when the module graph is available', () => {
  it('names the importing MODULE, not only the co-tenant chunk', () => {
    // objectui#10065's own first counterfactual build is why this exists: the
    // chunk-level message named `plugin-grid` and the cause was three shared
    // modules in `packages/types/src/` that the group had absorbed.
    const facts = healthyBundle().map((c) =>
      c.fileName === 'plugin-grid.js' ? { ...c, imports: ['types-zod.js'] } : c,
    );
    const verdict = judgeTypesZodLazy(facts, (id) => (id === ZOD_MODULE ? [GRID_MODULE] : []));
    expect(verdict.ok).toBe(false);
    expect(verdict.message).toContain(GRID_MODULE);
  });

  it('does not report an edge from inside the validators to themselves', () => {
    const facts = healthyBundle().map((c) =>
      c.fileName === 'plugin-grid.js' ? { ...c, imports: ['types-zod.js'] } : c,
    );
    const sibling = '/repo/packages/types/src/zod/index.zod.ts';
    const verdict = judgeTypesZodLazy(facts, (id) => (id === ZOD_MODULE ? [sibling] : []));
    expect(verdict.message).not.toContain(sibling);
  });
});

describe('the regexes point at things that exist', () => {
  it('matches a real validator module and not its non-zod neighbours', () => {
    const real = path.join(REPO_ROOT, 'packages/types/src/zod/objectql.zod.ts');
    expect(fs.existsSync(real)).toBe(true);
    expect(TYPES_ZOD_TEST.test(real)).toBe(true);

    // ⭐ The co-tenant that the group absorbed on the first counterfactual
    // build. It carries runtime values the EAGER `plugin-grid` chunk reads, so
    // a regex that swept it in would put the whole chunk back on the eager
    // line — which is exactly what happened, and what the `test` staying
    // directory-scoped prevents.
    const neighbour = path.join(REPO_ROOT, 'packages/types/src/data-display.ts');
    expect(fs.existsSync(neighbour)).toBe(true);
    expect(TYPES_ZOD_TEST.test(neighbour)).toBe(false);
  });

  it('matches the one live consumer, which still imports the validators', () => {
    const consumer = path.join(REPO_ROOT, 'packages/plugin-map/src/ObjectMap.tsx');
    expect(fs.existsSync(consumer)).toBe(true);
    expect(CONSUMER_TEST.test(consumer)).toBe(true);
    // Fails closed: if this import is gone the guard has no subject, and the
    // `types-zod` group is a chunk nothing reaches rather than a lazy one.
    expect(read('packages/plugin-map/src/ObjectMap.tsx')).toContain("from '@object-ui/types/zod'");
  });

  it('matches react-dom under a pnpm-shaped path', () => {
    expect(EAGER_WALK_CONTROL.test('/repo/node_modules/.pnpm/react-dom@19/node_modules/react-dom/index.js')).toBe(true);
  });
});

describe('the console config keeps its side of the bargain', () => {
  const source = fs.readFileSync(VITE_CONFIG, 'utf8');

  it('registers the guard, or nothing weighs the bundle at all', () => {
    expect(source).toContain('viteTypesZodLazy()');
  });

  it('declares a `types-zod` group above `framework`s priority', () => {
    // A group at or below `framework`s priority is claimed by `framework`s own
    // `packages/(core|react|types)` regex instead, and the split silently does
    // nothing.
    const group = /name:\s*'types-zod',[\s\S]{0,400}?priority:\s*(\d+)/.exec(source);
    expect(group, 'the `types-zod` group is gone from the console config').not.toBeNull();
    const framework = /\{\s*name:\s*'framework',[\s\S]{0,200}?priority:\s*(\d+)\s*\}/.exec(source);
    expect(framework).not.toBeNull();
    expect(Number(group![1])).toBeGreaterThan(Number(framework![1]));
  });

  it('keeps the group from absorbing its own dependencies', () => {
    // ⭐ The load-bearing option, and the one nothing else in the tree would
    // notice going missing until a full console build runs: rolldown's default
    // is `true`, and with the default the group swept in three shared
    // `packages/types/src/` modules that the eager `plugin-grid` chunk reads —
    // so the validators stayed eager and the saving was zero.
    const group = /name:\s*'types-zod',[\s\S]{0,600}?\n\s*\},/.exec(source);
    expect(group).not.toBeNull();
    expect(group![0]).toContain('includeDependenciesRecursively: false');
  });
});
