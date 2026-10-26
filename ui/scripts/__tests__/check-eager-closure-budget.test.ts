import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The structural locator for the prose attached to an exported constant, shared
// with `vite-declared-lazy-views.test.ts` (objectui#7289). It was written here
// for objectui#7046 and moved out unchanged; see the helper's own header for
// why one implementation rather than two.
import { attachedDocs } from './helpers/attached-docs';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494.
import {
  BASELINE,
  MAX_EAGER_CLOSURE_GZIP_BYTES,
  PER_CHUNK_BASELINE,
  PER_CHUNK_GZIP_CEILINGS,
  PER_CHUNK_MEMBERSHIP,
  PER_CHUNK_MEMBERSHIP_CARVE_OUTS,
  REGRESSION_THIS_GATE_MUST_CATCH_BYTES,
  SUPPORTED_REPORT_VERSION,
  VERDICT_CEILING_CONSTANTS,
  evaluateCeilingFreshness,
  evaluateClosureBudget,
  evaluateHeadroomSensitivity,
  evaluatePerChunkBudgets,
  evaluatePerChunkMembership,
  extractCeilingDeclarations,
  RECOGNISED_HALF_STATUSES,
  foldHalfStatuses,
  main,
  measureChunksByName,
  renderTopChunks,
  validateReport,
} from '../check-eager-closure-budget.mjs';

// The classifier this gate's prose now CITES instead of paraphrasing
// (objectui#9155). Imported so the must-stay leg of that pin reads the real
// tables rather than a copy of them. Same `allowJs` inference as above.
import { OPTIONAL_CONTEXTS, REQUIRED_CONTEXTS } from '../dependabot-merge-gate.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(repoRoot, '.github/workflows/performance-budget.yml');
const viteConfigPath = path.join(repoRoot, 'apps/console/vite.config.ts');
const checkerPath = path.join(repoRoot, 'scripts/check-eager-closure-budget.mjs');

/**
 * A report shaped exactly like `emitEagerClosureReport`'s output, with the
 * chunk list summing to the declared total — the checker refuses reports where
 * it does not.
 */
function report(overrides: Record<string, unknown> = {}) {
  const files = [
    { fileName: 'assets/index-A.js', name: 'index', bytes: 90_000, gzipBytes: 25_910 },
    {
      fileName: 'assets/vendor-objectstack-B.js',
      name: 'vendor-objectstack',
      bytes: 5_000_000,
      gzipBytes: 1_529_129,
    },
    { fileName: 'assets/framework-C.js', name: 'framework', bytes: 1_800_000, gzipBytes: 495_690 },
  ];
  return {
    reportVersion: SUPPORTED_REPORT_VERSION,
    entryChunks: ['assets/index-A.js'],
    eagerChunkCount: files.length,
    totalChunkCount: 507,
    eagerGzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0),
    eagerRawBytes: files.reduce((n, f) => n + f.bytes, 0),
    files,
    ...overrides,
  };
}

/**
 * objectui#5324: the console "performance budget" gzipped one file — the
 * `index-*.js` entry chunk — against a 350 KB line. On `77f846a8b` that chunk
 * is 25.9 KB while the closure it statically pulls in is 3,881,609 bytes across
 * 58 of 507 chunks, so the gate passed on 0.67% of the payload it claimed to
 * govern; the 89 KiB regression of objectui#5266 landed in a vendor chunk and
 * was structurally invisible to it.
 */
describe('the ceiling itself', () => {
  /**
   * Both constraints on the chosen number, as assertions rather than prose.
   * A ceiling below today's payload lands red and gets disabled; a ceiling more
   * than one known regression above it is decorative.
   */
  /** A closure report totalling exactly `gzipBytes`, spread over `chunks` files. */
  function closureOf(gzipBytes: number, chunks = BASELINE.chunks) {
    const files = Array.from({ length: chunks }, (_, i) => ({
      fileName: `assets/chunk-${i}.js`,
      name: `chunk-${i}`,
      bytes: 0,
      gzipBytes: i === 0 ? gzipBytes - (chunks - 1) : 1,
    }));
    return report({
      files,
      eagerChunkCount: chunks,
      totalChunkCount: BASELINE.totalChunks,
      eagerGzipBytes: gzipBytes,
    });
  }

  it('passes on the measured baseline, with headroom', () => {
    expect(MAX_EAGER_CLOSURE_GZIP_BYTES).toBeGreaterThan(BASELINE.gzipBytes);
    expect(evaluateClosureBudget({ report: closureOf(BASELINE.gzipBytes) }).status).toBe('pass');
  });

  /**
   * ⚠️ This pair of assertions is the SECONDARY guard, and objectui#5924 is the
   * record of what it cannot do. Both operands are literals frozen in the
   * checker, so it is true regardless of what the console weighs: it stayed
   * green while the closure fell ~706 KB below the pinned baseline and the live
   * headroom reached 8.6x the regression size. It is kept because it still
   * catches the one thing it can — an edit that raises a ceiling past the
   * regression size, with no build in sight — and it is no longer the only
   * check of this invariant. The live one is `evaluateHeadroomSensitivity`,
   * exercised further down.
   */
  it('would have failed on the regression it exists to catch', () => {
    const headroom = MAX_EAGER_CLOSURE_GZIP_BYTES - BASELINE.gzipBytes;
    expect(headroom).toBeLessThan(REGRESSION_THIS_GATE_MUST_CATCH_BYTES);

    const afterRegression = BASELINE.gzipBytes + REGRESSION_THIS_GATE_MUST_CATCH_BYTES;
    expect(evaluateClosureBudget({ report: closureOf(afterRegression) }).status).toBe('fail');
  });
});

describe('evaluateClosureBudget', () => {
  it('passes a closure inside the budget and names the headroom', () => {
    const result = evaluateClosureBudget({ report: report(), budgetBytes: 3_000_000 });
    expect(result.status).toBe('pass');
    expect(result.gzipBytes).toBe(2_050_729);
    expect(result.chunkCount).toBe(3);
    expect(result.message).toContain('headroom');
  });

  it('fails a closure over the budget and says how far over', () => {
    const result = evaluateClosureBudget({ report: report(), budgetBytes: 2_000_000 });
    expect(result.status).toBe('fail');
    expect(result.message).toContain('over the');
    // A failure must not read as an invitation to widen the number.
    expect(result.message).toContain('do not widen it just to get a green check');
  });

  /**
   * The whole family of "the gauge broke" cases, which all share one shape: the
   * number comes out SMALL, and a budget check reads small as good news. Every
   * one of them must be an error, never a pass.
   */
  describe('refuses a verdict rather than reporting a number it cannot trust', () => {
    it('when the report is absent', () => {
      const result = evaluateClosureBudget({ report: null });
      expect(result.status).toBe('error');
      expect(result.message).toContain('not a passing budget');
      expect(result.gzipBytes).toBeNull();
    });

    it('when the emitter and the checker have drifted apart', () => {
      const result = evaluateClosureBudget({ report: report({ reportVersion: 99 }) });
      expect(result.status).toBe('error');
      expect(result.message).toContain('reportVersion');
    });

    it('when the closure collapsed to its entry chunk — the gauge this replaces', () => {
      const files = [
        { fileName: 'assets/index-A.js', name: 'index', bytes: 90_000, gzipBytes: 25_910 },
      ];
      const result = evaluateClosureBudget({
        report: report({ files, eagerChunkCount: 1, eagerGzipBytes: 25_910 }),
      });
      expect(result.status).toBe('error');
      expect(result.message).toContain('collapsed to its entry chunk');
    });

    it('when every chunk is eager, so nothing separates static from dynamic', () => {
      const result = evaluateClosureBudget({ report: report({ totalChunkCount: 3 }) });
      expect(result.status).toBe('error');
      expect(result.message).toContain('not separating static from dynamic');
    });

    it('when the totals disagree with the chunk list', () => {
      const result = evaluateClosureBudget({ report: report({ eagerGzipBytes: 1 }) });
      expect(result.status).toBe('error');
      expect(result.message).toContain('internally inconsistent');
    });

    it('when the walk had no roots', () => {
      const result = evaluateClosureBudget({ report: report({ entryChunks: [] }) });
      expect(result.status).toBe('error');
      expect(result.message).toContain('no roots');
    });

    it.each([['eagerGzipBytes'], ['eagerChunkCount'], ['totalChunkCount']])(
      'when %s is missing (an absent field must never read as zero)',
      (key) => {
        expect(validateReport(report({ [key]: undefined })).join(' ')).toContain(key);
      },
    );

    it('when the report is not an object at all', () => {
      expect(validateReport('3881609')).toEqual(['report is not an object']);
    });
  });
});

/**
 * objectui#5490 — per-chunk ceilings on top of the aggregate.
 *
 * The aggregate is one number over the whole eager closure: inside its headroom
 * a single chunk can absorb the whole allowance while the others shrink, and the
 * total never moves. objectui#5266 is that shape exactly — 89 KiB, all of it in
 * `vendor-objectstack`. These tests hold the two properties that decide whether
 * the per-chunk half is worth anything: it must be red when a budgeted chunk
 * grows, and it must be red — not silent — when a budgeted chunk is not there
 * to weigh.
 */
describe('per-chunk ceilings', () => {
  /** A v2 report carrying the real budgeted names at the real measured sizes. */
  function budgetedReport(sizes: Record<string, number> = {}) {
    const measured: Record<string, number> = { ...PER_CHUNK_BASELINE, ...sizes };
    const files = [
      { fileName: 'assets/index-A.js', name: 'index', bytes: 0, gzipBytes: 25_910 },
      ...Object.entries(measured).map(([name, gzipBytes]) => ({
        fileName: `assets/${name}-hash.js`,
        name,
        bytes: 0,
        gzipBytes,
      })),
    ];
    return report({
      files,
      eagerChunkCount: files.length,
      eagerGzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0),
      eagerRawBytes: 0,
    });
  }

  describe('the ceilings themselves', () => {
    it('budgets exactly the chunks it has measured', () => {
      // A ceiling with no measurement behind it is a guess; a measurement with
      // no ceiling weighs nothing. Neither may exist alone.
      expect(Object.keys(PER_CHUNK_GZIP_CEILINGS).sort()).toEqual(
        Object.keys(PER_CHUNK_BASELINE).sort(),
      );
      expect(Object.keys(PER_CHUNK_GZIP_CEILINGS).length).toBeGreaterThan(0);
    });

    it.each(Object.keys(PER_CHUNK_GZIP_CEILINGS))(
      '%s passes on its measured size, with headroom narrower than the regression it must catch',
      (name) => {
        const measured = PER_CHUNK_BASELINE[name as keyof typeof PER_CHUNK_BASELINE];
        const ceiling = PER_CHUNK_GZIP_CEILINGS[name as keyof typeof PER_CHUNK_GZIP_CEILINGS];
        // Truthful current state: a ceiling under today's payload lands red on
        // `main`, which is how a budget gets switched off rather than met.
        expect(ceiling).toBeGreaterThan(measured);
        // ...and headroom wider than one known regression makes the line
        // decorative — objectui#5266's 89 KiB landed in one of these chunks.
        expect(ceiling - measured).toBeLessThan(REGRESSION_THIS_GATE_MUST_CATCH_BYTES);
      },
    );

    it('passes on the measured baseline and names every size and headroom', () => {
      const result = evaluatePerChunkBudgets({ report: budgetedReport() });
      expect(result.status).toBe('pass');
      // The verdict carries the MEASUREMENT, not a tick: a reader watching a
      // chunk creep upward should see it coming.
      for (const [name, measured] of Object.entries(PER_CHUNK_BASELINE)) {
        expect(result.message).toContain(name);
        expect(result.message).toContain((measured / 1024).toFixed(1));
      }
      expect(result.message).toContain('headroom');
    });

    it('would have caught objectui#5266 — 89 KiB into a single budgeted chunk', () => {
      const result = evaluatePerChunkBudgets({
        report: budgetedReport({
          'vendor-objectstack':
            PER_CHUNK_BASELINE['vendor-objectstack'] + REGRESSION_THIS_GATE_MUST_CATCH_BYTES,
        }),
      });
      expect(result.status).toBe('fail');
      expect(result.over).toEqual(['vendor-objectstack']);
    });
  });

  it('fails a chunk over its ceiling, naming the chunk and BOTH numbers', () => {
    const over = PER_CHUNK_GZIP_CEILINGS.framework + 1;
    const result = evaluatePerChunkBudgets({ report: budgetedReport({ framework: over }) });
    expect(result.status).toBe('fail');
    expect(result.over).toEqual(['framework']);
    expect(result.message).toContain('framework');
    expect(result.message).toContain((over / 1024).toFixed(1));
    expect(result.message).toContain((PER_CHUNK_GZIP_CEILINGS.framework / 1024).toFixed(1));
    expect(result.message).toContain('do not widen it just to get a green check');
  });

  it('sums chunks sharing a name, so a group cannot split its way under a ceiling', () => {
    const half = Math.ceil((PER_CHUNK_GZIP_CEILINGS['ui-components'] + 2) / 2);
    const base = budgetedReport();
    const files = [
      ...base.files.filter((f) => f.name !== 'ui-components'),
      { fileName: 'assets/ui-components-1.js', name: 'ui-components', bytes: 0, gzipBytes: half },
      { fileName: 'assets/ui-components-2.js', name: 'ui-components', bytes: 0, gzipBytes: half },
    ];
    const result = evaluatePerChunkBudgets({
      report: report({
        files,
        eagerChunkCount: files.length,
        eagerGzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0),
        eagerRawBytes: 0,
      }),
    });
    expect(measureChunksByName({ files }).get('ui-components')?.gzipBytes).toBe(half * 2);
    expect(result.status).toBe('fail');
    expect(result.over).toEqual(['ui-components']);
  });

  /**
   * The clause the whole card turns on: a budget keyed on a chunk that no
   * longer exists is VACUOUSLY GREEN — it passes because it is measuring
   * nothing. Every case here must be an ERROR, never a skip and never a pass.
   */
  describe('refuses to weigh a chunk that is not there', () => {
    it('errors when a budgeted chunk has been renamed, naming it and listing what IS present', () => {
      const base = budgetedReport();
      const files = base.files.map((f) =>
        f.name === 'vendor-objectstack' ? { ...f, name: 'vendor-objectstack-core' } : f,
      );
      const result = evaluatePerChunkBudgets({ report: report({ ...base, files }) });
      expect(result.status).toBe('error');
      expect(result.missing).toEqual(['vendor-objectstack']);
      expect(result.message).toContain('vendor-objectstack');
      expect(result.message).toContain('ABSENT');
      // The new spelling is in the message, so a rename is diagnosable from the
      // failure alone rather than from a second build.
      expect(result.message).toContain('vendor-objectstack-core');
    });

    it('errors when a budgeted chunk has left the closure entirely', () => {
      const base = budgetedReport();
      const files = base.files.filter((f) => f.name !== 'framework');
      const result = evaluatePerChunkBudgets({
        report: report({
          files,
          eagerChunkCount: files.length,
          eagerGzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0),
          eagerRawBytes: 0,
        }),
      });
      expect(result.status).toBe('error');
      expect(result.missing).toEqual(['framework']);
      // Good news is still RE-PINNED deliberately, not inferred by a gate.
      expect(result.message).toContain('RE-PINNED');
    });

    it('errors on a report with no chunks at all — a collapse is not an under-budget bundle', () => {
      const result = evaluatePerChunkBudgets({
        report: report({ files: [], eagerChunkCount: 0, eagerGzipBytes: 0 }),
      });
      expect(result.status).toBe('error');
      expect(measureChunksByName({ files: [] }).size).toBe(0);
    });

    it('errors when no ceilings are configured — an empty budget is a disabled one', () => {
      const result = evaluatePerChunkBudgets({ report: budgetedReport(), ceilings: {} });
      expect(result.status).toBe('error');
      expect(result.message).toContain('weighs nothing');
    });

    it('errors when the report carries no chunk names (a build from before v2)', () => {
      const base = budgetedReport();
      const files = base.files.map(({ name: _name, ...rest }) => rest);
      expect(validateReport(report({ ...base, files })).join(' ')).toContain('no chunk `name`');
      const result = evaluatePerChunkBudgets({ report: report({ ...base, files }) });
      expect(result.status).toBe('error');
    });

    it('errors when there is no report at all — an unbuilt tree measures nothing', () => {
      const result = evaluatePerChunkBudgets({ report: null });
      expect(result.status).toBe('error');
      expect(result.message).toContain('broken gauge');
    });
  });
});

/**
 * objectui#5924 — the headroom invariant, checked against the report the gate
 * just read instead of against two literals frozen beside it.
 *
 * The invariant itself is old and stated in the checker's header: the headroom
 * above the measurement must stay SMALLER than the regression the gate exists
 * to catch, or a repeat of that regression fits inside it and passes. What was
 * new in objectui#5924 is where it was checked. `MAX_EAGER_CLOSURE_GZIP_BYTES -
 * BASELINE.gzipBytes < REGRESSION_...` is an arithmetic fact about the module,
 * true forever once written, and it stayed true while the console shrank ~706
 * KB underneath it — leaving a demonstrated +158,006-byte eager regression
 * green, 1.7x the incident the gate was built for.
 *
 * These tests are about the four ceilings this file now ships (the aggregate
 * plus the three per-chunk lines objectui#5490 added), each weighed against its
 * own measurement in the report.
 */
/**
 * The composition pin (objectui#7399).
 *
 * These ceilings are keyed on chunk NAMES, and until this card nothing checked
 * that a name still described its contents. It did not: `framework`'s group
 * test is `packages/(core|react|types)`, and the emitted `framework` chunk held
 * all ten `packages/i18n` locale catalogues — 78.7% of its bytes — because five
 * workspace groups shared `priority: 80` and `framework` was written first. So
 * `PER_CHUNK_GZIP_CEILINGS['framework']` was in operation a budget on the
 * translation catalogue, with 41 bytes of headroom, and its failure message
 * named the wrong cause.
 *
 * ⚠️ This is deliberately a check on the DECIDING INPUT, not on prose. The
 * config's own comment said `core|react|types` throughout the defect and was
 * true about the regex the whole time; what was false was the assumption that a
 * group only takes what its regex matches. The predicate below is the one that
 * was actually violated — a TIE between a group whose test matches the
 * catalogue and one whose test does not.
 *
 * The byte-level backstop is the re-baselined ceiling itself: `framework` is
 * now pinned at 100,000 over a 72,245 payload, so a regression that puts the
 * 446 KB catalogue back would red the gate four times over. That verdict is
 * loud but mute about the cause. This one names it.
 *
 * ⛔ Every case here fails CLOSED. The parse yielding nothing, or a probe id
 * matching no group at all, is an ERROR and not a pass — a matcher that matches
 * nothing agrees with a correctly-attributed bundle on every assertion below.
 */
