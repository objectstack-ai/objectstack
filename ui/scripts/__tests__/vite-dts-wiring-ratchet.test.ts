import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');

/**
 * Every `vite-plugin-dts` build in this repository spreads BOTH shared dts
 * factories into its `dts()` call, and this is the gate that keeps it that way.
 *
 * ## Why a gate and not a convention
 *
 * Both fixes are one line per `vite.config.ts`, and the absence of that line is
 * invisible: the build stays green, the typings still get written, and nothing
 * anywhere says a package opted out. That is not a hypothetical failure mode —
 * it is the recorded history of both modules:
 *
 *  - `scripts/vite-dts-fail-on-type-errors.ts` landed with objectui#5370 wired
 *    into ONE of 22 call sites. For the other 21, the declaration program kept
 *    printing a type error and `vite build` kept exiting 0 (objectui#5483).
 *  - `scripts/vite-dts-explicit-extensions.ts` landed with objectui#5365 wired
 *    into TWO of 22. The other 20 kept emitting extensionless relative
 *    specifiers into `dist/**\/*.d.ts` — 410 of them, measured on the tree this
 *    gate was written against (objectui#5439).
 *
 * In the words of objectui#5483: 1-of-22 is "a state someone has to remember",
 * and forgetting costs nothing at the moment of forgetting. A new dts package
 * cannot land unwired for either reason once this file exists.
 *
 * ## What is asserted, and why each one
 *
 *  1. The POPULATION is derived from the tree, never listed here — a
 *     hand-copied enumeration drifts by construction, and the direction it
 *     drifts is toward checking fewer packages.
 *  2. The population has a FLOOR. A walk that finds nothing must go red, not
 *     green: a renamed directory or a changed config filename would otherwise
 *     turn this whole file into a gate that passes because it checks zero
 *     things — the one failure mode a ratchet cannot notice about itself.
 *  3. Both spreads are located by AST, not by substring. `toContain` is
 *     satisfied by the factory's name appearing in a COMMENT, which is exactly
 *     the shape of a call site someone disabled and explained.
 *  4. Exclusions are a fixed, capped table, and each one's stated reason is
 *     RE-DERIVED from the tree rather than trusted as prose. An exclusion whose
 *     premise stopped holding fails here instead of quietly exempting a package
 *     forever.
 */

/** The two shared factories every dts build owes. */
const FACTORIES = [
  {
    name: 'createDtsExplicitExtensions',
    module: 'scripts/vite-dts-explicit-extensions.ts',
    defect: 'extensionless relative specifiers in the emitted typings (objectui#5365 / #5439)',
  },
  {
    name: 'createDtsFailOnTypeErrors',
    module: 'scripts/vite-dts-fail-on-type-errors.ts',
    defect: '`vite build` exiting 0 on a type error the dts program printed (objectui#5370 / #5483)',
  },
] as const;

/**
 * The floor the population may not fall below.
 *
 * 22 config files call `dts(` today. The floor is deliberately BELOW that — it
 * is a vacuity guard, not a second copy of the count, so retiring a plugin
 * package is an ordinary green change while a walk that resolves nothing is
 * not. Raise it only alongside a reason that the smaller number is impossible.
 */
const POPULATION_FLOOR = 15;

/** Read a workspace package's `build` script. */
function buildScript(pkgDir: string): string {
  const manifest = path.join(ROOT, pkgDir, 'package.json');
  return JSON.parse(fs.readFileSync(manifest, 'utf8')).scripts?.build ?? '';
}

/**
 * Call sites deliberately NOT wired to one factory.
 *
 * `holds()` re-derives the stated reason from the tree. A reason that stops
 * being true takes the exclusion with it, so this table cannot decay into a
 * list of packages nobody remembers exempting.
 */
const EXCLUSIONS: ReadonlyArray<{
  readonly config: string;
  readonly factory: string;
  readonly reason: string;
  readonly holds: () => boolean;
}> = [
  {
    config: 'packages/fields/vite.config.ts',
    factory: 'createDtsFailOnTypeErrors',
    reason:
      "@object-ui/fields builds with `tsc && vite build && …`; the leading `tsc` exits " +
      'non-zero on the same diagnostics BEFORE `vite build` runs, so the dts leg’s exit ' +
      'code is not what decides this build (objectui#5483).',
    holds: () => /^tsc\s*&&/.test(buildScript('packages/fields')),
  },
];

/**
 * Ceiling on the exclusion table.
 *
 * Equal to its length today, on purpose: adding an exclusion means editing two
 * places and reading this paragraph, which is the review point. The number may
 * go DOWN freely — that is a package getting wired.
 */
const MAX_EXCLUSIONS = 1;

function isExcluded(config: string, factory: string): boolean {
  return EXCLUSIONS.some((e) => e.config === config && e.factory === factory);
}

/** Every `vite.config.*` under the workspace roots, repo-relative. */
function viteConfigs(): string[] {
  const found: string[] = [];
  for (const root of ['packages', 'apps', 'examples']) {
    const dir = path.join(ROOT, root);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const name of ['vite.config.ts', 'vite.config.mts', 'vite.config.js']) {
        const file = path.join(dir, entry.name, name);
        if (fs.existsSync(file)) found.push(path.relative(ROOT, file));
      }
    }
  }
  return found.sort();
}

