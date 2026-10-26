import { describe, expect, it } from 'vitest';
import { resolveConfig } from 'vite';
import type { InlineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#10865 — every `optimizeDeps.include` entry of the console config
 * resolves the way `pnpm dev` resolves it.
 *
 * Moved here from `vite-objectstack-spec-dist.test.ts` when that module's
 * `OBJECTSTACK_SPEC_DIST` injection left with the objectstack pin
 * (objectstack#25711): this case is about the console config, not the
 * injection, and it is kept as it was.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** The spec package, the subject of the "aborts" control below. */
const SPEC_PACKAGE_NAME = '@objectstack/spec';

/**
 * A package the console certainly resolves from its own root: the control that
 * proves the dev resolver resolves anything at all.
 */
const VITE_ORACLE_CONTROL = 'react';

async function loadConsoleConfig(query = ''): Promise<any> {
  const specifier = `../../apps/console/vite.config.ts${query}`;
  return (await import(/* @vite-ignore */ specifier)).default;
}

/** The directory `pnpm dev` runs Vite in, and therefore the root it resolves from. */
const consoleRoot = path.join(repoRoot, 'apps/console');

/** A package on no `node_modules` walk from the console root: the "skipped" control. */
const ABSENT_PACKAGE_CONTROL = 'objectui-10865-no-such-package';

/**
 * A subpath the spec's exports map does not declare: the "aborts" control. It is
 * the same shape as the bare `react-map-gl` entry, on a package whose map this
 * file already reconciles.
 */
const UNEXPORTED_SUBPATH_CONTROL = `${SPEC_PACKAGE_NAME}/objectui-10865-no-such-subpath`;

type IncludeVerdict = { kind: 'resolved'; id: string } | { kind: 'skipped' } | { kind: 'aborts'; message: string };

/**
 * How the dev server treats each `optimizeDeps.include` entry. The answer comes
 * from Vite itself, not from a transcription of its algorithm.
 *
 * The list is read by `vite` (dev) only. `vite build` never reads it, so no
 * build, E2E or type-check job can see a bad entry. In the Vite this was written
 * against (8.2), `addManuallyIncludedOptimizeDeps` resolves every entry before
 * the server listens, through `createOptimizeDepsIncludeResolver`. For the
 * client environment that resolver is `config.createResolver({ asSrc: false,
 * scan: true })`, called with NO importer, so it resolves from the root. The
 * deprecated `createResolver` is used here on purpose: Vite's own include
 * resolver calls it.
 *
 * Two outcomes are defects, and they fail differently:
 *
 *   - **aborts**: the package is found, but its exports map has no such subpath.
 *     The resolver throws, and `vite` exits 1 before it listens. This is
 *     objectui#10865, measured with a bare `react-map-gl` entry: react-map-gl 8
 *     exports no `.`.
 *   - **skipped**: the package cannot be reached from the root. Vite logs
 *     `Failed to resolve dependency` and pre-bundles nothing for the entry. This
 *     was the `maplibre-gl` entry objectui#10865 removed.
 */
async function includeVerdicts(config: InlineConfig, specifiers: string[]): Promise<Map<string, IncludeVerdict>> {
  const resolved = await resolveConfig(
    { ...config, root: consoleRoot, configFile: false, envFile: false, logLevel: 'silent' },
    'serve',
    'development'
  );
  const resolve = resolved.createResolver({ asSrc: false, scan: true });
  const verdicts = new Map<string, IncludeVerdict>();
  for (const specifier of specifiers) {
    try {
      const id = await resolve(specifier);
      verdicts.set(specifier, id ? { kind: 'resolved', id } : { kind: 'skipped' });
    } catch (error) {
      verdicts.set(specifier, { kind: 'aborts', message: String((error as Error).message).split('\n')[0] });
    }
  }
  return verdicts;
}

describe('objectui#10865: every optimizeDeps.include entry resolves the way the dev server resolves it', () => {
  it('resolves each entry from the console root under the dev conditions', async () => {
    // A separate evaluation, so that whatever `resolveConfig` does to the object
    // it is handed cannot reach the instance the cases above compare.
    const config = await loadConsoleConfig('?optimize-deps-include=10865');
    const include = config.optimizeDeps.include as string[];
    // Anti-vacuity: a list that read as empty would "resolve" with nothing to check.
    expect(include.length).toBeGreaterThan(0);
    // Vite resolves nested (`dep > sub`) and glob entries by other paths, and
    // this case models only flat entries. Extend it before adding either form.
    expect(
      include.filter((specifier) => specifier.includes('>') || specifier.includes('*')),
      'nested or glob include entries, which this case does not model'
    ).toEqual([]);

    const verdicts = await includeVerdicts(config, [
      ...include,
      VITE_ORACLE_CONTROL,
      ABSENT_PACKAGE_CONTROL,
      UNEXPORTED_SUBPATH_CONTROL,
    ]);

    // Controls with a KNOWN outcome, in the SAME run. The instrument has to be
    // able to report all three outcomes, or a clean result below means nothing.
    expect(verdicts.get(VITE_ORACLE_CONTROL)?.kind, 'dev resolver resolved nothing: broken instrument').toBe(
      'resolved'
    );
    expect(verdicts.get(ABSENT_PACKAGE_CONTROL)?.kind, 'an absent package did not read as skipped').toBe('skipped');
    expect(verdicts.get(UNEXPORTED_SUBPATH_CONTROL)?.kind, 'an unexported subpath did not read as aborting').toBe(
      'aborts'
    );

    const findings = include.flatMap((specifier) => {
      const verdict = verdicts.get(specifier)!;
      if (verdict.kind === 'aborts') return [`${specifier}: aborts the dev server start (${verdict.message})`];
      if (verdict.kind === 'skipped') {
        return [`${specifier}: not reachable from apps/console, so it is skipped with a warning and pre-bundles nothing`];
      }
      return [];
    });
    expect(findings, 'optimizeDeps.include entries the dev server cannot resolve (objectui#10865)').toEqual([]);
  });
});