describe('chunk attribution (objectui#7399)', () => {
  /** A group as `advancedChunks.groups` declares it. */
  type Group = {
    name: string;
    priority: number;
    test: RegExp | null;
    /**
     * Whatever the group declares AFTER `priority`, verbatim — `''` when it
     * declares nothing. objectui#9345 put an option there
     * (`includeDependenciesRecursively`), and the parse that could not see one
     * did not degrade gracefully: it stopped matching the group ENTIRELY, so
     * every case below quietly lost a subject. Keeping the tail is what lets a
     * pin be written about an option instead of only about a regex.
     */
    options: string;
  };

  /**
   * Parse the groups out of the console's vite config.
   *
   * `test` is `null` for a group whose test is an IDENTIFIER rather than a
   * regex literal (`vendor-objectstack` reads a computed test, so that the
   * `OBJECTSTACK_SPEC_DIST` override cannot change the chunk layout —
   * objectui#5388). Those are refused a verdict below rather than guessed at.
   *
   * ⚠️ The tail is an OPTIONS list and not a bare `}` — a group may carry
   * options AFTER `priority`, and three do: `data-adapter` (objectui#9345),
   * `types-zod` (objectui#10065) and `i18n-runtime` (objectui#10866), each
   * `includeDependenciesRecursively: false`.
   * Requiring the closing brace silently dropped such a group from this table
   * while every case below went on passing, which is the failure this parse's
   * own "matches nothing agrees with everything" note is about: a group this
   * parse cannot see is a group it cannot judge. Both cards met it
   * independently; the tail is captured verbatim as `options` so a pin can be
   * written about the option itself.
   */
  function parseGroups(): Group[] {
    const source = fs.readFileSync(viteConfigPath, 'utf8');
    const entry =
      /\{\s*name:\s*'([^']+)',\s*test:\s*(\/(?:[^/\\\n]|\\.|\[[^\]\n]*\])+\/[a-z]*|[A-Za-z_$][\w$]*)\s*,\s*priority:\s*(\d+)\s*((?:,\s*[A-Za-z_$][\w$]*:\s*[^,{}]+)*)\s*,?\s*\}/g;
    return [...source.matchAll(entry)].map(([, name, test, priority, options]) => {
      const literal = /^\/(.*)\/([a-z]*)$/s.exec(test);
      return {
        name,
        priority: Number(priority),
        test: literal ? new RegExp(literal[1], literal[2]) : null,
        options: (options ?? '').trim(),
      };
    });
  }

  const groups = parseGroups();

  /** Rolldown matches group tests against REALPATHS, measured on objectui#7399. */
  const moduleId = (relative: string) => path.join(repoRoot, relative);

  // ⚠️ A REAL catalogue path, not the invented `zh-CN.ts` this line carried
  // until objectui#7479. The groups are per-code now
  // (`i18n-locale-<code>`), so a probe id that matches no catalogue file would
  // match no group and every case below would fail closed for the wrong reason.
  const LOCALE_MODULE = moduleId('packages/i18n/src/locales/zh.ts');
  const RESIDENT_LOCALE_MODULE = moduleId('packages/i18n/src/locales/en.ts');
  const I18N_RUNTIME_MODULE = moduleId('packages/i18n/src/provider.tsx');
  const DATA_MODULE = moduleId('packages/data-objectstack/src/index.ts');
  const CORE_MODULE = moduleId('packages/core/src/index.ts');
  // objectui#10065's pair: a validator that must leave the eager line, and the
  // `packages/types/src/` neighbour that must NOT go with it — the eager
  // `plugin-grid` chunk reads its runtime values.
  const ZOD_MODULE = moduleId('packages/types/src/zod/objectql.zod.ts');
  const TYPES_SHARED_MODULE = moduleId('packages/types/src/data-display.ts');
  // objectui#12622's carve-out: the record-form date picker, which only an
  // `import()` reaches, leaves `ui-components`.
  const DATE_PICKER_MODULE = moduleId('packages/fields/src/widgets/date-picker/DatePickerField.tsx');

  /** The groups whose test matches this id, highest priority first. */
  function claimants(id: string): Group[] {
    return groups
      .filter((g) => g.test?.test(id))
      .sort((a, b) => b.priority - a.priority);
  }

  describe('the parse itself — a matcher that matches nothing agrees with everything', () => {
    it('finds the whole group table, not a fragment of it', () => {
      // ~35 groups are declared. A reformat that breaks this parse must red
      // here rather than quietly reduce every case below to a tautology.
      expect(groups.length).toBeGreaterThan(20);
      expect(groups.map((g) => g.name)).toEqual(expect.arrayContaining([
        'framework',
        'i18n-locale-en',
        'i18n-locale-zh',
        'i18n-runtime',
        'data-adapter',
        'ui-components',
        'infrastructure',
        // Named here because this group is the one that carries an option
        // after `priority`, so it is the group a narrower parse loses first
        // (objectui#10065).
        'types-zod',
      ]));
    });

    it('reads a control module to the group that owns it', () => {
      expect(claimants(CORE_MODULE)[0]?.name).toBe('framework');
    });

    it('refuses a verdict on a group whose test it could not read', () => {
      // Exactly one group takes a computed test today. A second one appearing
      // reds this case, because such a group could claim the probe ids below
      // without this parse ever seeing it.
      expect(groups.filter((g) => g.test === null).map((g) => g.name)).toEqual([
        'vendor-objectstack',
      ]);
    });
  });

  describe('the defect this pin exists to stop', () => {
    it('`framework`s test matches NEITHER intruder — which is why the config read as correct', () => {
      const framework = groups.find((g) => g.name === 'framework');
      expect(framework?.test?.test(LOCALE_MODULE)).toBe(false);
      expect(framework?.test?.test(DATA_MODULE)).toBe(false);
    });

    it.each([
      ['the lazy locale catalogue', LOCALE_MODULE, 'i18n-locale-zh'],
      ['the resident locale catalogue', RESIDENT_LOCALE_MODULE, 'i18n-locale-en'],
      ['the i18n runtime', I18N_RUNTIME_MODULE, 'i18n-runtime'],
      ['the ObjectStack data adapter', DATA_MODULE, 'data-adapter'],
      ['the zod validators', ZOD_MODULE, 'types-zod'],
      ['the record-form date picker', DATE_PICKER_MODULE, 'fields-date-picker'],
    ])('routes %s to `%s` at a priority `framework` cannot tie', (_what, id, expected) => {
      const framework = groups.find((g) => g.name === 'framework');
      expect(framework).toBeDefined();

      const claiming = claimants(id);
      // Fails closed: no claimant is an error, never a silent pass.
      expect(claiming.length).toBeGreaterThan(0);
      expect(claiming[0].name).toBe(expected);

      // The pin. A TIE is what put the catalogue in `framework`, so equality
      // here is a failure exactly like inversion is.
      expect(claiming[0].priority).toBeGreaterThan(framework!.priority);
    });

    /**
     * objectui#9345 — the half the priority cases above cannot see.
     *
     * Every case in this block asks which group's `test` CLAIMS a module id.
     * That question was answered correctly the whole time `packages/core` was
     * being written into `data-adapter`: rolldown's
     * `includeDependenciesRecursively` (default `true`) also gives a group the
     * modules its captured modules IMPORT, and the priority doc for the same
     * option says those are then removed from the lower-priority groups whose
     * regex does match them. `data-adapter` outranks `framework` and
     * `packages/data-objectstack` imports `@object-ui/core`, so all 92 modules
     * of `packages/core` went to a chunk with no ceiling — while a static read
     * of the group table, and every case above, stayed green.
     *
     * ⇒ the repair is this flag, and this is the pin that stops it being
     * dropped in a reformat. The bundle-level half — the modules actually
     * landed where the config says — is `evaluatePerChunkMembership`, which
     * needs a build; this one reds in a unit run.
     */
    /*
     * objectui#10866 added the second group of this shape: `i18n-runtime`
     * outranks `framework` too, and once `packages/i18n` imported
     * `@object-ui/core` at runtime (its date helpers read a value through
     * `toDisplayDate`) the default carried `core` into it — the membership
     * half of the gate went red on the console build while this table read
     * as correct. A group that comes to outrank `framework` and reach
     * `core` through an import belongs in this list.
     */
    it.each(['data-adapter', 'i18n-runtime'])(
      'narrows `%s` to its own regex, so it cannot absorb `framework`s members',
      (name) => {
        const group = groups.find((g) => g.name === name);
        expect(group).toBeDefined();
        expect(group!.priority).toBeGreaterThan(groups.find((g) => g.name === 'framework')!.priority);
        expect(group!.options).toContain('includeDependenciesRecursively: false');
        // The control: the parse can see an options tail at all, and does not
        // report one where none is written. A tail-blind parse would satisfy the
        // line above by reading `''` from every group.
        expect(groups.find((g) => g.name === 'framework')!.options).toBe('');
      },
    );

    /**
     * objectui#11101 — the same blind spot one option over. Every case above
     * asks which group's `test` CLAIMS a module id, and `vendor-objectstack`'s
     * test claims `@objectstack/spec`'s `/ai` and `/integration` entries as
     * readily as `/ui`. Whether a claimed module is EAGER is not a property of
     * the test at all: the group's chunk is a static import of the entry, so it
     * is eager whatever the source does — which is how two spec entries that
     * only the designers' client validation reaches, through `import()` in
     * `clientValidation.ts`, were on every page load. `tags: ['$initial']`
     * restricts the group to the entry's static closure.
     *
     * ⚠️ This pins the group TABLE. What the tag bought is weighed on a real
     * console build by `scripts/check-eager-closure-budget.mjs`, whose lowered
     * ceiling reds when the tag goes; neither substitutes for the other.
     */
    it('narrows `vendor-objectstack` to the entry`s static closure, so an `import()` stays lazy', () => {
      const group = groups.find((g) => g.name === 'vendor-objectstack');
      expect(group).toBeDefined();
      expect(group!.options).toContain(`tags: ['$initial']`);
      // The control: the parse reads the tag off THIS group, not off every
      // group — a tail-blind or table-wide match would satisfy the line above.
      // objectui#11854 tags `vendor-markdown` the same way, for the same
      // reason, so the exact set names both, in table order.
      expect(groups.filter((g) => g.options.includes('$initial')).map((g) => g.name)).toEqual([
        'vendor-objectstack',
        'vendor-markdown',
      ]);
    });

    it('leaves no second claimant at the winner`s priority', () => {
      for (const id of [LOCALE_MODULE, RESIDENT_LOCALE_MODULE, DATA_MODULE, ZOD_MODULE]) {
        const claiming = claimants(id);
        const top = claiming[0].priority;
        expect(claiming.filter((g) => g.priority === top)).toHaveLength(1);
      }
    });
  });

  /**
   * objectui#10065 — `types-zod` is a SPLIT of the chunk `framework` budgets,
   * so the pin it needs is the one the split can silently lose: the directory
   * leaves, and its `packages/types/src/` neighbours stay.
   *
   * The eager `plugin-grid` chunk reads runtime values out of
   * `data-display.ts` (`ObjectGrid.tsx` imports `normalizeTableColumnType` and
   * `isSystemManagedField` from `@object-ui/types`). If that module travelled
   * with the validators, `plugin-grid` would have to import their chunk
   * statically and all of it would be eager again — measured, that is exactly
   * what rolldown's default `includeDependenciesRecursively` produced, and the
   * saving was zero while the config read as correct.
   *
   * ⚠️ This pins the group TABLE. Whether rolldown honours it is a property of
   * the emitted bundle, weighed by `scripts/vite-types-zod-lazy.ts` on a real
   * console build; neither substitutes for the other.
   */
  it('leaves the validators` `packages/types/src/` neighbours on the eager line', () => {
    // Fails closed in both directions: no claimant at all is an error, and the
    // neighbour landing anywhere but `framework` is the defect.
    const neighbour = claimants(TYPES_SHARED_MODULE);
    expect(neighbour.length).toBeGreaterThan(0);
    expect(neighbour[0].name).toBe('framework');

    // And the reason the priority above is load-bearing rather than cosmetic:
    // `framework`s own regex matches the validator too, so a tie or an
    // inversion hands it straight back.
    const framework = groups.find((g) => g.name === 'framework');
    expect(framework?.test?.test(ZOD_MODULE)).toBe(true);
  });

  it('budgets the chunk the RESIDENT catalogue lands in', () => {
    // A re-attribution that moved the catalogue into a chunk with no ceiling
    // would pass every case above while weakening the gate: the aggregate is
    // the only line left over those bytes, and it is the loosest one.
    expect(PER_CHUNK_GZIP_CEILINGS).toHaveProperty('i18n-locale-en');
    expect(claimants(RESIDENT_LOCALE_MODULE)[0].name).toBe('i18n-locale-en');
  });

  /**
   * The half objectui#7479 added, and the reason the ten groups are ten rather
   * than one: `advancedChunks` groups by MODULE. Ten catalogues in one group
   * are one chunk, and a chunk is eager as soon as ANY of its members is — so a
   * single shared group would have turned nine `import()` boundaries into
   * nothing at all, with every source file still reading correctly.
   *
   * ⚠️ This pins the CONFIG. The bundle-level half is
   * `scripts/check-eager-locale-catalogues.mjs`, which reads the built
   * `eager-closure.json`; neither substitutes for the other, because this one
   * cannot see a bundler that stops honouring the boundary and that one cannot
   * run without a full build.
   */
  it('gives every catalogue a chunk of its OWN — a shared group would re-merge them', () => {
    const CODES = ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'ru', 'ar'];
    const winners = new Map<string, string>();
    for (const code of CODES) {
      const claiming = claimants(moduleId(`packages/i18n/src/locales/${code}.ts`));
      // Fails closed: a catalogue no group claims would be chunked by
      // reachability, which is not a fact this pin may assume.
      expect(claiming.length).toBeGreaterThan(0);
      winners.set(code, claiming[0].name);
    }
    expect([...winners.values()]).toEqual(CODES.map((code) => `i18n-locale-${code}`));
    // The property that matters, stated as itself: ten codes, ten DISTINCT
    // chunk names. Any collision is the shared-group defect above.
    expect(new Set(winners.values()).size).toBe(CODES.length);
  });
});

