import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { SPAWNERS } from './helpers/spawners';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');

/**
 * A build a TEST spawns must not inherit `VITEST` (objectui#8598).
 *
 * ## The defect this closes, and why it needs a gate rather than a comment
 *
 * Vitest sets `VITEST=true` in its worker, and a child process inherits the
 * worker's environment. All 24 `packages/*` vite configs open with
 * `if (process.env.VITEST) { assertCanonicalVitestInvocation(...) }`, and that
 * guard derives its "vitest root" from `cwd` when argv carries no `--root`. So
 * a build spawned as `pnpm --filter PKG run build` — cwd = the package
 * directory — is read as a vitest run launched from the wrong place, and the
 * guard calls `process.exit(1)` before the bundler starts.
 *
 * ⚠️ It is invisible until two independent things line up: a test that spawns a
 * build, and a target package whose build loads a vite config. objectui#8598
 * created the second half by giving `@object-ui/types` a `vite build` step, and
 * `Test (shard 2/4)` went red in CI on a diff that touched no test at all. The
 * build script is correct in isolation, the spawning test is correct in
 * isolation, and the guard is correct in isolation — nothing but their
 * intersection is wrong, which is exactly the shape no reviewer of one file
 * catches.
 *
 * ## Why HERE, and not in the configs
 *
 * ⛔ The alternative repair — teach one config to gate on vite's `command`
 * instead of the variable — was rejected twice over. It diverges 1 of 24
 * otherwise byte-identical guard blocks, and
 * `scripts/__tests__/vitest-invocation-guard.test.ts` mechanically REFUSES that
 * divergence: its "gates that call on VITEST" case requires the literal
 * `if (process.env.VITEST) {` + `assertCanonicalVitestInvocation(` shape in
 * every `packages/*` vite config. ⭐ And that ratchet's own name states the
 * property being violated — "gates that call on VITEST, so `vite build` is never
 * refused". The leak falsifies it from OUTSIDE, where no config can see it, so
 * the repair belongs at the spawn: the only place that knows its child is a
 * build and not a test run.
 *
 * ## What is asserted
 *
 *  1. The population is derived from the tree, never listed — a hand-copied
 *     enumeration drifts toward checking fewer call sites.
 *  2. It has a FLOOR and a named member, so a walk that resolves nothing goes
 *     red instead of green. That is the one failure a ratchet cannot notice
 *     about itself.
 *  3. Spawns are found by AST, not by substring: `toContain('VITEST')` is
 *     satisfied by the word appearing in a comment, which is precisely the shape
 *     of a call site somebody explained instead of fixing.
 *  4. ⭐ The environment is judged by what it DOES to `VITEST`, never by whether
 *     the token occurs in it. Measured for objectui#8712, while the judgement
 *     was `env.includes('VITEST')`: `env: { ...process.env, VITEST: 'true' }` —
 *     a tree that SETS the variable this gate exists to remove — passed at
 *     `2 passed`, and the idiomatic rest-pattern scrub
 *     `const { VITEST: _v, ...BUILD_ENV } = process.env` was REFUSED at both
 *     call sites. Presence of the token was the wrong question in both
 *     directions at once. Removal is the property, so removal is what is read.
 */

/** Test files anywhere in the workspace — the only files this gate judges. */
function testFiles(): string[] {
  const found: string[] = [];
  const skip = new Set(['node_modules', 'dist', 'build', 'coverage', '.turbo', '.next', '.git']);
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(test|spec)\.tsx?$/.test(entry.name)) found.push(path.relative(ROOT, full));
    }
  };
  for (const top of ['packages', 'apps', 'scripts', 'examples']) walk(path.join(ROOT, top));
  return found.sort();
}

/**
 * What the resolved `env:` expression does to `VITEST`.
 *
 * `scrubbed` — it is REMOVED, in either idiomatic spelling: `delete env.VITEST`
 *   on a copy, or a rest pattern that binds the key away
 *   (`const { VITEST: _v, ...env } = process.env`). Both are correct fixes and
 *   both are accepted.
 * `sets`     — an object literal ASSIGNS `VITEST`. ⛔ The one shape that must
 *   never pass: it is the exact leak this gate exists to stop, spelled out.
 * `inherits` — neither of those. No `env:` at all, or one that hands the child
 *   the parent's environment unchanged.
 */
