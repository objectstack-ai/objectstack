import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `pnpm test:integration` was `vitest run --project ui` while no project named
 * `ui` existed anywhere in the config (objectui#7096).
 *
 * The drift is structural, not a typo. `ui` was a real project once: it was
 * declared in `vitest.workspace.ts` (1bdba0693, 2026-02-28) as the COMPLEMENT
 * of `unit` — every `*.test.{ts,tsx}` under `packages`/`apps`/`examples` except
 * the four pure-logic packages. That file was deleted in 85c872487 (2026-05-24)
 * because Vitest 4 removed `defineWorkspace` and had been silently ignoring it,
 * which took `unit` AND `ui` down together. `unit` came back as an inline
 * project in `vitest.config.mts` (e850c5695) and `test:unit` started resolving
 * again by accident — that commit never touched `package.json`. Nothing ever
 * re-declared `ui`, so `test:integration` was left naming a project that had
 * stopped existing three months earlier, and no run of it ever reported that:
 * a script nobody invokes is a script nobody sees fail.
 *
 * So the two halves are pinned to each other here: every `--project` name a
 * ROOT script passes must be a project this repo actually declares.
 *
 * Direction matters. The assertion is `script names ⊆ declared names`, so an
 * over-wide declared set never fails — which makes every leg of the derivation
 * silently vacuous unless it has its own control. Each one below is asserted
 * against a name measured on this tree.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOT_PACKAGE_JSON = path.join(repoRoot, 'package.json');
const ROOT_VITEST_CONFIG = path.join(repoRoot, 'vitest.config.mts');

/**
 * Every `--project` value in a command string, in order.
 *
 * Written here rather than reused from `scripts/vitest-invocation-guard.mjs`:
 * that parser keeps flags in a plain object, so a REPEATED flag collapses to
 * its last value — and `--project dom --project dom-heavy` (what `test:integration`
 * became) is exactly that shape. Reusing it would have checked `dom-heavy` and
 * quietly skipped `dom`.
 */
function projectNamesIn(command: string): string[] {
  const names: string[] = [];
  const tokens = command.split(/\s+/).filter(Boolean);

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith('--project=')) {
      names.push(token.slice('--project='.length));
      continue;
    }
    if (token === '--project' && tokens[i + 1] !== undefined) {
      names.push(tokens[i + 1]);
      i += 1;
    }
  }

  return names;
}

/** `{ scriptName: [project, …] }` for every root script that filters on a project. */
function projectFiltersInRootScripts(): Record<string, string[]> {
  const pkg = JSON.parse(fs.readFileSync(ROOT_PACKAGE_JSON, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  const out: Record<string, string[]> = {};

  for (const [scriptName, command] of Object.entries(pkg.scripts ?? {})) {
    const names = projectNamesIn(command);
    if (names.length > 0) out[scriptName] = names;
  }

  return out;
}

/**
 * Every project name this repo declares, from BOTH shapes the `projects` array
 * uses:
 *
 *  - inline objects with a literal `name:` (`unit`, `dom`, `dom-heavy`, and the
 *    env-gated `dist`) — read off the source text rather than by importing the
 *    config, because an import answers a DIFFERENT question: `dist` only
 *    materialises when `OBJECTUI_DIST_PINS=1`, so the imported list depends on
 *    the environment while the declaration surface does not. Importing would
 *    also execute that file's module scope (including its `--project dist`
 *    argv guard, which throws) inside this test process.
 *  - a path to another config (`./apps/console/vitest.config.ts`), whose
 *    project name Vitest derives from that directory's `package.json` when the
 *    config declares none. `@object-ui/console` is a usable `--project` filter
 *    and appears as no `name:` literal anywhere, so a pin that read only the
 *    literals would go red on a root script that legitimately named it.
 */
function declaredProjectNames(): Set<string> {
  const configText = fs.readFileSync(ROOT_VITEST_CONFIG, 'utf8');
  const names = new Set<string>();

  for (const [, name] of configText.matchAll(/\bname:\s*'([^']+)'/g)) names.add(name);

  for (const [, relative] of configText.matchAll(/__dirname,\s*'(\.\/[^']*vitest\.config\.[cm]?ts)'/g)) {
    const configPath = path.resolve(repoRoot, relative);
    if (!fs.existsSync(configPath)) continue;

    const ownName = fs.readFileSync(configPath, 'utf8').match(/\bname:\s*'([^']+)'/);
    if (ownName) {
      names.add(ownName[1]);
      continue;
    }

    const packageJsonPath = path.join(path.dirname(configPath), 'package.json');
    if (!fs.existsSync(packageJsonPath)) continue;
    const { name } = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { name?: string };
    if (name) names.add(name);
  }

  return names;
}