describe('ceiling sensitivity, judged live (objectui#5924)', () => {
  /**
   * A v2 report totalling exactly `totalGzipBytes`, carrying the budgeted
   * chunks at their measured sizes and the remainder of the closure as one
   * filler chunk — the shape a real report has, where the budgeted names are a
   * minority of the total.
   */
  function sensitivityReport(totalGzipBytes: number, sizes: Record<string, number> = {}) {
    const measured: Record<string, number> = { ...PER_CHUNK_BASELINE, ...sizes };
    const named = [
      { fileName: 'assets/index-A.js', name: 'index', bytes: 0, gzipBytes: 25_910 },
      ...Object.entries(measured).map(([name, gzipBytes]) => ({
        fileName: `assets/${name}-hash.js`,
        name,
        bytes: 0,
        gzipBytes,
      })),
    ];
    const files = [
      ...named,
      {
        fileName: 'assets/rest-of-closure.js',
        name: 'rest-of-closure',
        bytes: 0,
        gzipBytes: totalGzipBytes - named.reduce((n, f) => n + f.gzipBytes, 0),
      },
    ];
    return report({
      files,
      eagerChunkCount: files.length,
      eagerGzipBytes: totalGzipBytes,
      eagerRawBytes: 0,
    });
  }

  /** The ceiling this file shipped before objectui#5924 re-baselined it. */
  const CEILING_BEFORE_5924 = 4_086_000;

  /**
   * The payload objectui#5924 measured, pinned as its own constant.
   *
   * It used to read `BASELINE.gzipBytes`, which made a HISTORICAL incident
   * reproduction track today's measurement: objectui#6683 moved the baseline
   * and the recorded "8.63x" became arithmetic about a moment that never
   * happened. A reproduction of a past reading has to carry that reading.
   */
  const BASELINE_AT_5924 = 3_299_898;

  /**
   * The regression size in force when objectui#5924 measured, pinned for the
   * same reason as the payload above: objectui#12653 raised the live constant
   * to 695 KiB, and the "8.63x" and "1.7x" below are arithmetic about 89 KiB.
   */
  const REGRESSION_AT_5924 = 89 * 1024;

  it('reds on the drift objectui#5924 recorded: 8.6x the regression above the live payload', () => {
    const result = evaluateHeadroomSensitivity({
      report: sensitivityReport(BASELINE_AT_5924),
      budgetBytes: CEILING_BEFORE_5924,
      regressionBytes: REGRESSION_AT_5924,
      // The incident was the aggregate line's alone; today's per-chunk ceilings,
      // weighed against the regression of that day, are not part of it.
      ceilings: {},
    });
    expect(result.status).toBe('error');
    expect(result.blind).toEqual(['aggregate']);
    expect(result.message).toContain('DRIFTED');
    // The multiple, so the failure states HOW blind rather than merely that it is.
    expect(result.message).toContain('8.63x');
    // ...and the constant to lower, so the fix is one named edit.
    expect(result.message).toContain('MAX_EAGER_CLOSURE_GZIP_BYTES');
  });

  it('is the check the frozen-constant assertion structurally could not be', () => {
    // Same moment, same payload, the assertion that was supposed to guard it:
    // the two constants of the day satisfied it comfortably, which is why the
    // suite was green through the run above.
    expect(CEILING_BEFORE_5924 - 4_005_911).toBeLessThan(REGRESSION_THIS_GATE_MUST_CATCH_BYTES);
  });

  it('passes on the constants and the measurement this file ships today', () => {
    const result = evaluateHeadroomSensitivity({ report: sensitivityReport(BASELINE.gzipBytes) });
    expect(result.status).toBe('pass');
    expect(result.blind).toEqual([]);
    // Every ceiling in the file is weighed, not just the aggregate one: the
    // population objectui#5490 grew to four is the population judged here.
    expect(result.sites.map((site) => site.key)).toEqual([
      'aggregate',
      ...Object.keys(PER_CHUNK_GZIP_CEILINGS),
    ]);
    // A passing run still prints every measurement, so a reader watching a
    // ceiling drift upward sees it coming rather than the day it reds. The
    // literal is `BASELINE.gzipBytes` rendered, re-taken each time the baseline
    // moves (objectui#6683 down to 3177.7, objectui#6776 down to 3146.8,
    // objectui#7122 UP to 3468.0 on the authorised raise, objectui#7479 down to
    // 3090.6 when nine locale catalogues left the eager closure, objectui#9251
    // down to 3060.0 when lucide's 1,781-icon record left it, objectui#10996 UP
    // to 3104.5 on the authorised re-pin over `main`'s own drift, objectui#11073
    // UP to 3563.2 on the ruled raise for `@objectstack/*` 17.5.0,
    // objectui#11088 decision 1 = A, objectui#11101 down to 3552.8 on the first
    // payback of that raise, objectui#11438 down to 3306.8 on the second, when
    // `@objectstack/*` 17.6.0's spec root shed its migration chain,
    // objectui#11717 UP to 3506.9 on the ruled raise for `@objectstack/*`
    // 17.7.0, ruling 6027998226, objectui#11798 down to 3338.1 when the Studio
    // builder and the chart engine left the first load, objectui#11854 down to
    // 3296.2 when the markdown highlighter left it, objectui#11939 down to
    // 3160.1 when the built-in designers left it, ruling 6070754914,
    // objectui#12030 down to 3049.3 on objectstack#22044, the payback of the
    // objectui#11717 raise, objectui#13410 down to 3000.1 when the chat UI left
    // the first load) — a rendering derived in the test would agree with the
    // renderer by construction and pin nothing.
    expect(result.message).toContain('3000.1');
  });

  it('is exactly one regression wide, from either side of the line', () => {
    const atTheLine = MAX_EAGER_CLOSURE_GZIP_BYTES - REGRESSION_THIS_GATE_MUST_CATCH_BYTES;
    expect(evaluateHeadroomSensitivity({ report: sensitivityReport(atTheLine + 1) }).status).toBe(
      'pass',
    );
    expect(evaluateHeadroomSensitivity({ report: sensitivityReport(atTheLine) }).status).toBe(
      'error',
    );
  });

  it('judges the per-chunk ceilings too — the population is four ceilings, not one', () => {
    const result = evaluateHeadroomSensitivity({
      report: sensitivityReport(BASELINE.gzipBytes, {
        framework: PER_CHUNK_GZIP_CEILINGS.framework - REGRESSION_THIS_GATE_MUST_CATCH_BYTES,
      }),
    });
    expect(result.status).toBe('error');
    expect(result.blind).toEqual(['framework']);
    expect(result.message).toContain("PER_CHUNK_GZIP_CEILINGS['framework']");
  });

  it('leaves a ceiling BELOW the payload to the size verdict, and says so', () => {
    // Negative headroom is an over-budget bundle. Reporting it here as well
    // would turn one regression into an error and teach a reader that exit 2
    // does not mean what the file says it means.
    const result = evaluateHeadroomSensitivity({
      report: sensitivityReport(MAX_EAGER_CLOSURE_GZIP_BYTES + 500_000),
    });
    expect(result.status).toBe('pass');
    expect(result.message).toContain('the size verdict owns this row');
  });

  it('errors when there is no report — a ceiling with no measurement is not sensitive', () => {
    const result = evaluateHeadroomSensitivity({ report: null });
    expect(result.status).toBe('error');
    expect(result.message).toContain('broken gauge');
  });

  it('errors on a report it cannot trust rather than judging drift from a bad number', () => {
    const result = evaluateHeadroomSensitivity({
      report: { ...sensitivityReport(BASELINE.gzipBytes), reportVersion: 1 },
    });
    expect(result.status).toBe('error');
    expect(result.blind).toEqual([]);
  });

  it('refuses to judge a ceiling whose chunk is absent, instead of reading it as drifted', () => {
    // The wrong-reason trap: a budgeted chunk that is not in the report weighs
    // zero, so its whole ceiling would look like headroom — "drifted", the
    // right exit code for the wrong reason, on a run the per-chunk half already
    // explains correctly.
    const base = sensitivityReport(BASELINE.gzipBytes);
    const files = base.files.filter((f) => f.name !== 'ui-components');
    const result = evaluateHeadroomSensitivity({
      report: report({
        files,
        eagerChunkCount: files.length,
        eagerGzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0),
        eagerRawBytes: 0,
      }),
    });
    expect(result.status).toBe('error');
    expect(result.blind).toEqual([]);
    expect(result.message).toContain('ui-components');
    expect(result.message).toContain('absent');
  });

  /**
   * The acceptance test of objectui#5924, pinned so it cannot quietly come
   * undone. Measured on `48e53814e`: an eager `@objectstack/spec/cloud`
   * namespace import into `apps/console/src/main.tsx` — a use the bundler
   * cannot fold away — put 158,006 gzipped bytes into the eager closure, and
   * removing it returned the measurement to 3,299,898 exactly, so the movement
   * is the injection and not build noise.
   */
  it('the demonstrated regression: green under the old ceiling, and green again since objectui#12653', () => {
    const INJECTED = BASELINE.gzipBytes + 158_006;
    // 1.7x the incident this gate was built to catch.
    expect(INJECTED - BASELINE.gzipBytes).toBeGreaterThan(REGRESSION_AT_5924);

    const injected = sensitivityReport(INJECTED);
    expect(
      evaluateClosureBudget({ report: injected, budgetBytes: CEILING_BEFORE_5924 }).status,
    ).toBe('pass');
    // ⚠️ It was red under every ceiling from objectui#5924 until objectui#12653's
    // 20% raise (maintainer ruling): the aggregate now fails only regressions of
    // about REGRESSION_THIS_GATE_MUST_CATCH_BYTES and above, and this injection
    // fits under it. Pinned so the trade stays visible; this goes red, correctly,
    // the day the ceiling comes back down far enough to catch it again.
    expect(INJECTED - BASELINE.gzipBytes).toBeLessThan(REGRESSION_THIS_GATE_MUST_CATCH_BYTES);
    expect(evaluateClosureBudget({ report: injected }).status).toBe('pass');
  });

  /**
   * ⛔ RETIRED — the lower bound, at the unit level (objectui#10148).
   *
   * objectui#8554 added a second predicate here: a ceiling with less than a
   * tenth of one regression left returned `error`, so a build where nothing had
   * grown past any line exited 2. A maintainer ruling retired it. The ruling,
   * and the in-file prohibition it overrules, are recorded in the checker's own
   * RETIRED block — ⛔ this describe does not restate them, it pins what the
   * half now DOES.
   *
   * ⭐ Every case below carries its own same-subject control in the same call
   * or the one beside it, because "the floor is gone" and "this half stopped
   * judging anything" produce the same green on a one-sided test.
   */
  describe('the lower bound is RETIRED (objectui#10148)', () => {
    /**
     * This card's own reading, turned around. objectui#8554 was filed on
     * `framework` at 70,999 gzipped bytes against a 71,000 ceiling and made it
     * red; the ruling makes it green again.
     */
    const ONE_BYTE_UNDER = {
      report: sensitivityReport(BASELINE.gzipBytes, { framework: 70_999 }),
      ceilings: { ...PER_CHUNK_GZIP_CEILINGS, framework: 71_000 },
    };

    it('passes a ceiling with ONE byte of headroom, and still prints the figure', () => {
      const result = evaluateHeadroomSensitivity(ONE_BYTE_UNDER);
      expect(result.status).toBe('pass');
      expect(result.blind).toEqual([]);
      // ⭐ The reporting the ruling deliberately left in place: the row is still
      // rendered with its headroom, so a reader watching a chunk tighten can
      // still see it. A pass that stopped printing the number would satisfy the
      // ruling and lose what it was careful to keep.
      expect(result.message).toContain('chunk `framework`');
      expect(result.message).toContain('headroom 0.0 KB = 0.00x');
    });

    it('renders that row ✅ — the tick follows the verdict, at this end too', () => {
      expect(evaluateHeadroomSensitivity(ONE_BYTE_UNDER).message).toContain(
        '✅ chunk `framework`',
      );
      expect(evaluateHeadroomSensitivity(ONE_BYTE_UNDER).message).not.toContain(
        '❌ chunk `framework`',
      );
    });

    /**
     * ⭐ THE CONTROL that separates "the floor was removed" from "this half was
     * removed". One call, two rows: `framework` is a hair under its ceiling —
     * the case the ruling made green — while the AGGREGATE ceiling sits more
     * than one whole regression above its payload, which is the blind leg and
     * was ⛔ not ruled on. A half that had stopped judging would pass both.
     */
    it('still ERRORS on the blind leg in the very run the tight row passes', () => {
      const result = evaluateHeadroomSensitivity({
        ...ONE_BYTE_UNDER,
        report: sensitivityReport(BASELINE.gzipBytes - REGRESSION_THIS_GATE_MUST_CATCH_BYTES, {
          framework: 70_999,
        }),
      });
      expect(result.status).toBe('error');
      expect(result.blind).toEqual(['aggregate']);
      expect(result.message).toContain('DRIFTED');
      // The tight row is in the SAME table and is not what fired.
      expect(result.message).toContain('✅ chunk `framework`');
    });

    /**
     * The bound this half never owned, unchanged. A ceiling under its payload is
     * an over-budget bundle; the size verdict owns it and this half says so.
     */
    it('still leaves an OVER-budget ceiling to the size verdict', () => {
      const result = evaluateHeadroomSensitivity({
        report: sensitivityReport(BASELINE.gzipBytes, {
          framework: PER_CHUNK_GZIP_CEILINGS.framework + 1,
        }),
      });
      expect(result.status).toBe('pass');
      expect(result.message).toContain('the size verdict owns this row');
    });

    /**
     * ⛔ The removal is pinned on the SOURCE as well as on the behaviour, and
     * the two answer different questions. The cases above say the floor no
     * longer fires; this one says the ruling that retired it is still written
     * where the next reader meets it. ⭐ A silent deletion leaves a header
     * arguing for a leg that is gone, and the next reader puts it back — which
     * is the failure this card was told to avoid, not a stylistic preference.
     */
    it('records the ruling in the checker, rather than deleting the prohibition', () => {
      const source = fs.readFileSync(checkerPath, 'utf8');
      const at = source.indexOf('RETIRED — the exhausted-headroom leg');
      // Non-vacuity first: a matcher that finds nothing agrees with everything.
      expect(at).toBeGreaterThan(-1);
      const retired = source.slice(at, at + 4_000);

      // The prohibition this change contradicts is QUOTED, not removed.
      expect(retired).toContain('Never lower EXHAUSTED_HEADROOM_FLOOR_MULTIPLE');
      expect(retired).toContain('never add a row');
      // The first utterance, verbatim — its ASCII half is the part a pin can
      // name without restating a ruling in a second place.
      expect(retired).toContain('10148 i18n-locale-en');
      // ⭐ The second utterance is Chinese end to end, so it is pinned by SHAPE
      // rather than by text: a run of CJK inside this block is exactly what a
      // translation or a paraphrase would remove, and translating a ruling is
      // rewriting it.
      expect(retired).toMatch(/[\u4e00-\u9fff]{4,}/u);

      // ⛔ And the constants are gone from the EXECUTABLE surface: every
      // surviving mention above is inside a comment.
      expect(source).not.toContain('export const EXHAUSTED_HEADROOM_FLOOR_MULTIPLE');
      expect(source).not.toContain('export const EXHAUSTED_HEADROOM_ALLOWANCES');
      // The control for that pair of negatives, in the same command: a constant
      // that IS still exported answers the same probe, so a mistyped probe
      // cannot read as a clean removal.
      expect(source).toContain('export const REGRESSION_THIS_GATE_MUST_CATCH_BYTES');
    });
  });
});

/**
 * A membership artifact shaped exactly like `emitChunkMembershipReport`'s
 * output, with every declared package landing exactly where declared: wholly
 * in its declared chunk, or — for a package with a carve-out — its carved
 * subtree in the carve-out's chunk and every other directory in its declared
 * chunk.
 *
 * Built FROM {@link PER_CHUNK_MEMBERSHIP} and
 * {@link PER_CHUNK_MEMBERSHIP_CARVE_OUTS} rather than written out, so a package
 * or a carve-out added to either table cannot be left silently unrepresented
 * here — which would make the pass case pass for a subject nobody checked.
 * `packages` is DERIVED from `directories`, the way the emitter's two tables
 * are filled by the one loop.
 */
function passingMembership(overrides: Record<string, unknown> = {}) {
  const directories: Record<string, Record<string, Record<string, number>>> = {};
  for (const [chunk, pkgs] of Object.entries(PER_CHUNK_MEMBERSHIP)) {
    for (const pkg of pkgs) {
      directories[pkg] = { src: { [chunk]: 12 } };
      for (const carve of carveOutsOf(pkg)) directories[pkg][carve.subtree] = { [carve.chunk]: 5 };
    }
  }
  // A package nothing budgets, present in every real build, so the evaluator is
  // never handed a map containing only its own subjects.
  directories['app-shell'] = { src: { index: 40 }, 'src/views': { 'some-lazy-view': 3 } };
  return {
    membershipReportVersion: 2,
    totalChunkCount: 2_000,
    packages: packageCountsOf(directories),
    directories,
    ...overrides,
  };
}

/** The carve-outs declared for one package, `[]` when it has none. */
function carveOutsOf(pkg: string): readonly { subtree: string; chunk: string }[] {
  return (PER_CHUNK_MEMBERSHIP_CARVE_OUTS as Record<string, readonly { subtree: string; chunk: string }[]>)[pkg] ?? [];
}

/** Sums a `directories` table into the per-package table the artifact also carries. */
function packageCountsOf(directories: Record<string, Record<string, Record<string, number>>>) {
  const packages: Record<string, Record<string, number>> = {};
  for (const [pkg, dirs] of Object.entries(directories)) {
    for (const byChunk of Object.values(dirs)) {
      for (const [chunk, count] of Object.entries(byChunk)) {
        (packages[pkg] ??= {})[chunk] = (packages[pkg][chunk] ?? 0) + count;
      }
    }
  }
  return packages;
}

/**
 * The eager closure the unit cases judge carve-outs against, by chunk name:
 * the four budgeted chunks, the entry, and `data-adapter` — eager and carrying
 * no ceiling, which is exactly the destination a carve-out must never name.
 * `types-zod` is absent, as it is from a real build's closure.
 */
const EAGER_CHUNK_NAMES = Object.freeze([
  'index',
  'vendor-objectstack',
  'i18n-locale-en',
  'framework',
  'ui-components',
  'data-adapter',
]);

/** The evaluator, handed the unit-case eager closure unless a case overrides it. */
function judgeMembership(input: NonNullable<Parameters<typeof evaluatePerChunkMembership>[0]>) {
  return evaluatePerChunkMembership({ eagerChunkNames: EAGER_CHUNK_NAMES, ...input });
}

/**
 * Chunk membership — the half that asks WHERE, not HOW BIG (objectui#9345).
 *
 * ⚠️ Read the error cases as the substance of this block, not as its edges.
 * This half's green state is an ABSENCE — "no declared package was found in a
 * chunk it is not declared for" — and that sentence is equally true of an
 * artifact that attributed nothing, a package that vanished from the bundle,
 * and a declaration pointed at a chunk no ceiling governs. Each of those is
 * pinned below as an ERROR, because each of them would otherwise be a pass
 * bought by measuring less.
 */