type EnvVerdict = 'scrubbed' | 'sets' | 'inherits';

interface BuildSpawn {
  readonly file: string;
  readonly line: number;
  readonly verdict: EnvVerdict;
}

/** The name a property or binding element is keyed by, when it is a plain one. */
function keyName(key: ts.PropertyName | ts.BindingName | undefined): string | null {
  if (key === undefined) return null;
  if (ts.isIdentifier(key)) return key.text;
  if (ts.isStringLiteralLike(key)) return key.text;
  return null;
}

/** `delete <anything>.VITEST`, in either accessor spelling. */
function deletesVitest(node: ts.Node): boolean {
  if (!ts.isDeleteExpression(node)) return false;
  const target = node.expression;
  if (ts.isPropertyAccessExpression(target)) return target.name.text === 'VITEST';
  return (
    ts.isElementAccessExpression(target) &&
    ts.isStringLiteralLike(target.argumentExpression) &&
    target.argumentExpression.text === 'VITEST'
  );
}

/** `{ VITEST: _v, ...rest }` — binds the key away and collects everything else. */
function omitsVitest(pattern: ts.ObjectBindingPattern): boolean {
  const collectsRest = pattern.elements.some((element) => element.dotDotDotToken !== undefined);
  const bindsVitest = pattern.elements.some(
    (element) =>
      element.dotDotDotToken === undefined &&
      keyName(element.propertyName ?? element.name) === 'VITEST',
  );
  return collectsRest && bindsVitest;
}

/** An object literal that ASSIGNS `VITEST` — the leak, written on purpose. */
function assignsVitest(node: ts.Node): boolean {
  if (!ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some(
    (property) =>
      (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
      keyName(property.name) === 'VITEST',
  );
}

/** Where a `const`/`let` named `name` in this file gets its value. */
interface Declared {
  /** Its initializer, when the name is bound directly. */
  readonly initializer: ts.Expression | null;
  /** The pattern it is the rest element of, when it is destructured out of one. */
  readonly restOf: ts.ObjectBindingPattern | null;
}

function declarationOf(source: ts.SourceFile, name: string): Declared | null {
  let found: Declared | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) {
      if (ts.isIdentifier(node.name) && node.name.text === name && node.initializer !== undefined) {
        found = { initializer: node.initializer, restOf: null };
      } else if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (
            element.dotDotDotToken !== undefined &&
            ts.isIdentifier(element.name) &&
            element.name.text === name
          ) {
            found = { initializer: null, restOf: node.name };
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return found;
}

/**
 * What an `env:` expression does to `VITEST`.
 *
 * ⚠️ Resolving names is the difference between this gate working and this gate
 * looking like it works. The fix it enforces is naturally written as a named
 * constant (`env: BUILD_ENV`), and the property alone says nothing about
 * `VITEST` — so a gate reading only the property reports the FIXED tree as
 * leaking. Measured: it did, on both call sites, before this resolved.
 *
 * ⛔ The resolution stays deliberately narrow — the declaration of the name the
 * spawn passes, and the names spread into it, never the whole file. A wider
 * search answers "does this file mention `VITEST`", and a comment about the
 * variable answers that just as well as a line removing it.
 */
function verdictFor(value: ts.Expression, source: ts.SourceFile, seen: Set<string>): EnvVerdict {
  if (ts.isIdentifier(value)) {
    if (seen.has(value.text)) return 'inherits';
    seen.add(value.text);
    const declared = declarationOf(source, value.text);
    if (declared === null) return 'inherits';
    if (declared.restOf !== null) return omitsVitest(declared.restOf) ? 'scrubbed' : 'inherits';
    return declared.initializer === null
      ? 'inherits'
      : verdictFor(declared.initializer, source, seen);
  }

  let removes = false;
  let assigns = false;
  const visit = (node: ts.Node): void => {
    if (deletesVitest(node)) removes = true;
    if (ts.isObjectBindingPattern(node) && omitsVitest(node)) removes = true;
    if (assignsVitest(node)) assigns = true;
    if (ts.isSpreadAssignment(node) && ts.isIdentifier(node.expression)) {
      const inner = verdictFor(node.expression, source, seen);
      if (inner === 'scrubbed') removes = true;
      if (inner === 'sets') assigns = true;
    }
    node.forEachChild(visit);
  };
  visit(value);

  // An assignment wins over a removal in the same expression: whatever else it
  // did, the child ends up carrying the variable.
  if (assigns) return 'sets';
  return removes ? 'scrubbed' : 'inherits';
}

/** Every call in `file` that starts a child process running a `build` script. */
function buildSpawns(file: string): BuildSpawn[] {
  const abs = path.join(ROOT, file);
  const text = fs.readFileSync(abs, 'utf8');
  // Cheap pre-filter, then AST. Every judgement below is made on the AST.
  if (!text.includes('build')) return [];

  const source = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true);
  const found: BuildSpawn[] = [];

  const namesABuild = (node: ts.CallExpression): boolean =>
    node.arguments.some((arg) => {
      if (ts.isStringLiteralLike(arg)) return /(^|\s)build(\s|$)/.test(arg.text);
      if (ts.isArrayLiteralExpression(arg)) {
        return arg.elements.some((el) => ts.isStringLiteralLike(el) && el.text === 'build');
      }
      return false;
    });

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : ts.isIdentifier(node.expression)
          ? node.expression.text
          : '';
      if (SPAWNERS.has(callee) && namesABuild(node)) {
        const options = node.arguments.find(ts.isObjectLiteralExpression.bind(ts));
        let verdict: EnvVerdict = 'inherits';
        if (options !== undefined) {
          for (const property of options.properties) {
            const key =
              property.name !== undefined && ts.isIdentifier(property.name) ? property.name.text : '';
            if (key !== 'env') continue;
            if (ts.isPropertyAssignment(property)) {
              verdict = verdictFor(property.initializer, source, new Set<string>());
            } else if (ts.isShorthandPropertyAssignment(property)) {
              verdict = verdictFor(property.name, source, new Set<string>());
            }
          }
        }
        found.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          verdict,
        });
      }
    }
    node.forEachChild(visit);
  };
  visit(source);
  return found;
}