describe('projectNamesIn', () => {
  it('collects EVERY --project value, not just the last one', () => {
    // The regression this exists for: `test:integration` passes two.
    expect(projectNamesIn('vitest run --project dom --project dom-heavy')).toEqual([
      'dom',
      'dom-heavy',
    ]);
  });

  it('reads the `--project=name` form too', () => {
    expect(projectNamesIn('vitest run --project=unit')).toEqual(['unit']);
  });

  it('finds nothing in a command that filters on no project', () => {
    expect(projectNamesIn('vitest run')).toEqual([]);
    // `--project` is not a prefix match: `--projects` is a different flag.
    expect(projectNamesIn('vitest run --projects foo')).toEqual([]);
  });
});

describe('root package.json --project filters', () => {
  it('names at least the scripts this pin exists for (an extractor that found nothing would pass vacuously)', () => {
    const filters = projectFiltersInRootScripts();

    expect(filters['test:unit']).toEqual(['unit']);
    expect(filters['test:integration']).toBeDefined();
    expect(filters['test:integration']!.length).toBeGreaterThan(0);
  });

  it('every project a root script filters on is declared', () => {
    const declared = declaredProjectNames();
    const offenders: string[] = [];

    for (const [scriptName, names] of Object.entries(projectFiltersInRootScripts())) {
      for (const name of names) {
        if (!declared.has(name)) {
          offenders.push(`pnpm ${scriptName} → --project ${name}`);
        }
      }
    }

    expect(
      offenders,
      `Root scripts filter on ${offenders.length} project(s) that vitest.config.mts does not ` +
        `declare, so those scripts cannot run:\n  ${offenders.join('\n  ')}\n` +
        `Declared: ${[...declaredProjectNames()].sort().join(', ')}\n` +
        'Point the script at a project that exists — do NOT add a project to make the ' +
        'stale name resolve (objectui#7096).'
    ).toEqual([]);
  });
});

describe('declaredProjectNames controls', () => {
  it('finds the inline projects (a regex matching nothing would make the pin vacuous)', () => {
    const declared = declaredProjectNames();

    expect(declared.has('unit')).toBe(true);
    expect(declared.has('dom')).toBe(true);
    expect(declared.has('dom-heavy')).toBe(true);
    // Declared inside the `OBJECTUI_DIST_PINS` branch — present in the source
    // text either way, which is what this reads.
    expect(declared.has('dist')).toBe(true);
  });

  it('finds the project brought in by config path, whose name is nowhere a `name:` literal', () => {
    // Measured: `pnpm exec vitest list --project @object-ui/console` resolves.
    expect(declaredProjectNames().has('@object-ui/console')).toBe(true);
  });

  it('does not answer yes to everything', () => {
    // The negative half of the control: a derivation that returned a universal
    // set would satisfy the subset assertion above no matter what the scripts
    // said. Deliberately a name nobody would ever declare, so this control
    // stays a control and does not quietly become policy about which project
    // names are allowed.
    expect(declaredProjectNames().has('__no_such_vitest_project__')).toBe(false);
  });
});