describe('chunk membership (objectui#9345)', () => {
  it('passes when every declared package landed exactly where declared', () => {
    const result = judgeMembership({ membership: passingMembership() });
    expect(result.status).toBe('pass');
    // The population, named in the verdict: a green line that does not say what
    // it weighed is indistinguishable from a green line that weighed nothing.
    for (const pkgs of Object.values(PER_CHUNK_MEMBERSHIP)) {
      for (const pkg of pkgs) expect(result.message).toContain(`\`packages/${pkg}\``);
    }
  });

  it('FAILS, naming the package and the chunk that took it, on one stray module', () => {
    // The incident, reduced to its smallest form: `packages/core` split between
    // `framework` and a group whose regex never mentioned it.
    const membership = passingMembership();
    (membership.packages as Record<string, Record<string, number>>).core = {
      framework: 11,
      'data-adapter': 1,
    };
    const result = judgeMembership({ membership });
    expect(result.status).toBe('fail');
    expect(result.message).toContain('`packages/core`');
    expect(result.message).toContain('`data-adapter`');
    expect(result.message).toContain('`framework`');
    // ⛔ The remedy this verdict may never suggest.
    expect(result.message).toContain('Do NOT move a ceiling');
  });

  it('FAILS when the whole package moved, not only when it split', () => {
    const membership = passingMembership();
    (membership.packages as Record<string, Record<string, number>>).core = { 'data-adapter': 92 };
    const result = judgeMembership({ membership });
    expect(result.status).toBe('fail');
    expect(result.message).toContain('0 of its 92 modules landed in `framework`');
  });

  it('is EXACT, not a ratchet — a majority in the right chunk is still a fail', () => {
    // The shape a headroom-bearing pin would wave through, and the one the
    // ruling on objectui#9345 forbids: 99 of 100 modules in place.
    const membership = passingMembership();
    (membership.packages as Record<string, Record<string, number>>).core = {
      framework: 99,
      'plugin-grid': 1,
    };
    expect(judgeMembership({ membership }).status).toBe('fail');
  });

  describe('refuses a verdict rather than passing by measuring nothing', () => {
    it('errors when the artifact is absent', () => {
      const result = judgeMembership({ membership: null });
      expect(result.status).toBe('error');
      expect(result.message).toContain('PREREQUISITE NOT MET');
    });

    it('errors on a version it does not understand', () => {
      const result = judgeMembership({
        membership: passingMembership({ membershipReportVersion: 99 }),
      });
      expect(result.status).toBe('error');
      expect(result.message).toContain('membershipReportVersion');
    });

    it('errors when the artifact attributes no package at all', () => {
      const result = judgeMembership({
        membership: passingMembership({ packages: {} }),
      });
      expect(result.status).toBe('error');
      expect(result.message).toContain('vacuously true');
    });

    it('errors when the bundle it describes has no chunk in it', () => {
      const result = judgeMembership({
        membership: passingMembership({ totalChunkCount: 0 }),
      });
      expect(result.status).toBe('error');
      expect(result.message).toContain('totalChunkCount');
    });

    it('errors when a declared package contributed no module anywhere', () => {
      // ⭐ The case that separates this half from a vacuous one. A package
      // absent from the bundle cannot be in a chunk it should not be in, so the
      // stray scan agrees with everything about it.
      const membership = passingMembership();
      delete (membership.packages as Record<string, unknown>).core;
      const result = judgeMembership({ membership });
      expect(result.status).toBe('error');
      expect(result.message).toContain('contributed no module');
      expect(result.message).toContain('`packages/core`');
    });

    it('errors when a declared package is present but attributed to nothing', () => {
      const membership = passingMembership();
      (membership.packages as Record<string, Record<string, number>>).core = {};
      expect(judgeMembership({ membership }).status).toBe('error');
    });

    it('errors when the declaration names a chunk no ceiling governs', () => {
      const result = judgeMembership({
        membership: passingMembership(),
        declaration: { 'data-adapter': ['data-objectstack'] },
      });
      expect(result.status).toBe('error');
      expect(result.message).toContain('PER_CHUNK_GZIP_CEILINGS');
    });
  });

  /**
   * objectui#10065 split `packages/types` on purpose — `src/zod/**` to the lazy
   * `types-zod`, the rest to `framework` — and this block pins that the split
   * is held EXACTLY, to the directory, in both directions.
   *
   * ⭐ The first FAIL case is the failure the split was measured to produce on
   * its own first build: three shared `src/` neighbours absorbed into
   * `types-zod` along an import. At package granularity that reads as
   * "types landed in `framework` and `types-zod`" — the healthy split. Only the
   * directory counts tell it apart, which is why a carved package is judged on
   * them.
   */
  describe('the declared `packages/types` split (objectui#10065)', () => {
    /** The artifact with `packages/types`' directories replaced, `packages` re-derived. */
    function withTypes(dirs: Record<string, Record<string, number>>) {
      const membership = passingMembership();
      const directories = membership.directories as Record<
        string,
        Record<string, Record<string, number>>
      >;
      directories.types = dirs;
      membership.packages = packageCountsOf(directories);
      return membership;
    }

    it('is declared, not dropped: `types` stays in `framework` with ONE carve-out', () => {
      expect(PER_CHUNK_MEMBERSHIP.framework).toContain('types');
      expect(PER_CHUNK_MEMBERSHIP_CARVE_OUTS).toEqual({
        types: [{ subtree: 'src/zod', chunk: 'types-zod' }],
        fields: [{ subtree: 'src/widgets/date-picker', chunk: 'fields-date-picker' }],
      });
    });

    it('passes the ruled split and names both sides of it', () => {
      const result = judgeMembership({
        membership: withTypes({ src: { framework: 40 }, 'src/zod': { 'types-zod': 9 } }),
      });
      expect(result.status).toBe('pass');
      expect(result.message).toContain(
        '`packages/types` 40 modules in `framework` and its `src/zod` subtree 9 in `types-zod`, exactly',
      );
    });

    it('holds the subtree at ANY depth, not only its top directory', () => {
      const result = judgeMembership({
        membership: withTypes({
          src: { framework: 40 },
          'src/zod': { 'types-zod': 9 },
          'src/zod/nested': { 'types-zod': 2 },
        }),
      });
      expect(result.status).toBe('pass');
      expect(result.message).toContain('subtree 11 in `types-zod`');
    });

    it('FAILS when shared `src/` modules ride into `types-zod` with the validators', () => {
      const result = judgeMembership({
        membership: withTypes({
          src: { framework: 37, 'types-zod': 3 },
          'src/zod': { 'types-zod': 9 },
        }),
      });
      expect(result.status).toBe('fail');
      expect(result.message).toContain(
        '`packages/types/src` 3 in `types-zod` (declared `framework`)',
      );
    });

    it('FAILS when the validators are back on the eager `framework` line', () => {
      const result = judgeMembership({
        membership: withTypes({ src: { framework: 40 }, 'src/zod': { framework: 9 } }),
      });
      expect(result.status).toBe('fail');
      expect(result.message).toContain(
        '`packages/types/src/zod` 9 in `framework` (declared `types-zod`)',
      );
    });

    it('FAILS on a subtree that split across two chunks — one stray is a finding', () => {
      const result = judgeMembership({
        membership: withTypes({
          src: { framework: 40 },
          'src/zod': { 'types-zod': 8, 'plugin-map': 1 },
        }),
      });
      expect(result.status).toBe('fail');
      expect(result.message).toContain('`packages/types/src/zod` 1 in `plugin-map`');
    });

    /**
     * ⭐ The mis-declaration the old, wholesale pin amounts to on today's
     * bundle: with the carve-out gone, the ruled split IS a stray. This is the
     * pin firing on its own declaration rather than on the bundle.
     */
    it('FAILS the ruled split when the carve-out is not declared', () => {
      const result = judgeMembership({
        membership: withTypes({ src: { framework: 40 }, 'src/zod': { 'types-zod': 9 } }),
        carveOuts: {},
      });
      expect(result.status).toBe('fail');
      expect(result.message).toContain('`packages/types` is declared in `framework` but 9 in `types-zod`');
    });

    describe('refuses a carve-out it cannot check, rather than reading it', () => {
      it('errors when the carve-out chunk is EAGER and carries no ceiling', () => {
        // objectui#9345's incident, written down as though it were a ruling.
        const result = judgeMembership({
          membership: passingMembership(),
          carveOuts: { core: [{ subtree: 'src', chunk: 'data-adapter' }] },
        });
        expect(result.status).toBe('error');
        expect(result.message).toContain('`packages/core/src` is carved into `data-adapter`');
        expect(result.message).toContain('EAGER');
      });

      it('errors on the live carve-out once `types-zod` joins the eager closure', () => {
        const result = judgeMembership({
          membership: passingMembership(),
          eagerChunkNames: [...EAGER_CHUNK_NAMES, 'types-zod'],
        });
        expect(result.status).toBe('error');
        expect(result.message).toContain('`packages/types/src/zod` is carved into `types-zod`');
        // Control, same artifact, same declaration: the closure the build
        // actually produces admits it.
        expect(judgeMembership({ membership: passingMembership() }).status).toBe('pass');
      });

      it('errors when the eager closure could not be read at all', () => {
        const result = judgeMembership({ membership: passingMembership(), eagerChunkNames: null });
        expect(result.status).toBe('error');
        expect(result.message).toContain('could not read the eager closure');
      });

      it('errors on a carve-out of a package no budgeted chunk declares', () => {
        const result = judgeMembership({
          membership: passingMembership(),
          carveOuts: { ...PER_CHUNK_MEMBERSHIP_CARVE_OUTS, 'app-shell': [{ subtree: 'src/views', chunk: 'some-lazy-view' }] },
        });
        expect(result.status).toBe('error');
        expect(result.message).toContain('`packages/app-shell` has a carve-out but no budgeted chunk');
      });

      it('errors on a carve-out into the package`s own declared chunk', () => {
        const result = judgeMembership({
          membership: passingMembership(),
          carveOuts: { types: [{ subtree: 'src/zod', chunk: 'framework' }] },
        });
        expect(result.status).toBe('error');
        expect(result.message).toContain('a carve-out that moves nothing');
      });

      it.each([
        ['an absolute path', '/src/zod'],
        ['a trailing slash', 'src/zod/'],
        ['the whole package', '.'],
        ['a parent hop', 'src/../zod'],
      ])('errors on a subtree written as %s', (_what, subtree) => {
        const result = judgeMembership({
          membership: passingMembership(),
          carveOuts: { types: [{ subtree, chunk: 'types-zod' }] },
        });
        expect(result.status).toBe('error');
        expect(result.message).toContain('not a package-relative directory');
      });

      it('errors on two carve-outs that nest', () => {
        const result = judgeMembership({
          membership: passingMembership(),
          carveOuts: {
            types: [
              { subtree: 'src/zod', chunk: 'types-zod' },
              { subtree: 'src/zod/deep', chunk: 'plugin-map' },
            ],
          },
        });
        expect(result.status).toBe('error');
        expect(result.message).toContain('which nest');
      });
    });

    describe('refuses a split it cannot weigh, rather than passing it', () => {
      it('errors when the carved subtree holds no module in the bundle', () => {
        const result = judgeMembership({ membership: withTypes({ src: { framework: 40 } }) });
        expect(result.status).toBe('error');
        expect(result.message).toContain(
          'the carve-out `packages/types/src/zod` -> `types-zod` matched no module',
        );
      });

      it('errors when nothing OUTSIDE the carve-out landed anywhere', () => {
        const result = judgeMembership({ membership: withTypes({ 'src/zod': { 'types-zod': 9 } }) });
        expect(result.status).toBe('error');
        expect(result.message).toContain('outside its carve-out(s) contributed no module');
      });

      it('errors when the artifact carries no directory table for the carved package', () => {
        const membership = passingMembership();
        delete (membership.directories as Record<string, unknown>).types;
        const result = judgeMembership({ membership });
        expect(result.status).toBe('error');
        expect(result.message).toContain('no directory attribution');
      });

      it('errors when the two tables in one artifact disagree', () => {
        const membership = withTypes({ src: { framework: 40 }, 'src/zod': { 'types-zod': 9 } });
        (membership.packages as Record<string, Record<string, number>>).types = {
          framework: 40,
          'types-zod': 8,
        };
        const result = judgeMembership({ membership });
        expect(result.status).toBe('error');
        expect(result.message).toContain('do not add up');
      });

      it('refuses a v1 artifact, which carries no directories at all', () => {
        const result = judgeMembership({
          membership: passingMembership({ membershipReportVersion: 1 }),
        });
        expect(result.status).toBe('error');
        expect(result.message).toContain('membershipReportVersion 1, expected 2');
      });
    });
  });

  describe('the declaration itself', () => {
    it('names only chunks that carry a per-chunk ceiling', () => {
      for (const chunk of Object.keys(PER_CHUNK_MEMBERSHIP)) {
        expect(PER_CHUNK_GZIP_CEILINGS).toHaveProperty(chunk);
      }
      // Non-vacuity: the live table is not empty, and an invented key is still
      // not a budgeted chunk.
      expect(Object.keys(PER_CHUNK_MEMBERSHIP).length).toBeGreaterThan(0);
      expect(PER_CHUNK_GZIP_CEILINGS).not.toHaveProperty('a-chunk-nothing-budgets');
    });

    /**
     * ⭐ The cross-check that keeps this declaration from becoming a second
     * opinion about the console config. Each package name below must be matched
     * by the `test` of the group it is declared under — the same regex rolldown
     * itself matches — so a group whose regex is narrowed without updating this
     * table reds here rather than going quietly out of date.
     */
    it('declares only packages the group`s own regex claims', () => {
      const source = fs.readFileSync(viteConfigPath, 'utf8');
      for (const [chunk, pkgs] of Object.entries(PER_CHUNK_MEMBERSHIP)) {
        // ⚠️ Anchored on `priority:` deliberately. Without a terminator the
        // alternation inside the test literal stops at the first `/` of a
        // `[\\/]` class and hands back a truncated, INVALID regex — a parse
        // that throws rather than one that lies, but a parse that reads
        // nothing all the same.
        const declaration = new RegExp(
          String.raw`\{\s*name:\s*'${chunk}',\s*test:\s*(/(?:[^/\\\n]|\\.|\[[^\]\n]*\])+/[a-z]*)\s*,\s*priority:`,
        ).exec(source);
        // Fails closed: a group this parse cannot find is an error, not a pass.
        expect(declaration, `no regex-tested group named \`${chunk}\` in the console config`)
          .not.toBeNull();
        const literal = /^\/(.*)\/([a-z]*)$/s.exec(declaration![1])!;
        const test = new RegExp(literal[1], literal[2]);
        for (const pkg of pkgs) {
          expect(
            test.test(path.join(repoRoot, `packages/${pkg}/src/index.ts`)),
            `\`${chunk}\` is declared to hold packages/${pkg}, but its own test does not match it`,
          ).toBe(true);
        }
        // The must-miss control, so a regex that matched everything could not
        // satisfy the loop above.
        expect(test.test(path.join(repoRoot, 'packages/not-a-real-package/src/index.ts'))).toBe(
          false,
        );
      }
    });

    /**
     * ⭐ The same cross-check for the EXCEPTIONS, and it has more to prove: a
     * carve-out is only true of the bundle if rolldown can actually do it. So
     * against the console config's own group table, for every carve-out:
     *
     *   - the carve-out group's test matches the subtree (it can take it);
     *   - the declared chunk's test matches the subtree TOO (or this is not a
     *     carve FROM that chunk, just another package);
     *   - the carve-out group outranks the declared chunk (or it loses the tie);
     *   - it declares `includeDependenciesRecursively: false` (or it takes the
     *     subtree's imports as well, which is the measured failure);
     *   - and — the must-miss control — its test does NOT match the rest of the
     *     package, so a regex that matched the whole package could not pass.
     */
    it('carves only what the carve-out group`s own regex takes, from a group it outranks', () => {
      const source = fs.readFileSync(viteConfigPath, 'utf8');
      const groupNamed = (name: string) => {
        const found = new RegExp(
          String.raw`\{\s*name:\s*'${name}',\s*test:\s*(/(?:[^/\\\n]|\\.|\[[^\]\n]*\])+/[a-z]*)\s*,\s*priority:\s*(\d+)\s*((?:,\s*[A-Za-z_$][\w$]*:\s*[^,{}]+)*)`,
        ).exec(source);
        expect(found, `no regex-tested group named \`${name}\` in the console config`).not.toBeNull();
        const literal = /^\/(.*)\/([a-z]*)$/s.exec(found![1])!;
        return {
          test: new RegExp(literal[1], literal[2]),
          priority: Number(found![2]),
          options: found![3],
        };
      };
      const homeOf = new Map<string, string>();
      for (const [chunk, pkgs] of Object.entries(PER_CHUNK_MEMBERSHIP)) {
        for (const pkg of pkgs) homeOf.set(pkg, chunk);
      }
      const carves = Object.entries(PER_CHUNK_MEMBERSHIP_CARVE_OUTS);
      // Non-vacuity: the loop below has a subject.
      expect(carves.length).toBeGreaterThan(0);
      for (const [pkg, list] of carves) {
        const home = homeOf.get(pkg);
        expect(home, `packages/${pkg} is carved but declared nowhere`).toBeDefined();
        const homeGroup = groupNamed(home!);
        for (const { subtree, chunk } of list) {
          const carveGroup = groupNamed(chunk);
          const inside = path.join(repoRoot, `packages/${pkg}/${subtree}/index.ts`);
          const outside = path.join(repoRoot, `packages/${pkg}/src/index.ts`);
          expect(subtree).not.toBe('src');
          expect(carveGroup.test.test(inside), `\`${chunk}\` does not match packages/${pkg}/${subtree}`).toBe(true);
          expect(homeGroup.test.test(inside), `\`${home}\` never claimed packages/${pkg}/${subtree}`).toBe(true);
          expect(carveGroup.priority).toBeGreaterThan(homeGroup.priority);
          expect(carveGroup.options).toContain('includeDependenciesRecursively: false');
          expect(carveGroup.test.test(outside), `\`${chunk}\` also takes the rest of packages/${pkg}`).toBe(false);
          expect(homeGroup.test.test(outside)).toBe(true);
        }
      }
    });
  });
});

describe('renderTopChunks', () => {
  it('names the biggest eager chunks so a failure has suspects', () => {
    const lines = renderTopChunks(report(), 2).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('vendor-objectstack-B.js');
    expect(lines[1]).toContain('framework-C.js');
  });

  it('does not throw on a report with no chunk list', () => {
    expect(renderTopChunks({})).toBe('');
  });
});