interface DtsCallSite {
  /** Repo-relative path to the config. */
  readonly config: string;
  /** Factory names spread into the `dts()` options object, by AST. */
  readonly spreads: ReadonlySet<string>;
  /** Module specifiers the config imports, by AST. */
  readonly imports: ReadonlySet<string>;
}

/**
 * The `dts()` call in a config, or null if it has none.
 *
 * `dts` must be the local name bound to the `vite-plugin-dts` default import —
 * a same-named local helper is not this population, and pretending otherwise
 * would let a package join the gate's subject set by coincidence.
 */
function dtsCallSite(config: string): DtsCallSite | null {
  const file = path.join(ROOT, config);
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  const imports = new Set<string>();
  let dtsLocalName: string | null = null;
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    imports.add(statement.moduleSpecifier.text);
    if (statement.moduleSpecifier.text !== 'vite-plugin-dts') continue;
    const name = statement.importClause?.name;
    if (name !== undefined) dtsLocalName = name.text;
  }
  if (dtsLocalName === null) return null;

  const spreads = new Set<string>();
  let sawCall = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === dtsLocalName
    ) {
      sawCall = true;
      const [options] = node.arguments;
      if (options !== undefined && ts.isObjectLiteralExpression(options)) {
        for (const property of options.properties) {
          if (!ts.isSpreadAssignment(property)) continue;
          const spread = property.expression;
          if (ts.isCallExpression(spread) && ts.isIdentifier(spread.expression)) {
            spreads.add(spread.expression.text);
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(source);

  return sawCall ? { config, spreads, imports } : null;
}

const CONFIGS = viteConfigs();
const CALL_SITES = CONFIGS.map(dtsCallSite).filter((s): s is DtsCallSite => s !== null);

describe(`vite-plugin-dts wiring ratchet — ${CALL_SITES.length} dts( call sites of ${CONFIGS.length} vite configs`, () => {
  it(`finds a real population: ${CALL_SITES.length} call sites, floor ${POPULATION_FLOOR}`, () => {
    // Non-vacuity. Everything below is a statement about CALL_SITES, so an
    // empty walk would make every one of those assertions pass by having
    // nothing to judge. This is the assertion that cannot be satisfied that way.
    expect(CALL_SITES.length).toBeGreaterThanOrEqual(POPULATION_FLOOR);
    expect(CONFIGS.length).toBeGreaterThanOrEqual(CALL_SITES.length);
  });

  for (const factory of FACTORIES) {
    it(`every dts( call site spreads ${factory.name}`, () => {
      const missing = CALL_SITES.filter(
        (site) => !site.spreads.has(factory.name) && !isExcluded(site.config, factory.name),
      ).map((site) => site.config);

      expect(
        missing,
        `${missing.length} vite-plugin-dts call site(s) do not spread ` +
          `\`${factory.name}({ packageDir: __dirname })\`, so they still carry ` +
          `${factory.defect}:\n` +
          missing.map((c) => `  - ${c}`).join('\n') +
          `\n\nAdd the spread, in the form pinned by packages/layout/vite.config.ts. If a ` +
          `package genuinely cannot be wired, that is a finding worth an issue — and an ` +
          `entry in EXCLUSIONS above with a reason this file can re-derive, not a silent ` +
          `omission.`,
      ).toEqual([]);
    });

    it(`every call site that spreads ${factory.name} imports it from ${factory.module}`, () => {
      // A spread of a same-named local function would satisfy the assertion
      // above while running none of the shared module's code.
      const wrong = CALL_SITES.filter((site) => site.spreads.has(factory.name)).filter((site) => {
        const wanted = path
          .relative(path.dirname(path.join(ROOT, site.config)), path.join(ROOT, factory.module))
          .split(path.sep)
          .join('/');
        return !site.imports.has(wanted);
      });
      expect(wrong.map((s) => s.config)).toEqual([]);
    });
  }

  it('exclusions stay capped, and each one names a live call site', () => {
    expect(EXCLUSIONS.length).toBeLessThanOrEqual(MAX_EXCLUSIONS);
    for (const exclusion of EXCLUSIONS) {
      expect(
        CALL_SITES.some((site) => site.config === exclusion.config),
        `EXCLUSIONS names ${exclusion.config}, which is not a dts( call site any more. ` +
          `A stale exclusion must go red here rather than exempt a path that no longer exists.`,
      ).toBe(true);
      expect(FACTORIES.map((f) => f.name)).toContain(exclusion.factory);
    }
  });

  it('every exclusion re-derives its stated reason from the tree', () => {
    for (const exclusion of EXCLUSIONS) {
      expect(
        exclusion.holds(),
        `The reason ${exclusion.config} is exempt from ${exclusion.factory} no longer holds:\n` +
          `  ${exclusion.reason}\n` +
          `Wire the factory in, or replace the exclusion with one whose premise is true.`,
      ).toBe(true);
    }
  });
});