const SPAWNS = testFiles().flatMap(buildSpawns);

/**
 * The gate's verdict on a set of spawns, rendered — one line per spawn that
 * does NOT remove `VITEST`. This is the list the assertion below requires to be
 * empty, so the fixture case at the bottom of this file can drive the REAL
 * judgement rather than a paraphrase of it.
 */
function leakingIn(spawns: readonly BuildSpawn[]): string[] {
  return spawns
    .filter((s) => s.verdict !== 'scrubbed')
    .map(
      (s) =>
        `${s.file}:${s.line} — this environment ${
          s.verdict === 'sets' ? 'SETS `VITEST`' : 'hands the child `VITEST` unchanged'
        }`,
    );
}

/**
 * The floor, plus a named member.
 *
 * Two build spawns exist today, both in `cli-bin.test.ts`. The floor is set at
 * 1 rather than 2 on purpose: it is a vacuity guard, not a second copy of the
 * count, so retiring one spawn stays an ordinary green change while a walk that
 * resolves nothing does not.
 */
const POPULATION_FLOOR = 1;
const NAMED_MEMBER = 'packages/cli/src/__tests__/cli-bin.test.ts';

describe(`objectui#8598 — ${SPAWNS.length} build spawn(s) in the test tree`, () => {
  it(`finds a real population: floor ${POPULATION_FLOOR}, and ${NAMED_MEMBER}`, () => {
    expect(SPAWNS.length).toBeGreaterThanOrEqual(POPULATION_FLOOR);
    expect(SPAWNS.map((s) => s.file)).toContain(NAMED_MEMBER);
  });

  it('every one of them scrubs VITEST from the child environment', () => {
    const leaking = leakingIn(SPAWNS);

    expect(
      leaking,
      'These start a BUILD from inside a vitest worker without removing `VITEST` from the ' +
        "child's environment. Every packages/* vite config refuses to load when it sees that " +
        'variable with a cwd that is not the repo root, so the build exits 1 before the bundler ' +
        'runs and the test reports a build failure it did not cause (objectui#8598, ' +
        '`Test (shard 2/4)`). Remove the key — `delete env.VITEST` on a copy, or a ' +
        '`{ VITEST: _v, ...env }` rest pattern; both are accepted. See `BUILD_ENV` in ' +
        `${NAMED_MEMBER}:\n  ` + leaking.join('\n  '),
    ).toEqual([]);
  });
});