describe('main', () => {
  /**
   * Hermetic by construction: `main`'s environment is INJECTED here, never
   * inherited from the process.
   *
   * objectui#6245 — `main(argv, env = process.env)` is the right PRODUCTION
   * default, but a test that leans on it is measuring the machine it runs on.
   * `GITHUB_EVENT_NAME=pull_request` is ambient inside GitHub Actions, so this
   * helper omitting `env` silently switched the ceiling-freshness half ON in
   * CI — where its two source paths are unset, so the half correctly returned
   * `error` and `main` correctly returned 2, into four assertions written when
   * 0 and 1 were the only outcomes it could produce. Every one of them passed
   * locally, for the single reason that proves nothing: the variable happened
   * not to be set.
   *
   * `GITHUB_EVENT_NAME` is absent from the injected object ON PURPOSE — that is
   * what makes these cases exercise the non-pull_request path deterministically
   * instead of by luck. Pass it through `env` to opt a case in.
   */
  function run(
    reportBody: unknown,
    env: Record<string, string> = {},
    membershipBody: unknown = passingMembership(),
  ) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-budget-'));
    const reportPath = path.join(dir, 'eager-closure.json');
    const outputPath = path.join(dir, 'github-output');
    if (reportBody !== undefined) fs.writeFileSync(reportPath, JSON.stringify(reportBody));
    // Written into the SAME directory on purpose — that is the production
    // relationship between the two artifacts, and `main` derives one path from
    // the other. `undefined` opts a case out, which is the absent-artifact
    // case rather than a shortcut.
    if (membershipBody !== undefined) {
      fs.writeFileSync(
        path.join(dir, 'chunk-membership.json'),
        JSON.stringify(membershipBody),
      );
    }
    try {
      const code = main(['--report', reportPath], { GITHUB_OUTPUT: outputPath, ...env });
      const outputs = Object.fromEntries(
        fs
          .readFileSync(outputPath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => line.split('=') as [string, string]),
      );
      return { code, outputs };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * The guard for the defect above, and it has to be a TEST rather than a note
   * in the helper: the failure is invisible on a developer machine and appears
   * only inside Actions, which is the worst place to find it — on the next
   * person's unrelated PR. Setting the variable here reproduces CI's ambient
   * environment in-process, so if `run()` ever goes back to inheriting
   * `process.env` this reds locally, immediately, on the change that caused it.
   */
  it('is unaffected by an ambient GITHUB_EVENT_NAME, the way Actions sets it', () => {
    const previous = process.env.GITHUB_EVENT_NAME;
    process.env.GITHUB_EVENT_NAME = 'pull_request';
    try {
      const { code, outputs } = run(budgeted());
      expect(code).toBe(0);
      // The freshness half must stay dormant. This run injects no base-branch
      // sources, so an ACTIVE half would correctly report `error` and exit 2 —
      // precisely how the ambient variable turned four green assertions red.
      expect(outputs.closure_freshness_status).toBe('');
    } finally {
      if (previous === undefined) delete process.env.GITHUB_EVENT_NAME;
      else process.env.GITHUB_EVENT_NAME = previous;
    }
  });

  // `budgeted()` rather than the bare `report()` fixture: since objectui#5490
  // the checker weighs BOTH halves, and a report missing the budgeted chunks is
  // an error — which is the per-chunk half working, not a fixture detail.
  it('exits 0 and publishes the measurement when within budget', () => {
    const fixture = budgeted();
    const { code, outputs } = run(fixture);
    expect(code).toBe(0);
    expect(outputs.closure_status).toBe('pass');
    // DERIVED from the fixture, not retyped. This was the literal `'5'`, which
    // counted the budgeted chunks plus `index` and `rest-of-closure` — so
    // objectui#7399 adding a fourth per-chunk ceiling reddened an assertion
    // about the FIXTURE while the gate under test behaved correctly. The number
    // this case is actually about is "the report's chunk count, echoed".
    expect(outputs.closure_chunks).toBe(String(fixture.files.length));
    expect(outputs.closure_gzip_kb).toBe('3000.1');
  });

  it('exits 1 — a verdict about the BUNDLE — when over budget', () => {
    const { code, outputs } = run(report({ eagerGzipBytes: 9_000_000, files: [
      { fileName: 'assets/huge.js', name: 'huge', bytes: 30_000_000, gzipBytes: 9_000_000 },
    ], eagerChunkCount: 1, totalChunkCount: 507 }));
    // eagerChunkCount 1 is itself refused, so this run proves the ORDER: a
    // report that cannot be trusted is an error even when it is also over.
    expect(code).toBe(2);
    expect(outputs.closure_status).toBe('error');
  });

  it('exits 1 with a real over-budget report', () => {
    // Every per-chunk ceiling holds and the TOTAL is still over: the aggregate
    // half is not made redundant by the per-chunk one — bytes can also arrive
    // spread across chunks nobody budgets.
    const base = budgeted();
    const files = [
      ...base.files,
      { fileName: 'assets/huge.js', name: 'huge', bytes: 30_000_000, gzipBytes: MAX_EAGER_CLOSURE_GZIP_BYTES },
    ];
    const { code, outputs } = run(
      report({
        files,
        eagerChunkCount: files.length,
        eagerGzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0),
        eagerRawBytes: 0,
      }),
    );
    expect(code).toBe(1);
    expect(outputs.closure_status).toBe('fail');
    expect(outputs.closure_chunk_status).toBe('pass');
    expect(outputs.closure_gzip_kb).not.toBe('');
  });

  /**
   * A v2 report at the measured per-chunk sizes, totalling `BASELINE.gzipBytes`
   * plus `totalDelta`.
   *
   * ⚠️ The filler chunk is not padding. Before objectui#5924 this fixture
   * carried only the budgeted names, so its total was ~1.8 MB against a 3.3 MB
   * ceiling — a shape `main` now (correctly) calls a BLIND ceiling and exits 2
   * on. A report whose total sits far below the aggregate line is not a
   * within-budget bundle to be asserted `pass`; it is the defect this card
   * fixed. So the fixture carries the rest of the closure, as a real report
   * does, and `totalDelta` is how a test moves the total on purpose.
   */
  function budgeted(sizes: Record<string, number> = {}, totalDelta = 0) {
    const measured: Record<string, number> = { ...PER_CHUNK_BASELINE, ...sizes };
    const named = [
      { fileName: 'assets/index-A.js', name: 'index', bytes: 0, gzipBytes: 25_910 },
      ...Object.entries(measured).map(([name, gzipBytes]) => ({
        fileName: `assets/${name}-hash.js`,
        name,
        bytes: 0,
        gzipBytes,
      })),
    ];
    // Derived from the BASELINE sizes, not from `named`, so an override in
    // `sizes` moves the total the way a real chunk growing would.
    const baselineNamed =
      25_910 + Object.values(PER_CHUNK_BASELINE).reduce((n, bytes) => n + bytes, 0);
    const files = [
      ...named,
      {
        fileName: 'assets/rest-of-closure.js',
        name: 'rest-of-closure',
        bytes: 0,
        gzipBytes: BASELINE.gzipBytes - baselineNamed + totalDelta,
      },
    ];
    return report({
      files,
      eagerChunkCount: files.length,
      eagerGzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0),
      eagerRawBytes: 0,
    });
  }

  it('exits 0 and publishes both verdicts when every budget holds', () => {
    const { code, outputs } = run(budgeted());
    expect(code).toBe(0);
    expect(outputs.closure_status).toBe('pass');
    expect(outputs.closure_chunk_status).toBe('pass');
  });

  /**
   * The reason this half exists, as one run: the TOTAL is inside the aggregate
   * ceiling — the aggregate half is green — and a single chunk has still grown
   * past its own line. Before objectui#5490 that run exited 0.
   */
  it('exits 1 when one chunk is over its ceiling while the aggregate is green', () => {
    // The chunk grows past its line while the rest of the closure shrinks by
    // the same bytes, so the TOTAL stays on the baseline — the shape the
    // per-chunk header names: one chunk grows by the whole allowance while the
    // others shrink. Without the offset the total rode on the aggregate
    // headroom, and when objectui#11854 lowered the aggregate ceiling the
    // chunk's overage alone was larger than that headroom, so the aggregate
    // went red too and the run stopped testing what its name says.
    const over = PER_CHUNK_GZIP_CEILINGS['vendor-objectstack'] + 1;
    const { code, outputs } = run(
      budgeted({ 'vendor-objectstack': over }, -(over - PER_CHUNK_BASELINE['vendor-objectstack'])),
    );
    expect(code).toBe(1);
    expect(outputs.closure_status).toBe('pass');
    expect(outputs.closure_chunk_status).toBe('fail');
  });

  it('exits 2 when a budgeted chunk is absent — measuring nothing is not passing', () => {
    const base = budgeted();
    const files = base.files.filter((f) => f.name !== 'ui-components');
    const { code, outputs } = run(
      report({
        files,
        eagerChunkCount: files.length,
        eagerGzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0),
        eagerRawBytes: 0,
      }),
    );
    expect(code).toBe(2);
    // The aggregate half is perfectly happy — which is precisely why the
    // per-chunk half may not be silent about it.
    expect(outputs.closure_status).toBe('pass');
    expect(outputs.closure_chunk_status).toBe('error');
  });

  /**
   * objectui#5924: the run that used to be the file's blind spot. Both size
   * halves are delighted — nothing is over any line — and the gate still has to
   * stop, because neither of those green ticks means anything at this distance.
   */
  it('exits 2 when a ceiling has drifted out of range of the regression it must catch', () => {
    const { code, outputs } = run(budgeted({}, -REGRESSION_THIS_GATE_MUST_CATCH_BYTES));
    expect(code).toBe(2);
    expect(outputs.closure_status).toBe('pass');
    expect(outputs.closure_chunk_status).toBe('pass');
    expect(outputs.closure_headroom_status).toBe('error');
  });

  /**
   * objectui#10148 — the RETIRED exhausted-headroom leg, pinned on the
   * BEHAVIOUR rather than on the absence of a constant.
   *
   * ⭐ This pair is one fixture apart, on the SAME chunk and the same ceiling:
   * `framework` one byte UNDER its line, and `framework` one byte OVER it. A
   * pin written against the constant's absence would pass the moment the
   * identifier was deleted, whatever the gate then did with either fixture —
   * which is how a removal takes the budget out with the leg it was aimed at.
   *
   * Before this card the under-by-one fixture exited 2: every size line in the
   * file was satisfied and the exhausted leg alone produced the code. The
   * maintainer retired that leg (the ruling is quoted in this file's header
   * and in the checker's), so the same fixture is now a pass — and the
   * over-by-one fixture below is what proves the budget did not leave with it.
   *
   * ⚠️ Both fixtures hold the AGGREGATE at `BASELINE`: the bytes `framework`
   * gains come out of the rest of the closure. "Every size line in the file
   * was satisfied" has to hold by construction, not by which headroom happens
   * to be wider. It used to hold by the latter, and objectui#11101 ended that:
   * the first payback of the 17.5.0 raise lowered the aggregate line by
   * exactly what it recovered, which left the aggregate's constant headroom
   * narrower than `framework`'s, so growing `framework` to its line on top of
   * an unchanged rest crossed the AGGREGATE line first, and this pair is about
   * the per-chunk one.
   */
  const frameworkAt = (bytes: number) =>
    budgeted({ framework: bytes }, PER_CHUNK_BASELINE.framework - bytes);

  it('exits 0 when a chunk sits just UNDER its ceiling — merely close is not a verdict', () => {
    const { code, outputs } = run(frameworkAt(PER_CHUNK_GZIP_CEILINGS.framework - 1));
    expect(code).toBe(0);
    expect(outputs.closure_status).toBe('pass');
    expect(outputs.closure_chunk_status).toBe('pass');
    // The sensitivity half still runs and still publishes: its BLIND leg — a
    // ceiling that has drifted more than one regression ABOVE its payload — is
    // untouched by this card, which is why `.github/workflows/`'s
    // `BUDGET_CLOSURE_HEADROOM_STATUS` still reads a value that exists.
    expect(outputs.closure_headroom_status).toBe('pass');
  });

  /**
   * ⭐ THE CONTROL, and it is the half of this pair that can fail for the wrong
   * reason. It reds before this card and after it: one byte the other side of
   * the same line is a size regression, the per-chunk half owns it, and exit 1
   * is a verdict about the BUNDLE. A run where both of these pass is the only
   * one that distinguishes "the headroom leg was removed" from "the budget was
   * removed".
   */
  it('still exits 1 when that same chunk goes OVER the same ceiling — the budget stays', () => {
    const { code, outputs } = run(frameworkAt(PER_CHUNK_GZIP_CEILINGS.framework + 1));
    expect(code).toBe(1);
    expect(outputs.closure_status).toBe('pass');
    expect(outputs.closure_chunk_status).toBe('fail');
  });

  /**
   * The ordering objectui#5490 established over two halves, held over three:
   * `error` outranks `fail`, whichever half noticed. `performance-budget.yml`
   * maps exit 2 to `budget_status=error` and any other non-zero to `fail`, so
   * collapsing this to 1 would report a gauge that cannot be trusted as a size
   * regression.
   */
  it('reports the GAUGE verdict when one ceiling is blind and another is over', () => {
    const { code, outputs } = run(
      // The total is pulled down by the chunk's overshoot plus one regression,
      // so the aggregate is blind whatever the constants of the day are.
      budgeted(
        { 'vendor-objectstack': PER_CHUNK_GZIP_CEILINGS['vendor-objectstack'] + 1 },
        -(
          PER_CHUNK_GZIP_CEILINGS['vendor-objectstack'] + 1 -
          PER_CHUNK_BASELINE['vendor-objectstack']
        ) - REGRESSION_THIS_GATE_MUST_CATCH_BYTES,
      ),
    );
    expect(code).toBe(2);
    expect(outputs.closure_chunk_status).toBe('fail');
    expect(outputs.closure_headroom_status).toBe('error');
  });

  it('exits 2 on a report from a build that predates per-chunk names', () => {
    const base = budgeted();
    const { code, outputs } = run({ ...base, reportVersion: 1 });
    expect(code).toBe(2);
    expect(outputs.closure_status).toBe('error');
    expect(outputs.closure_chunk_status).toBe('error');
  });

  it('exits 2 — a verdict about the GAUGE — when there is no report', () => {
    const { code, outputs } = run(undefined);
    expect(code).toBe(2);
    expect(outputs.closure_status).toBe('error');
    // The keys are published EMPTY, never as a number: the renderer's
    // "not measured" branch keys off exactly that emptiness, and a stale
    // number here would render as a verdict about a bundle nobody weighed.
    expect(outputs.closure_gzip_kb).toBe('');
    expect(outputs.closure_chunks).toBe('');
  });

  /**
   * objectui#9006 — the fold used to enumerate only the statuses that FAIL:
   *
   *     if (statuses.includes('error')) return 2;
   *     return statuses.includes('fail') ? 1 : 0;
   *
   * so a status NEITHER test names fell through to `0` — while the printer,
   * which asks a different question (`status === 'pass'`), rendered that same
   * value as ❌. A run could print a red cross and exit 0, which is quieter
   * than either half of the rule this file argues for: a check that passes by
   * measuring nothing must be LOUDER than one that fails by measuring
   * something, never quieter.
   *
   * ⚠️ These cases live HERE, and not only in the gate's own workflows, on
   * purpose. `docs-route-eager-closure.yml` and `performance-budget.yml` are
   * not among this repo's required merge-queue contexts, so a regression in
   * the fold would not block a merge through the gate's own job. This file
   * runs inside `Test (shard N/16)`, whose verdict is required through the
   * `Test` aggregator since objectui#9499 (objectui#9098 landed
   * the same reasoning one card earlier).
   */
  describe('the fold recognises exactly the statuses the halves declare (objectui#9006)', () => {
    const checker = fs.readFileSync(checkerPath, 'utf8');

    /** Both places this file states a half's status: the assignments, and the JSDoc unions. */
    function declaredStatuses(source: string) {
      const found = new Set<string>();
      for (const m of source.matchAll(/\bstatus: '([a-z-]+)',/g)) found.add(m[1]);
      for (const m of source.matchAll(/@returns \{\{ status: ([^,]+),/g)) {
        for (const q of m[1].matchAll(/'([a-z-]+)'/g)) found.add(q[1]);
      }
      return found;
    }

    /**
     * ⛔ The fence, and it is the half that is easy to get wrong: this card is
     * a DISTINCTION, not a tightening. Every status that exists today keeps the
     * code it has — `not-applicable` above all, which is inert BY DESIGN ("the
     * absence of a question, not the answer `pass`") and must stay inert.
     */
    it.each([
      ['every half passing', { closure: 'pass', perChunk: 'pass', sensitivity: 'pass', freshness: 'pass' }, 0],
      ['freshness not-applicable, the rest passing', { closure: 'pass', perChunk: 'pass', sensitivity: 'pass', freshness: 'not-applicable' }, 0],
      ['one half failing', { closure: 'fail', perChunk: 'pass', sensitivity: 'pass', freshness: 'not-applicable' }, 1],
      ['one half erroring', { closure: 'pass', perChunk: 'pass', sensitivity: 'error', freshness: 'not-applicable' }, 2],
      ['error outranking fail', { closure: 'fail', perChunk: 'pass', sensitivity: 'error', freshness: 'pass' }, 2],
    ])('leaves %s at its existing exit code', (_label, halves, expected) => {
      const { code, unrecognised } = foldHalfStatuses(halves as Record<string, string>);
      expect(code).toBe(expected);
      expect(unrecognised).toEqual([]);
    });

    it('is LOUD about a status no half declares, instead of folding it into 0', () => {
      // 'errror' rather than an obviously-fake token: the realistic arrival of
      // this class is a typo or a fifth status added to one half without
      // editing the fold, not a hostile input.
      const { code, unrecognised } = foldHalfStatuses({
        closure: 'errror',
        perChunk: 'pass',
        sensitivity: 'pass',
        freshness: 'not-applicable',
      });
      // 2, not 1 and not a throw: an unrecognised status is a check that
      // measured nothing, which is this file's exit 2. An uncaught throw would
      // exit Node with 1 — the "over budget" code — labelling a broken gauge
      // as a size regression, the one collapse `main`'s own comment refuses.
      expect(code).toBe(2);
      expect(unrecognised).toEqual([{ half: 'closure', status: 'errror' }]);
    });

    it('names the offending half even when a sibling half independently errors', () => {
      // Both paths return 2, so this is not about the exit code: it is about
      // the run that could reveal a status nobody enumerated not being the run
      // that hides it behind an unrelated error.
      const { code, unrecognised } = foldHalfStatuses({
        closure: 'error',
        perChunk: 'pass',
        sensitivity: 'wobbly',
        freshness: 'not-applicable',
      });
      expect(code).toBe(2);
      expect(unrecognised).toEqual([{ half: 'sensitivity', status: 'wobbly' }]);
    });

    it('keeps `not-applicable` inert in the very run an unrecognised status is loud', () => {
      // The control of known direction. One run, two classes that both fall
      // through today: only ONE of them moves.
      const { unrecognised } = foldHalfStatuses({
        closure: 'pass',
        perChunk: 'pass',
        sensitivity: 'nearly-pass',
        freshness: 'not-applicable',
      });
      expect(unrecognised.map((u) => u.half)).toEqual(['sensitivity']);
      expect(unrecognised.map((u) => u.status)).not.toContain('not-applicable');
      // And alone, it is still worth 0 — unchanged from before this card.
      expect(
        foldHalfStatuses({ closure: 'pass', perChunk: 'pass', sensitivity: 'pass', freshness: 'not-applicable' }).code,
      ).toBe(0);
    });

    /**
     * The tripwire for the case the card is actually about: a half gaining a
     * FIFTH status. `RECOGNISED_HALF_STATUSES` is a written-down list, so
     * AGENTS.md #9 requires an instrument that re-derives it — this is that
     * instrument, reading the checker's own text rather than a copy.
     */
    it('recognises exactly the statuses this file declares, re-derived from its source', () => {
      expect([...declaredStatuses(checker)].sort()).toEqual([...RECOGNISED_HALF_STATUSES].sort());
    });

    it('extracts statuses at all — a matcher that matches nothing agrees with everything', () => {
      // Without this control the assertion above passes for the wrong reason
      // the moment the shape it reads changes.
      expect([...declaredStatuses(checker)].length).toBe(RECOGNISED_HALF_STATUSES.length);
      expect([...declaredStatuses("      status: 'wobbly',")]).toEqual(['wobbly']);
      expect([...declaredStatuses(" * @returns {{ status: 'pass' | 'wobbly', message: string,")].sort()).toEqual(
        ['pass', 'wobbly'],
      );
    });

    /**
     * The floor above is only a floor while `main` actually routes through the
     * function it tests. Re-inlining the two membership tests would leave these
     * cases green against a function nothing calls.
     */
    it('is the fold `main` itself uses, not a parallel copy', () => {
      const mainBody = checker.slice(checker.indexOf('export function main('));
      expect(mainBody).toContain('evaluateCeilingFreshness({');
      expect(mainBody).toContain('foldHalfStatuses({');
      expect(mainBody).not.toMatch(/statuses\.includes\(/);
    });
  });
});

/**
 * objectui#6245 — the fourth half. GitHub does not re-run a PR's checks when the
 * base branch moves, so a green verdict can be computed against ceilings `main`
 * has since replaced.
 *
 * ⛔ This docblock classified `Bundle Analysis` against the branch-protection
 * set until objectui#9155 and no longer does, in either direction — that set is
 * not readable from inside a checkout. `evaluateCeilingFreshness`'s own docblock
 * carries what the tree can re-derive instead, cited to
 * `scripts/dependabot-merge-gate.mjs` and to the workflow's `on:` block; the pin
 * at the bottom of this file keeps all three files off the claim.
 *
 * Not hypothetical: run 32804357171 started 6m50s after `0409b766d` lowered the
 * aggregate ceiling from 4,086,000 to 3,345,000 and published
 * `BUDGET_CLOSURE_BUDGET_KB: 3990.2` — 4,086,000 bytes — with conclusion
 * `success`. `theRealIncident` below replays exactly that pair of numbers.
 */
/**
 * The membership half, folded — objectui#9345.
 *
 * Local to this block rather than merged into `describe('main')` above for the
 * reason that block's own freshness sibling gives: these cases need the second
 * artifact under their control, and a shared helper that always wrote a healthy
 * one could not express the absent case at all.
 */
describe('main folds chunk membership into the exit code (objectui#9345)', () => {
  /**
   * Local runner, like the freshness block's: `describe('main')`'s helper is
   * scoped to that block, and these cases need the SECOND artifact under their
   * own control — including the case where it is absent, which a helper that
   * always wrote a healthy one could not express.
   */
  function runPair(reportBody: unknown, membershipBody: unknown) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-membership-'));
    const reportPath = path.join(dir, 'eager-closure.json');
    const outputPath = path.join(dir, 'github-output');
    fs.writeFileSync(reportPath, JSON.stringify(reportBody));
    if (membershipBody !== undefined) {
      fs.writeFileSync(path.join(dir, 'chunk-membership.json'), JSON.stringify(membershipBody));
    }
    try {
      const code = main(['--report', reportPath], { GITHUB_OUTPUT: outputPath });
      const outputs = Object.fromEntries(
        fs
          .readFileSync(outputPath, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const at = line.indexOf('=');
            return [line.slice(0, at), line.slice(at + 1)] as [string, string];
          }),
      );
      return { code, outputs };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /** The report every case here starts from: nothing is over any line. */
  function healthyBudget() {
    return report({
      eagerGzipBytes: BASELINE.gzipBytes,
      files: [
        { fileName: 'assets/index-A.js', name: 'index', bytes: 90_000, gzipBytes: BASELINE.gzipBytes - PER_CHUNK_BASELINE['vendor-objectstack'] - PER_CHUNK_BASELINE.framework - PER_CHUNK_BASELINE['ui-components'] - PER_CHUNK_BASELINE['i18n-locale-en'] },
        { fileName: 'assets/vendor-objectstack-B.js', name: 'vendor-objectstack', bytes: 5_000_000, gzipBytes: PER_CHUNK_BASELINE['vendor-objectstack'] },
        { fileName: 'assets/framework-C.js', name: 'framework', bytes: 300_000, gzipBytes: PER_CHUNK_BASELINE.framework },
        { fileName: 'assets/ui-components-D.js', name: 'ui-components', bytes: 900_000, gzipBytes: PER_CHUNK_BASELINE['ui-components'] },
        { fileName: 'assets/i18n-locale-en-E.js', name: 'i18n-locale-en', bytes: 120_000, gzipBytes: PER_CHUNK_BASELINE['i18n-locale-en'] },
      ],
      eagerChunkCount: 5,
    });
  }

  it('exits 0 and publishes `pass` when every declared package is in place', () => {
    const { code, outputs } = runPair(healthyBudget(), passingMembership());
    expect(outputs.closure_membership_status).toBe('pass');
    expect(code).toBe(0);
  });

  it('exits 1 — a size verdict`s code — when a budgeted package landed elsewhere', () => {
    const membership = passingMembership();
    (membership.packages as Record<string, Record<string, number>>).core = {
      framework: 60,
      'data-adapter': 32,
    };
    const { code, outputs } = runPair(healthyBudget(), membership);
    expect(outputs.closure_membership_status).toBe('fail');
    // ⭐ 1, not 2. A package in the wrong chunk is a real verdict about the
    // bundle, in the same class as a chunk over its ceiling — not a gauge that
    // produced nothing.
    expect(code).toBe(1);
  });

  it('exits 2 when the artifact is absent — an unbuilt tree is not a pass', () => {
    const { code, outputs } = runPair(healthyBudget(), undefined);
    expect(outputs.closure_membership_status).toBe('error');
    expect(code).toBe(2);
  });
});

describe('ceiling freshness (objectui#6245)', () => {
  const checkerSource = fs.readFileSync(checkerPath, 'utf8');

  /**
   * A copy of the real checker with one ceiling moved, so these fixtures track
   * a future re-baseline instead of pinning today's digits in a second place.
   *
   * The `expect` is the guard on the guard: a `String.replace` whose pattern
   * matches nothing returns the subject unchanged and throws nothing, which
   * would leave every case below comparing a file with itself and passing for
   * the wrong reason.
   */
  function withAggregateCeiling(bytes: number) {
    const moved = checkerSource.replace(
      /^export const MAX_EAGER_CLOSURE_GZIP_BYTES = .*;$/m,
      `export const MAX_EAGER_CLOSURE_GZIP_BYTES = ${bytes};`,
    );
    expect(moved, 'the fixture anchor no longer matches the real declaration').not.toBe(
      checkerSource,
    );
    return moved;
  }

  const onPullRequest = (overrides: Record<string, unknown> = {}) =>
    evaluateCeilingFreshness({
      eventName: 'pull_request',
      headSource: checkerSource,
      prBaseSource: checkerSource,
      baseSource: checkerSource,
      baseRef: 'main',
      ...overrides,
    });

  describe('extractCeilingDeclarations', () => {
    it('finds every constant a verdict is computed from, in the real file', () => {
      const { declarations, missing } = extractCeilingDeclarations(checkerSource);
      expect(missing).toEqual([]);
      expect([...declarations.keys()]).toEqual([...VERDICT_CEILING_CONSTANTS]);
      expect(declarations.get('MAX_EAGER_CLOSURE_GZIP_BYTES')).toBe(
        String(MAX_EAGER_CLOSURE_GZIP_BYTES),
      );
    });

    it('reads an expression as text, so both sides of a comparison are read alike', () => {
      // `695 * 1024` must not be evaluated: the base-branch side is a blob that
      // cannot be imported, so an evaluated 711680 here would never match it.
      expect(extractCeilingDeclarations(checkerSource).declarations.get(
        'REGRESSION_THIS_GATE_MUST_CATCH_BYTES',
      )).toBe('695 * 1024');
    });

    it('erases formatting that cannot move a ceiling', () => {
      const a = "export const MAX_EAGER_CLOSURE_GZIP_BYTES = 3_345_000;";
      const b = "export const MAX_EAGER_CLOSURE_GZIP_BYTES =\n  3345000;";
      const read = (s: string) =>
        extractCeilingDeclarations(s, ['MAX_EAGER_CLOSURE_GZIP_BYTES']).declarations.get(
          'MAX_EAGER_CLOSURE_GZIP_BYTES',
        );
      expect(read(a)).toBe(read(b));
    });

    it('erases comments and trailing commas inside an object ceiling', () => {
      const plain = "export const PER_CHUNK_GZIP_CEILINGS = Object.freeze({ a: 1, b: 2 });";
      const noisy =
        'export const PER_CHUNK_GZIP_CEILINGS = Object.freeze({\n' +
        '  // objectui#5490 — why this one is here\n' +
        '  a: 1,\n' +
        '  b: 2,\n' +
        '});';
      const read = (s: string) =>
        extractCeilingDeclarations(s, ['PER_CHUNK_GZIP_CEILINGS']).declarations.get(
          'PER_CHUNK_GZIP_CEILINGS',
        );
      expect(read(noisy)).toBe(read(plain));
    });

    it('reports a name it cannot find rather than skipping the comparison', () => {
      const { declarations, missing } = extractCeilingDeclarations('export const OTHER = 1;');
      expect(missing).toEqual([...VERDICT_CEILING_CONSTANTS]);
      expect(declarations.size).toBe(0);
    });

    it('does not mistake a nested `;` for the end of the declaration', () => {
      const source =
        'export const PER_CHUNK_GZIP_CEILINGS = Object.freeze({ a: 1, b: 2 });\n' +
        'export const AFTER = 9;';
      expect(
        extractCeilingDeclarations(source, ['PER_CHUNK_GZIP_CEILINGS']).declarations.get(
          'PER_CHUNK_GZIP_CEILINGS',
        ),
      ).toBe('Object.freeze({ a: 1, b: 2 })');
    });
  });

  describe('evaluateCeilingFreshness', () => {
    it('is not applicable off a pull_request — the checkout IS the branch', () => {
      for (const eventName of ['push', 'workflow_dispatch', undefined]) {
        const verdict = evaluateCeilingFreshness({ eventName, headSource: checkerSource });
        expect(verdict.status).toBe('not-applicable');
        expect(verdict.superseded).toEqual([]);
      }
    });

    it('passes when the base branch has not moved a ceiling since this checkout', () => {
      const verdict = onPullRequest();
      expect(verdict.status).toBe('pass');
      expect(verdict.moved).toEqual([]);
    });

    /**
     * The case that makes this a three-reading check and not a two-reading one.
     * A re-baseline PR differs from the base branch DELIBERATELY, and failing it
     * would make the one PR that must land unlandable.
     */
    it('passes a PR that re-baselines a ceiling itself', () => {
      const verdict = onPullRequest({ headSource: withAggregateCeiling(3_000_000) });
      expect(verdict.status).toBe('pass');
      expect(verdict.moved).toEqual([]);
      expect(verdict.superseded).toEqual([]);
    });

    it('passes when the base branch moved a ceiling and this checkout carries it', () => {
      const moved = withAggregateCeiling(3_000_000);
      const verdict = onPullRequest({ headSource: moved, baseSource: moved });
      expect(verdict.status).toBe('pass');
      expect(verdict.moved).toEqual(['MAX_EAGER_CLOSURE_GZIP_BYTES']);
      expect(verdict.superseded).toEqual([]);
      expect(verdict.message).toContain('already carries the new value');
    });

    it('ERRORS when the base branch replaced a ceiling this run weighed against', () => {
      const verdict = onPullRequest({ baseSource: withAggregateCeiling(3_000_000) });
      expect(verdict.status).toBe('error');
      expect(verdict.superseded).toEqual(['MAX_EAGER_CLOSURE_GZIP_BYTES']);
      expect(verdict.message).toContain(String(MAX_EAGER_CLOSURE_GZIP_BYTES));
      expect(verdict.message).toContain('3000000');
    });

    /**
     * The live incident, with its own numbers. #6229 moved the aggregate ceiling
     * from 4,086,000 to 3,345,000 at 03:06:37Z; a PR run seven minutes later was
     * still weighing against 4,086,000 and reported success.
     */
    it('catches the incident this card was filed for', () => {
      const theRealIncident = onPullRequest({
        headSource: withAggregateCeiling(4_086_000),
        prBaseSource: withAggregateCeiling(4_086_000),
        baseSource: withAggregateCeiling(3_345_000),
        prBaseSha: '48e53814e',
        baseSha: '0409b766d',
      });
      expect(theRealIncident.status).toBe('error');
      expect(theRealIncident.message).toContain('weighed here : 4086000');
      expect(theRealIncident.message).toContain('in force now : 3345000');
      expect(theRealIncident.message).toContain('48e53814e -> 0409b766d');
    });

    /**
     * The whole point of routing this to exit 2 rather than exit 1. A reader who
     * takes a freshness failure for a size failure goes hunting a regression
     * that is not there — and the fix they reach for is widening the ceiling,
     * which is the one thing this must never teach.
     */
    it('reads as a superseded ceiling and NOT as a bundle that grew', () => {
      const { message } = onPullRequest({ baseSource: withAggregateCeiling(3_000_000) });
      expect(message).toContain('NOTHING GREW');
      expect(message).toContain('not a size regression');
      expect(message).toContain('Do NOT widen a ceiling');
      expect(message).toMatch(/update this branch/i);
      // The size half's vocabulary must not appear here.
      expect(message).not.toMatch(/over the .* budget|over budget|BUDGET EXCEEDED/);
    });

    it('ERRORS rather than passing when the base branch could not be read', () => {
      for (const missing of ['prBaseSource', 'baseSource'] as const) {
        const verdict = onPullRequest({ [missing]: null });
        expect(verdict.status).toBe('error');
        expect(verdict.message).toContain('NOT that the ceilings agree');
      }
    });

    it('ERRORS rather than passing when a ceiling declaration cannot be located', () => {
      const verdict = onPullRequest({ baseSource: 'export const SOMETHING_ELSE = 1;' });
      expect(verdict.status).toBe('error');
      expect(verdict.message).toContain('could not be located');
      expect(verdict.message).toContain('MAX_EAGER_CLOSURE_GZIP_BYTES');
    });
  });

  /**
   * Through `main`, because the exit code and the published verdict are what the
   * workflow acts on — and because these two assertions hold against the whole
   * pipeline rather than one exported function.
   */
  describe('main folds freshness into the exit code', () => {
    /**
     * A within-budget report carrying the whole closure, not just the budgeted
     * chunks — a report holding only those is an ERROR (objectui#5924), so a
     * thinner fixture would exit 2 for the wrong reason and prove nothing about
     * freshness. Local rather than shared: `describe('main')` has its own copy
     * and reaching across describes to borrow it would couple these two blocks.
     */
    function healthyReport() {
      const named = [
        { fileName: 'assets/index-A.js', name: 'index', bytes: 0, gzipBytes: 25_910 },
        ...Object.entries(PER_CHUNK_BASELINE).map(([name, gzipBytes]) => ({
          fileName: `assets/${name}-hash.js`,
          name,
          bytes: 0,
          gzipBytes,
        })),
      ];
      const namedTotal = named.reduce((n, f) => n + f.gzipBytes, 0);
      const files = [
        ...named,
        {
          fileName: 'assets/rest-of-closure.js',
          name: 'rest-of-closure',
          bytes: 0,
          gzipBytes: BASELINE.gzipBytes - namedTotal,
        },
      ];
      return report({
        files,
        eagerChunkCount: files.length,
        eagerGzipBytes: files.reduce((n, f) => n + f.gzipBytes, 0),
        eagerRawBytes: 0,
      });
    }

    function runWithEnv({
      eventName,
      prBase,
      base,
    }: {
      eventName: string;
      prBase?: string;
      base?: string;
    }) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closure-freshness-'));
      const reportPath = path.join(dir, 'eager-closure.json');
      const outputPath = path.join(dir, 'github-output');
      fs.writeFileSync(reportPath, JSON.stringify(healthyReport()));
      // The membership half resolves its artifact beside the report. These
      // cases are about FRESHNESS, so it is written healthy here — an absent
      // one would exit 2 for a reason none of them is asking about.
      fs.writeFileSync(
        path.join(dir, 'chunk-membership.json'),
        JSON.stringify(passingMembership()),
      );
      const write = (name: string, body: string) => {
        const at = path.join(dir, name);
        fs.writeFileSync(at, body);
        return at;
      };
      try {
        const code = main(['--report', reportPath], {
          GITHUB_OUTPUT: outputPath,
          GITHUB_EVENT_NAME: eventName,
          EAGER_CLOSURE_PR_BASE_SOURCE: prBase === undefined ? undefined : write('pr-base.mjs', prBase),
          EAGER_CLOSURE_BASE_SOURCE: base === undefined ? undefined : write('base.mjs', base),
          EAGER_CLOSURE_BASE_REF: 'main',
        });
        const outputs = Object.fromEntries(
          fs
            .readFileSync(outputPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => {
              const at = line.indexOf('=');
              return [line.slice(0, at), line.slice(at + 1)] as [string, string];
            }),
        );
        return { code, outputs };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }

    it('exits 2 and publishes `error` when the ceiling it used was superseded', () => {
      const { code, outputs } = runWithEnv({
        eventName: 'pull_request',
        prBase: checkerSource,
        base: withAggregateCeiling(3_000_000),
      });
      // 2, not 1: the bundle is under budget and nothing grew.
      expect(code).toBe(2);
      expect(outputs.closure_freshness_status).toBe('error');
      expect(outputs.closure_status).toBe('pass');
      expect(outputs.closure_headroom_status).toBe('pass');
    });

    it('exits 2 on a pull_request run whose base branch was never resolved', () => {
      const { code, outputs } = runWithEnv({ eventName: 'pull_request' });
      expect(code).toBe(2);
      expect(outputs.closure_freshness_status).toBe('error');
    });

    it('publishes an EMPTY freshness verdict off a pull_request, never a pass', () => {
      // An absent half is filtered out of the PR comment; a `pass` would assert
      // a comparison that never happened.
      const { code, outputs } = runWithEnv({ eventName: 'push' });
      expect(code).toBe(0);
      expect(outputs.closure_freshness_status).toBe('');
    });
  });
});

/**
 * The checker can only be correct if the workflow keeps feeding it and the
 * build keeps emitting the report. Neither half is reachable from a unit test.
 */
describe('performance-budget.yml + vite.config.ts contract', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  const viteConfig = fs.readFileSync(viteConfigPath, 'utf8');

  it('runs the closure checker in the budget step', () => {
    expect(workflow).toContain('node scripts/check-eager-closure-budget.mjs');
  });

  it('keeps the entry-chunk budget alongside it', () => {
    // Replacing a blind gauge is not licence to drop the check already there.
    expect(workflow).toContain('MAX_ENTRY_GZIP_KB=350');
  });

  it('measures the closure even when the entry chunk is over budget', () => {
    // The entry check used to `exit 1` on breach. If it still did, a fat entry
    // chunk would hide the number that actually governs a page load.
    const step = workflow.slice(workflow.indexOf('MAX_ENTRY_GZIP_KB=350'));
    const entryVerdict = step.indexOf('ENTRY BUDGET EXCEEDED');
    const closureRun = step.indexOf('node scripts/check-eager-closure-budget.mjs');
    expect(entryVerdict).toBeGreaterThan(-1);
    expect(closureRun).toBeGreaterThan(entryVerdict);
  });

  it('maps the gauge-failure exit code to `error`, not to a size verdict', () => {
    expect(workflow).toContain('if [ "$CLOSURE_CODE" -eq 2 ]; then');
    const branch = workflow.slice(workflow.indexOf('if [ "$CLOSURE_CODE" -eq 2 ]; then'));
    expect(branch.slice(0, 400)).toContain('budget_status=error');
  });

  it('emits the report from a plugin that is not skipped on CI', () => {
    // `compression` and `visualizer` sit behind `...(!isCI ? [` — the budget
    // runs ON CI, so the report emitter must not join them there.
    expect(viteConfig).toContain('emitEagerClosureReport()');
    const registration = viteConfig.indexOf('emitEagerClosureReport(),');
    const ciOnlyBlock = viteConfig.indexOf('...(!isCI ? [');
    expect(registration).toBeGreaterThan(-1);
    expect(ciOnlyBlock).toBeGreaterThan(registration);
  });

  it('agrees with the emitter about the report version', () => {
    // The two halves of one contract, in two files. A silent disagreement here
    // is the worst shape available: the checker would refuse every report, or
    // (the version it was bumped to guard) read a report missing the very field
    // the per-chunk ceilings key on.
    const emitted = viteConfig.match(/reportVersion: (\d+)/);
    expect(emitted?.[1]).toBe(String(SUPPORTED_REPORT_VERSION));
  });

  it('publishes each chunk\'s own name, and refuses a member without one', () => {
    const plugin = viteConfig.slice(viteConfig.indexOf('function emitEagerClosureReport'));
    const body = plugin.slice(0, plugin.indexOf('\n}\n'));
    expect(body).toContain('chunks.get(fileName)?.name');
    expect(body).toContain('return { fileName, name,');
    // An unnamed member must stop the build rather than be published: it would
    // reach the checker as bytes no per-chunk ceiling can find.
    expect(body).toContain('carries no chunk');
  });

  /**
   * The static half of the mapping pin. The runtime half (a budgeted chunk
   * absent from the REPORT is an error) needs a build; this one reds in a unit
   * run the moment an `advancedChunks` group is renamed out from under a
   * ceiling — the rename and the stale ceiling are then one failing test apart
   * rather than one green CI apart.
   */
  it.each(Object.keys(PER_CHUNK_GZIP_CEILINGS))(
    'budgets `%s`, which is a real advancedChunks group in the console config',
    (name) => {
      expect(viteConfig).toContain(`{ name: '${name}',`);
    },
  );

  it('writes the report where the checker looks for it', () => {
    expect(viteConfig).toContain("reportFileName = 'eager-closure.json'");
    const checker = fs.readFileSync(
      path.join(repoRoot, 'scripts/check-eager-closure-budget.mjs'),
      'utf8',
    );
    expect(checker).toContain("'apps/console/dist/eager-closure.json'");
  });

  it('follows static imports only — dynamic edges are the lazy boundary', () => {
    const plugin = viteConfig.slice(viteConfig.indexOf('function emitEagerClosureReport'));
    const body = plugin.slice(0, plugin.indexOf('\n}\n'));
    expect(body).toContain('chunks.get(fileName)?.imports ?? []');
    // The queue may only ever be fed from the STATIC import list. (Plain
    // `not.toContain('dynamicImports')` would trip on the counter-probe's own
    // message, which names the field it is guarding against.)
    expect(body).not.toMatch(/for \(const \w+ of [^)]*dynamicImports/);
  });
});

/**
 * The prose attached to the two baselines, CHECKED rather than argued
 * (objectui#7046).
 *
 * {@link VERDICT_CEILING_CONSTANTS} deliberately excludes `BASELINE` and
 * `PER_CHUNK_BASELINE` — no verdict is computed from them, so the freshness
 * check that guards every other constant in this file structurally cannot see
 * them, and the only thing describing them is a comment. objectui#6778 is what
 * that costs: one paragraph attached to `PER_CHUNK_BASELINE` named a commit
 * three re-baselines out of date as what `BASELINE` carried, computed its
 * arithmetic against that retired reading, and drew the REVERSE of the verdict
 * the same script printed in the same run. It survived long enough to be copied
 * verbatim into a second card.
 *
 * Everything here is a POSITIVE pin: a live value the prose claims must equal
 * the value the module actually exports. The blanket negative pin the card
 * offered as (b) — "the attached block carries no OTHER commit hash" — was
 * measured and deliberately NOT shipped: both blocks legitimately cite
 * superseded hashes as history (`bd2a7ec50` under `BASELINE`, and every one of
 * the five under `PER_CHUNK_BASELINE`, which carries no commit of its own), so
 * (b) is red on an honest file before any mutation and no marker distinguishes
 * the two senses without rewriting the narrative comments. See the PR body for
 * the full reading.
 */