/**
 * ⭐ That this gate can see a `fork()` build at all (objectui#9211).
 *
 * `fork` was missing from this gate's spawner set while its objectui#8616
 * sibling had it, and both sets were hand-maintained copies. objectui#9211
 * replaced the two copies with one — `helpers/spawners.ts` — converging UPWARD,
 * onto the set that includes `fork`.
 *
 * ⚠️ This case is not decoration, it is the only thing that measures the
 * change. The LIVE population of `fork(` call sites across `packages`, `apps`,
 * `scripts` and `examples` is ZERO — re-measured on this branch's base, with
 * `spawnSync(` at 35 in the same run as the control that proves the zero is a
 * reading and not a broken command. So against the real tree, a run with `fork`
 * in the set and a run without it produce byte-identical results, and the whole
 * suite going green says nothing whatsoever about whether `fork` is covered.
 * The fixtures below supply the population the tree does not have.
 *
 * They are a PAIR differing only in the `env:`, so what is demonstrated is the
 * gate judging the environment of a `fork` — not merely noticing the call:
 *
 *   - `fork-build-inherits.fixture.ts` hands the child `{ ...process.env }`.
 *     The gate must report it — RED.
 *   - `fork-build-scrubbed.fixture.ts` binds `VITEST` away with a rest pattern.
 *     The gate must clear it — GREEN.
 *
 * Both legs read the population count as well as the verdict: drop `fork` from
 * `SPAWNERS` and neither file resolves to a spawn at all, so the leaking list
 * for the first fixture goes EMPTY and this case fails on a count of 0 rather
 * than passing vacuously. ⛔ That is the failure mode a verdict-only assertion
 * would have: "nothing leaks" and "nothing was looked at" are the same string.
 *
 * ⚠️ The fixtures carry `.fixture.ts`, which `testFiles()` does not match, so
 * the deliberate leak in the first one is invisible to the live census above
 * and cannot turn the real gate red.
 */
const FIXTURES = 'scripts/__tests__/fixtures/spawned-build-vitest-env-8598';

describe('objectui#9211 — the population includes fork()', () => {
  it('a fork() build handed the environment unchanged is SEEN, and is reported', () => {
    const spawns = buildSpawns(`${FIXTURES}/fork-build-inherits.fixture.ts`);

    expect(
      spawns.length,
      'The fixture holds exactly one `fork(…, [\'build\'], { env })`. A count of 0 means this ' +
        'gate no longer treats `fork` as a spawner — check `SPAWNERS` in `helpers/spawners.ts` ' +
        '(objectui#9211). Every assertion below would pass vacuously on an empty population.',
    ).toBe(1);
    expect(spawns.map((s) => s.verdict)).toEqual(['inherits']);
    expect(leakingIn(spawns)).toEqual([
      `${FIXTURES}/fork-build-inherits.fixture.ts:${spawns[0].line} — this environment hands the child \`VITEST\` unchanged`,
    ]);
  });

  it('control — the same fork() with VITEST scrubbed is SEEN, and is cleared', () => {
    const spawns = buildSpawns(`${FIXTURES}/fork-build-scrubbed.fixture.ts`);

    // Same count assertion, same reason: an empty population would clear this
    // fixture too, and for the wrong reason.
    expect(spawns.length, 'see the sibling case — a count of 0 measures nothing').toBe(1);
    expect(spawns.map((s) => s.verdict)).toEqual(['scrubbed']);
    expect(leakingIn(spawns)).toEqual([]);
  });
});