describe('the prose attached to the baselines (objectui#7046)', () => {
  const checkerSource = fs.readFileSync(checkerPath, 'utf8');

  /** Commit strings a constant carries AS DATA, found by walking its values. */
  function commitsCarriedBy(value: unknown): string[] {
    const found: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === 'string') {
        if (/^[0-9a-f]{7,40}$/.test(v)) found.push(v);
        return;
      }
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(value);
    return [...new Set(found)];
  }

  /**
   * A sentence claiming what `BASELINE` CARRIES — present tense, the sense that
   * must be current — as opposed to a bare hash, which in this file is usually
   * history and correct as such. The distinction is grammatical, not statistical,
   * which is why this is a positive pin with no false-positive surface: nobody
   * writes "BASELINE's `x`" about a hash it used to carry.
   *
   * `(?<![A-Za-z0-9_])` is not decoration: without it `PER_CHUNK_BASELINE` in a
   * `{@link}` matches as `BASELINE`.
   */
  const CITES_BASELINE_COMMIT =
    /(?<![A-Za-z0-9_])(?:\{@link\s+BASELINE\}|BASELINE)(?:['’]s)?\s*\(?\s*`([0-9a-f]{7,40})`/g;

  const BASELINES = ['BASELINE', 'PER_CHUNK_BASELINE'] as const;

  it('locates the block attached to each baseline, and only that block', () => {
    const baseline = attachedDocs(checkerSource, 'BASELINE');
    const perChunk = attachedDocs(checkerSource, 'PER_CHUNK_BASELINE');

    // Controls that MUST hit: phrases verified to be inside each attached
    // block. A locator that quietly found the wrong span would pass every pin
    // below by scanning prose that says nothing about these constants.
    expect(baseline.prose).toContain('the previous baseline');
    expect(perChunk.prose).toContain('Provenance is per KEY');

    // ...and the neighbours are not swept in. Each baseline sits directly under
    // the ceiling it was measured for, whose block is much the larger of the two.
    expect(baseline.prose).not.toContain('Re-baselined DOWNWARD five times');
    expect(perChunk.prose).not.toContain('## Raising one');

    // The code is not prose. Without this the positive pin below would be
    // satisfiable by the `commit:` line itself.
    expect(baseline.code).toContain(`commit: '${BASELINE.commit}'`);
    expect(baseline.prose).not.toContain(`commit: '${BASELINE.commit}'`);
  });

  /**
   * (a), the positive pin: what the constant carries must be what its own prose
   * says it carries. Vacuous for `PER_CHUNK_BASELINE` today, which is a measured
   * fact about that constant and is pinned as such in the next case.
   */
  it.each(BASELINES)('pins every commit %s carries into its own attached prose', (name) => {
    const { prose } = attachedDocs(checkerSource, name);
    const carried = commitsCarriedBy(name === 'BASELINE' ? BASELINE : PER_CHUNK_BASELINE);
    expect(carried.filter((commit) => !prose.includes(commit))).toEqual([]);
  });

  /**
   * What each baseline carries AS DATA, recorded so the pin above cannot go
   * vacuous in silence. Measured on `main`: `BASELINE` carries exactly one
   * commit string, with `squashMerge` null since objectui#10996 (below);
   * `PER_CHUNK_BASELINE` carries NONE — its per-key provenance
   * commits live only in prose, with no exported value to check them against,
   * which is why the pin above says nothing about it and the claim pin below is
   * what guards its block. Add a `commit` field there and this reds, and the pin
   * above starts covering it.
   *
   * The second string is objectui#9355's `squashMerge`: the tree the reading
   * was taken on cannot be resolved from a `main` checkout, so the squash that
   * landed it is carried beside it as the handle that can. ⭐ Carrying it as
   * DATA rather than leaving it in prose is the point of the change — a prose
   * hash is guarded by nothing, while a carried one is dragged under the
   * positive pin above and cannot go stale in silence, which is the
   * objectui#6778 defect one column over.
   *
   * ⚠️ This case is POSITIONAL and exact on purpose, and ⛔ must not be widened
   * to tolerate either shape. A re-baseline cannot know its own squash sha —
   * the sha does not exist until the pull request merges — so the honest value
   * at that moment is `null`, and `null` reds here. That red is the intended
   * signal: it is a ledger, it is re-pinned deliberately, and a predicate loose
   * enough to accept both shapes would stop recording anything.
   *
   * objectui#10996 is the first re-baseline to meet it, and re-pinned it to the
   * shape it left: `squashMerge` null, one commit carried. objectui#11073 and
   * objectui#11101, and objectui#11438 and objectui#11717 after them, each
   * re-pinned the constant onto a branch tip of their own and left the same
   * shape. ⛔ Still exact and positional — a back-fill of the
   * squash reds here again, and is re-pinned to two strings the same way.
   */
  it('records what each baseline carries as data, so the pin cannot go vacuous', () => {
    expect(commitsCarriedBy(BASELINE)).toEqual([BASELINE.commit]);
    expect(BASELINE.squashMerge).toBeNull();
    expect(commitsCarriedBy(PER_CHUNK_BASELINE)).toEqual([]);
  });

  /**
   * The objectui#6778 defect itself, as an assertion. The stale hash was in a
   * sentence in `PER_CHUNK_BASELINE`'s block about what `BASELINE` carried —
   * a cross-constant claim, which is precisely the shape the pin above cannot
   * see, because the block making the claim carries no commit of its own.
   */
  it('holds every "BASELINE carries X" claim in the attached prose to the live value', () => {
    const claims = BASELINES.flatMap((name) =>
      [...attachedDocs(checkerSource, name).prose.matchAll(CITES_BASELINE_COMMIT)].map((m) => ({
        name,
        text: m[0],
        cited: m[1] as string,
      })),
    );

    // Presence first: a rewrite that drops the sentence must red here rather
    // than silently unpin the block objectui#6778's stale claim lived in.
    expect(claims.map((claim) => claim.name)).toContain('PER_CHUNK_BASELINE');

    expect(claims.map((claim) => `${claim.name}: ${claim.text}`)).toEqual(
      claims.map((claim) => `${claim.name}: ${claim.text.replace(claim.cited, BASELINE.commit)}`),
    );
  });

  /**
   * `PER_CHUNK_BASELINE` carries no commit, but it does carry three chunk NAMES,
   * and its block assigns provenance per key — "Provenance is per KEY, not per
   * file, and saying so is the point". A key added or renamed without touching
   * that list is the same drift one column over: a measurement nothing explains.
   */
  it('pins every chunk name PER_CHUNK_BASELINE carries into its own attached prose', () => {
    const { prose } = attachedDocs(checkerSource, 'PER_CHUNK_BASELINE');
    expect(Object.keys(PER_CHUNK_BASELINE).filter((chunk) => !prose.includes(chunk))).toEqual([]);
  });
});

/**
 * objectui#7528 — a chunk count in this gate's prose stays pinned to the commit
 * it was measured on, or it is not written.
 *
 * Three sentences here and in the checker described the aggregate as "one number
 * over N chunks" with N written out as a literal. By the time the card was worked
 * that literal, the checker's own frozen `BASELINE.chunks`, and the figure the
 * gate's verdict line printed were three DIFFERENT numbers, with no check red
 * anywhere across the spread, because nothing fails on a stale number in a
 * comment. The count was never load-bearing either: the sentence is rhetorical
 * ("one total over N chunks cannot say WHERE the payload moved"), which is
 * exactly why nothing caught it. Refreshing the literal to today's reading would
 * have turned three numbers into two and restarted the clock; this makes the
 * class fail loudly instead.
 *
 * ⚠️ It also means this docblock may not quote the old literal back: the reader
 * below cannot tell a quotation from a claim, and refusing both is the safe
 * direction for a check on prose accuracy. The numbers live in the card and in
 * the pull request that closed it.
 *
 * The rule is the one the checker's header already states for its motivating
 * table — "that table is the MOTIVATING measurement and stays pinned to
 * `77f846a8b`; it is not the current reading" — generalised and made mechanical.
 * An ANCHORED count is a measurement of a named build and cannot go stale; an
 * unanchored one is a standing claim about the live closure, which moves on most
 * builds. The same distinction is why objectui#7528 declined to file
 * `vite-declared-lazy-views.ts`'s "42.5 KB of headroom": it sits in a paragraph
 * dated to a `b98352a15` measurement and reads as history.
 *
 * Deliberately narrow, and each limit is a decision rather than an oversight:
 *
 *   - NUMERALS qualifying a CHUNK noun. "144 modules" and "166 modules" are
 *     module counts inside anchored change records, not claims about the shape
 *     of the closure, and none of them rots when a chunk is added.
 *   - OWN-LINE comments — block comments and `//` lines, the form every
 *     paragraph of prose in these two files is written in.
 *   - The anchor window is a paragraph PLUS the one before it, because the
 *     header writes its lead-in ("Measured on `77f846a8b`:") and its table as
 *     two paragraphs. A sha cannot reach across code: a code line breaks the
 *     paragraph, so a hash in one block never anchors a count in another.
 *
 * The window is a heuristic in one direction and is left that way knowingly: a
 * lead-in paragraph anchors what follows it, so a hash written for one reason can
 * vouch for a count beside it. It errs toward ALLOWING, which is the tolerable
 * side for a check on prose — the intolerable side is a standing claim nobody
 * refuses. The two legs of the reader's own self-test above hold each direction.
 *
 * `.github/workflows/performance-budget.yml` joined this population in
 * objectui#7850 — the same rule, the same reader, no second matcher. Its prose
 * is `#` comments rather than `/**` blocks, so it reaches the reader through
 * `yamlProse` below, which translates the marker and nothing else.
 *
 * Its one obstacle was settled by REWORDING, not by an exemption. The workflow
 * counted chunks once as the OUTCOME of a hazard — a `"sideEffects": false`
 * that is statically coherent while the registrations it governs reach no chunk
 * at all, objectui#6535 — which is structural, has no build that can move it,
 * and which this reader cannot tell from a population count. That sentence now
 * states the outcome without a numeral, so the reader needs no exception to be
 * right about it; the alternative was an exemption entry, and exemption lists
 * are how a pin decays.
 *
 * ⚠️ The workflow's frozen-SIZE prose is a DIFFERENT class and is deliberately
 * OUT of this pin — named here so nobody widens a count pin into a size pin by
 * accident. The 350 KB entry line, the 89 KiB regression and the byte figures
 * measured on `77f846a8b` are sizes, and a pin for them would have to tell a
 * ceiling's value from the several sizes that paragraph legitimately carries,
 * which this test does not do.
 *
 * Only the negative half is asserted. A positive "the prose names the verdict
 * line" pin would fix a wording, and what has to stay true is narrower: that no
 * number is written here which the next build could falsify.
 */
describe("chunk counts in this gate's prose (objectui#7528)", () => {
  /**
   * The population. Two script files whose prose is JS comments, and the
   * workflow whose prose is `#` comments (objectui#7850) — the same rule and the
   * same reader, with only the comment marker translated for the third.
   */
  const PROSE_FILES: Record<string, { path: string; toProse: (source: string) => string }> = {
    'check-eager-closure-budget.mjs': { path: checkerPath, toProse: (source) => source },
    'check-eager-closure-budget.test.ts': {
      path: fileURLToPath(import.meta.url),
      toProse: (source) => source,
    },
    'performance-budget.yml': { path: workflowPath, toProse: yamlProse },
  };

  /** A chunk population written as a numeral: "N chunks", or "N of M chunks". */
  const CHUNK_COUNT = /\b\d[\d,_]*\s+(?:of\s+\d[\d,_]*\s+)?chunks?\b/gi;

  /** A commit named the way all three files name one: a backticked short hash. */
  const NAMES_A_COMMIT = /`[0-9a-f]{7,40}`/;

  /**
   * The workflow's prose is YAML and shell `#` comments, which `proseLines`
   * classifies as CODE — every count in it would be invisible, and the pin green
   * because it read nothing rather than because nothing was loose. Translating
   * the marker to the one `proseLines` already knows is the whole adaptation:
   * one reader, one rule, no second matcher. The paragraph structure a human
   * sees survives the translation because the two kinds of separator survive it
   * — a bare `#` becomes a bare `//`, a blank COMMENT line that carries an
   * anchor into the paragraph after it, while a line of YAML stays a line of
   * code, which does not. Both directions are held by the self-test below.
   */
  function yamlProse(source: string): string {
    return source
      .split('\n')
      .map((raw) => {
        const line = raw.trim();
        return line.startsWith('#') ? `//${line.slice(1)}` : raw;
      })
      .join('\n');
  }

  /**
   * One entry per source line: the comment's text, `''` for a blank comment
   * line, and `null` for code. The three are distinguished because a blank
   * comment line separates two paragraphs of one argument while a line of code
   * separates two unrelated blocks, and only the first may carry an anchor
   * across.
   */
  function proseLines(source: string): (string | null)[] {
    const lines: (string | null)[] = [];
    let inBlock = false;
    for (const raw of source.split('\n')) {
      const line = raw.trim();
      if (inBlock) {
        lines.push(line.replace(/^\*\/?\s?/, '').replace(/\*\/$/, ''));
        if (line.includes('*/')) inBlock = false;
        continue;
      }
      if (line.startsWith('/*')) {
        inBlock = !line.includes('*/');
        lines.push(line.replace(/^\/\*+\s?/, '').replace(/\*\/$/, ''));
        continue;
      }
      if (line.startsWith('//')) lines.push(line.replace(/^\/\/\s?/, ''));
      else lines.push(line === '' ? '' : null);
    }
    return lines;
  }

  /**
   * Prose paragraphs in order, each carrying whether code stands between it and
   * the paragraph before — which is what decides how far back its anchor may be
   * looked for.
   */
  function paragraphs(source: string): { text: string; afterCode: boolean }[] {
    const paras: { text: string; afterCode: boolean }[] = [];
    let current: string[] = [];
    let startsAfterCode = false;
    let pendingCode = false;
    const flush = () => {
      if (current.length > 0) paras.push({ text: current.join('\n'), afterCode: startsAfterCode });
      current = [];
    };
    for (const line of proseLines(source)) {
      if (line === null) {
        flush();
        pendingCode = true;
        continue;
      }
      if (line.trim() === '') {
        flush();
        continue;
      }
      if (current.length === 0) {
        startsAfterCode = pendingCode;
        pendingCode = false;
      }
      current.push(line);
    }
    flush();
    return paras;
  }

  /** Every chunk count in a file's prose, each tagged with whether a commit anchors it. */
  function chunkCounts(source: string): { text: string; anchored: boolean }[] {
    const paras = paragraphs(source);
    return paras.flatMap((para, i) => {
      const lead = para.afterCode ? '' : (paras[i - 1]?.text ?? '');
      const anchored = NAMES_A_COMMIT.test(`${lead}\n${para.text}`);
      return [...para.text.matchAll(CHUNK_COUNT)].map((m) => ({
        text: m[0].replace(/\s+/g, ' '),
        anchored,
      }));
    });
  }

  /**
   * The reader itself, on strings rather than on the repository. A pin whose
   * matcher silently found nothing would be green forever; this fails instead,
   * and it holds the anchoring rule in both directions without pinning a line of
   * either file.
   */
  it('reads a count and its anchor — so a matcher that found nothing cannot pass', () => {
    expect(chunkCounts('/**\n * The aggregate is one number over 52 chunks.\n */')).toEqual([
      { text: '52 chunks', anchored: false },
    ]);

    // A lead-in paragraph anchors the table under it — the header's own shape.
    expect(
      chunkCounts('/**\n * Measured on `77f846a8b`:\n *\n *   | the closure — 58 of 507 chunks |\n */'),
    ).toEqual([{ text: '58 of 507 chunks', anchored: true }]);

    // ...but a hash in a different comment block does not reach across code.
    expect(chunkCounts('// Measured on `77f846a8b`.\nconst x = 1;\n// One total over 52 chunks.')).toEqual([
      { text: '52 chunks', anchored: false },
    ]);

    // Code is not prose, and a module count is not a chunk count.
    expect(chunkCounts("const n = 52; // the chunk held 144 modules\n")).toEqual([]);
  });

  /**
   * The marker translation, held in both directions — it is what makes the
   * reader see the paragraphs a human sees in the workflow, and a translation
   * that quietly saw nothing would make the workflow entry green forever.
   */
  it('reads a `#` comment block the way it reads a `//` one — once translated', () => {
    const block = [
      '          # Measured on `77f846a8b`:',
      '          #',
      '          #   the closure — 58 of 507 chunks',
    ].join('\n');

    // Untranslated, the reader classifies every one of those lines as code: no
    // paragraph, no count, and a pin that is green because it read nothing.
    expect(chunkCounts(block)).toEqual([]);
    expect(chunkCounts(yamlProse(block))).toEqual([{ text: '58 of 507 chunks', anchored: true }]);

    // A blank COMMENT line joins two paragraphs of one argument, so the anchor
    // reaches the paragraph after it — and no further. Two paragraphs away is
    // unanchored, exactly as it is in a `/**` block.
    const twoParagraphsAway = [
      '          # Measured on `77f846a8b`:',
      '          #',
      '          # An intervening paragraph of argument, carrying no measurement.',
      '          #',
      '          #   the closure — 58 of 507 chunks',
    ].join('\n');
    expect(chunkCounts(yamlProse(twoParagraphsAway))).toEqual([
      { text: '58 of 507 chunks', anchored: false },
    ]);

    // ...and a line of YAML breaks the paragraph the way a line of code does,
    // so a hash in one comment block never anchors a count in another.
    const acrossYaml = [
      '          # Measured on `77f846a8b`.',
      '      - name: Some step',
      '          # the closure — 58 of 507 chunks',
    ].join('\n');
    expect(chunkCounts(yamlProse(acrossYaml))).toEqual([
      { text: '58 of 507 chunks', anchored: false },
    ]);
  });

  /**
   * The allowed branch is live: the checker really does carry an anchored count,
   * so the pin below is passing because nothing is unanchored rather than because
   * nothing was read. A deliberate must-hit control, in the manner of the
   * objectui#7046 block above.
   */
  it('sees the anchored measurement it must not refuse', () => {
    const anchored = chunkCounts(fs.readFileSync(checkerPath, 'utf8'))
      .filter((count) => count.anchored)
      .map((count) => count.text);
    expect(anchored).toContain('58 of 507 chunks');
  });

  /**
   * The same must-hit control for the workflow entry (objectui#7850). Its prose
   * reaches the reader through a translation, and a translation that stopped
   * working would show up as a population that passes because it is empty. This
   * fails instead.
   */
  it('sees the anchored measurement the workflow must not be refused for', () => {
    const anchored = chunkCounts(yamlProse(fs.readFileSync(workflowPath, 'utf8')))
      .filter((count) => count.anchored)
      .map((count) => count.text);
    expect(anchored).toContain('58 of 507 chunks');
  });

  it.each(Object.entries(PROSE_FILES))(
    '%s writes no chunk count that no commit anchors',
    (name, { path: file, toProse }) => {
      const loose = chunkCounts(toProse(fs.readFileSync(file, 'utf8')))
        .filter((count) => !count.anchored)
        .map((count) => count.text);
      expect(
        loose,
        `${name} states a chunk count (${loose.join(', ')}) that names no commit, so it reads as a claim ` +
          'about the live closure — which moves on most builds, while nothing goes red when a number in a ' +
          'comment goes stale. Pin it to the commit it was measured on, or name the population and let the ' +
          'gate’s own verdict line print the figure on every run (objectui#7528).',
      ).toEqual([]);
    },
  );
});

// ── the ceiling note names its constants, and never renders them ─────────────

/**
 * objectui#8964 — the header note that says WHICH constant is which may name
 * its two subjects, and may not render either of them as a size.
 *
 * The note used to do both. It stated the aggregate ceiling and the baseline as
 * MiB literals and then explained, correctly and at length, why the two figures
 * were consistent with each other. A maintainer-authorised re-baseline moved
 * both constants; the prose stayed. For four days and three subsequent edits to
 * that file the note rendered the RETIRED pair, explaining the consistency of
 * two numbers neither of which was in force, and nothing anywhere went red —
 * because nothing fails on a number written in a comment.
 *
 * ⚠️ This is NOT a widening of the chunk-count pin above into a size pin. That
 * trade was weighed there and declined for a reason that still holds: a general
 * size pin would have to tell a ceiling's value from the several sizes this
 * file's prose legitimately carries, and it cannot. This pin does not try. Its
 * population is two named paragraphs which carry no size at all, and its whole
 * claim is that they still carry none. The anchored measurements elsewhere in
 * the header — the re-baseline records, the incident figures — are outside it
 * and stay exactly as they are.
 *
 * ⚠️ Nor may this docblock quote the retired literals back, for the reason the
 * objectui#7528 block gives: the reader cannot tell a quotation from a claim,
 * and refusing both is the safe direction. The numbers live in the card.
 *
 * The region is located by the sentence that opens it and the sentence that
 * closes it, both asserted present and unique, so a rewrite that drops either
 * one turns this red rather than green — an empty scan here would otherwise be
 * indistinguishable from a note that states nothing.
 */
describe('the ceiling note states no rendered size (objectui#8964)', () => {
  /** The first words of the note, and the last — the region this pin owns. */
  const OPENS = 'This is a truthful CURRENT-STATE ceiling, not a target.';
  const CLOSES = 'rendered size written back into either paragraph.';

  /** A size as a person writes one: a numeral, then a byte unit. */
  const RENDERED_SIZE = /\b\d[\d,_]*(?:\.\d+)?\s*(?:[KMGT]i?B)\b/g;

  const renderedSizes = (text: string): string[] =>
    [...text.matchAll(RENDERED_SIZE)].map((m) => m[0].replace(/\s+/g, ' ').trim());

  /** The note, as the pin reads it. Throws rather than returning nothing. */
  function ceilingNote(source: string): string {
    const start = source.indexOf(OPENS);
    const end = source.indexOf(CLOSES);
    if (start < 0 || end < 0) throw new Error('the ceiling note is not where this pin looks for it');
    return source.slice(start, end + CLOSES.length);
  }

  it('reads a note that is there exactly once, rather than reading nothing', () => {
    const source = fs.readFileSync(checkerPath, 'utf8');
    expect(source.split(OPENS).length - 1).toBe(1);
    expect(source.split(CLOSES).length - 1).toBe(1);
    // A floor, so a note shrunk to its two anchors cannot pass by carrying nothing.
    expect(ceilingNote(source).length).toBeGreaterThan(800);
  });

  it('sees a rendered size when one is in front of it', () => {
    expect(renderedSizes('a 9.99 MB payload, 512 KiB of it new, over a 7 GB disk')).toEqual([
      '9.99 MB',
      '512 KiB',
      '7 GB',
    ]);
    expect(renderedSizes('objectui#8964 names two constants and renders neither')).toEqual([]);
  });

  it('renders neither constant as a size', () => {
    const rendered = renderedSizes(ceilingNote(fs.readFileSync(checkerPath, 'utf8')));
    expect(
      rendered,
      `the note that says which constant is which renders a size (${rendered.join(', ')}). ` +
        'A figure written here is a second copy of a constant that lives a few lines below it, and ' +
        'only one of the two moves when the ceiling is re-baselined — which is how this note came to ' +
        'explain, for four days, why two retired numbers were consistent with each other. Name the ' +
        'constant and let the gate print the reading (objectui#8964).',
    ).toEqual([]);
  });
});

// ── no prose here classifies this check against branch protection ───────────

/**
 * objectui#9155 — eight sentences across this gate's three prose files stated,
 * as a fact, that `Bundle Analysis` belongs to the branch-protection set.
 *
 * The repo's own machine-readable classifier answered the neighbouring question
 * differently: `scripts/dependabot-merge-gate.mjs` lists that check under
 * `OPTIONAL_CONTEXTS`, because this workflow filters at the trigger. And the
 * workflow contradicted ITSELF four lines apart — its job-ceiling comment had
 * measured that the `on:` block subscribes `push` and `pull_request` and no
 * `merge_group`, directly under a sentence that read the other way.
 *
 * ⛔ The fix was NOT to flip the prose to the opposite classification. The
 * branch-protection set is not readable from inside a checkout (AGENTS.md says
 * so), so BOTH readings are claims no reader can re-derive, and swapping one
 * for the other buys one round before the same drift returns. The prose now
 * cites the two things the tree does answer, and this pin is the instrument
 * AGENTS.md #9 asks for in exchange: the claim cannot come back in either
 * direction without going red.
 *
 * ⚠️ The population is COMMENT PROSE and this pin reads it deliberately, with
 * no code/comment split at all. A code-only reader would score the whole of
 * objectui#9155 as a no-op, because every one of the eight sites was a comment.
 *
 * ⚠️ The refused phrase is ASSEMBLED below rather than written out: this file
 * is itself in the population, and a pin that spells its own trigger fails on
 * its own source. The must-hit control is what keeps that assembly honest.
 *
 * ⛔ No count of either classifier table is asserted or written here. That list
 * grows — two correct readings taken a day apart during this card's own triage
 * disagreed — and a size baked into a test is the same defect one level up.
 */
describe('no prose here classifies `Bundle Analysis` against branch protection (objectui#9155)', () => {
  /** Assembled, never spelled: this file is inside the population it scans. */
  const REQ = `requi${'red'}`;

  /**
   * Two forms of one claim. The first catches it asserted — and, since the
   * negation contains the positive verbatim, asserted in reverse as well; the
   * second catches the looser denial that drops the noun.
   */
  const CLASSIFIES = new RegExp(String.raw`\b${REQ}\s+contexts?\b|\bis\s+not\s+${REQ}\b`, 'gi');

  /** The three files objectui#9155 is about, by the name a failure prints. */
  const POPULATION: Record<string, string> = {
    'check-eager-closure-budget.mjs': checkerPath,
    'check-eager-closure-budget.test.ts': fileURLToPath(import.meta.url),
    'performance-budget.yml': workflowPath,
  };

  /**
   * The must-HIT control, with a known direction. Without it the three zeroes
   * below are equally consistent with a matcher that stopped matching anything
   * — which is how a pin on absence goes quietly green forever.
   */
  it('sees the retired sentence when one is put in front of it', () => {
    expect(`\`Bundle Analysis\` is a ${REQ} context, and GitHub`.match(CLASSIFIES)).toEqual([
      `${REQ} context`,
    ]);
    expect(`      # a ${REQ} context turning red on someone else's diff`.match(CLASSIFIES)).toEqual([
      `${REQ} context`,
    ]);
    expect(`Bundle Analysis is not ${REQ}.`.match(CLASSIFIES)).toEqual([`is not ${REQ}`]);
    // ...and stays quiet on the citations the prose is now allowed to carry.
    expect(
      'lists it under `OPTIONAL_CONTEXTS`; no `merge_group` leg in the `on:` block'.match(CLASSIFIES),
    ).toBeNull();
  });

  it('reads three files that are really there, not three empty strings', () => {
    for (const [name, file] of Object.entries(POPULATION)) {
      const source = fs.readFileSync(file, 'utf8');
      expect(source.length, `${name} read as empty`).toBeGreaterThan(1000);
      expect(source, `${name} is no longer about this gate`).toContain('Bundle Analysis');
    }
  });

  it.each(Object.entries(POPULATION))('%s asserts no such classification', (name, file) => {
    const hits = [...fs.readFileSync(file, 'utf8').matchAll(CLASSIFIES)].map((m) => m[0]);
    expect(
      hits,
      `${name} classifies a check against the branch-protection set (${hits.join(', ')}). That set ` +
        'is not readable from inside a checkout, so the sentence is a standing claim no reader can ' +
        'check and nothing goes red when it drifts — which is the whole of objectui#9155. Cite what ' +
        'the tree answers instead: the `OPTIONAL_CONTEXTS` entry in `scripts/dependabot-merge-gate.mjs` ' +
        "with its own stated reason, and the absence of a `merge_group` leg in the workflow's `on:` block.",
    ).toEqual([]);
  });

  /**
   * The must-STAY half, and the reason this block is two-sided. On its own,
   * "the eight sentences are gone" is equally consistent with someone having
   * converged the CLASSIFIER onto the prose — moving `Bundle Analysis` into
   * `REQUIRED_CONTEXTS` — which is a maintainer decision this card explicitly
   * did not make, and which `dependabot-merge-gate.mjs` reserves twice in its
   * own comments. This leg is what tells the two apart.
   */
  it('leaves the classifier saying what it said: `Bundle Analysis` is still OPTIONAL', () => {
    expect(Object.hasOwn(OPTIONAL_CONTEXTS, 'Bundle Analysis')).toBe(true);
    expect(REQUIRED_CONTEXTS).not.toContain('Bundle Analysis');
    // Non-empty guards: both memberships are read off tables that exist, so a
    // pair of emptied constants cannot read as agreement.
    expect(REQUIRED_CONTEXTS.length).toBeGreaterThan(0);
    expect(Object.keys(OPTIONAL_CONTEXTS).length).toBeGreaterThan(0);
    // The reason travels with the entry — the prose cites it, so it has to stay.
    expect(OPTIONAL_CONTEXTS['Bundle Analysis']).toContain('performance-budget.yml filters on paths');
  });

  /**
   * The other cited source, re-derived rather than restated: the prose may say
   * this job has no `merge_group` leg only for as long as that is true of the
   * `on:` block. Guarded by locating a block that is found and substantial
   * first, so a renamed section cannot pass by scanning nothing.
   */
  it('leaves the workflow without the `merge_group` leg the prose cites the absence of', () => {
    const source = fs.readFileSync(workflowPath, 'utf8');
    const start = source.indexOf('\non:\n');
    const end = source.indexOf('\npermissions:\n');
    expect(start, 'the `on:` block is not where this pin looks for it').toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const onBlock = source.slice(start, end);
    expect(onBlock.length).toBeGreaterThan(200);
    expect(onBlock).toContain('  push:');
    expect(onBlock).toContain('  pull_request:');
    expect(onBlock).not.toMatch(/^\s{2}merge_group:/m);
  });
});
