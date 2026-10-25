import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { childVitestEnv } from './helpers/child-vitest-env';
import { SPAWNERS } from './helpers/spawners';

/**
 * A vitest a TEST spawns must not inherit this container's AGENT markers
 * (objectui#8616).
 *
 * ## The defect this closes, and why it needs a gate rather than a comment
 *
 * Vitest asks `std-env` whether it runs under an AI agent and configures itself
 * differently when it does — no colour at all, its `agent` reporter instead of
 * `default`, different coverage defaults. `isAgent` comes from the ENVIRONMENT
 * (`CLAUDECODE`, `AI_AGENT`, and nine more), and a child inherits its parent's.
 * So a vitest spawned from inside an agent container is a DIFFERENT program
 * from the same command on CI, and every assertion made on its output is
 * verified against a byte stream CI never produces.
 *
 * ⚠️ The reason this is a gate and not a note: the obvious reproduction does
 * not reproduce. `CI=true` / `GITHUB_ACTIONS=true` — imitating CI, the correct
 * instinct — leaves `isAgent` true and stays green; so does `FORCE_COLOR=1`,
 * because `disableDefaultColors()` overwrites the palette after `FORCE_COLOR`
 * was consulted. Only removing the markers flips it. An author who checks
 * their new pin the sensible way gets a green that means nothing, and nothing
 * in the tree tells them otherwise. That is what this file is for.
 *
 * ⛔ Not repaired by loosening the assertions to accept either stream: that
 * discards what the pins exist to check. The repair belongs at the SPAWN — the
 * only place that knows its child is a fresh CLI and not this run's worker —
 * which is where objectui#8598's `BUILD_ENV` and objectui#8590's scoped
 * `VITEST` scrub both landed, for the same reason. `childVitestEnv()` in
 * `helpers/child-vitest-env.ts` is the one shared spelling of it.
 *
 * ## What is asserted
 *
 *  1. The population is derived from the tree, never listed — a hand-copied
 *     enumeration drifts toward checking fewer call sites. ⚠️ Measured on
 *     `4d65991c5`: the `git grep -E "spawn.*vitest|execa.*vitest"` this card
 *     was triaged from returned six files, of which FIVE matched only a
 *     COMMENT naming `spawned-build-vitest-env-8598.test.ts` — one line that
 *     carries both words — and the real spawner behind two of them was not in
 *     the list at all. A substring census of this class is not a census.
 *  2. It has a FLOOR and a named member, so a walk that resolves nothing goes
 *     red instead of green. That is the one failure a ratchet cannot notice
 *     about itself.
 *  3. Spawns are found by AST with identifiers RESOLVED to their declarations,
 *     because both halves of what is judged — which program is started, and
 *     which env it is given — are naturally written as named constants.
 *  4. ⭐ The environment is judged by what it IS, never by whether the
 *     helper's NAME occurs in its text. Measured for objectui#9013, while the
 *     judgement was `env.includes('childVitestEnv')`: two probe files differing
 *     by one COMMENT line and nothing else — `// childVitestEnv() would be the
 *     right thing to use here.` sitting above a hand-rolled
 *     `{ ...process.env, CI: 'true' }` — split `1 failed | 4 passed` from
 *     `5 passed`. A comment lives inside the declaration's span, so it was part
 *     of the text being compared, and the accepted spelling was exactly the one
 *     the sibling gate's header calls out as the thing to refuse: a call site
 *     somebody EXPLAINED instead of fixing.
 *     ⛔ Narrower than objectui#8712's hole one gate over, and ⛔ not the same
 *     defect. There, presence was the wrong test in BOTH directions because the
 *     goal was REMOVAL — a tree that SET the variable passed a gate that existed
 *     to remove it, and the idiomatic scrub was refused. Here presence of the
 *     helper IS the goal, so the only reachable hole is text that names it
 *     without calling it. ⭐ It was reachable.
 *  5. ⭐ And the helper is MEASURED, not trusted: a real child process reports
 *     `std-env`'s own `isAgent` back, once under the helper's env and once
 *     under an env the helper produced and a caller then re-marked. A helper
 *     that silently stopped scrubbing would pass every static check above.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

/** The initializer text of a `const`/`let` named `name` in this file, if there is one. */
function declarationText(source: ts.SourceFile, name: string): string | null {
  let text: string | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined
    ) {
      text = node.initializer.getText(source);
    }
    node.forEachChild(visit);
  };
  visit(source);
  return text;
}

/** An expression's own text, with a bare IDENTIFIER resolved to its declaration. */
function resolved(node: ts.Node, source: ts.SourceFile): string {
  const own = node.getText(source);
  if (ts.isIdentifier(node)) return `${own} ${declarationText(source, node.text) ?? ''}`;
  return own;
}

/**
 * Does this call start a VITEST?
 *
 * ⚠️ Deliberately narrow in one direction and wide in another. Wide: any
 * argument that resolves to text naming `vitest` counts, so `vitestCli`,
 * `node_modules/.bin/vitest`, `['pnpm', 'exec', 'vitest']` and a shell string
 * are all seen — the spelling is what the triage grep got wrong. Narrow: a
 * token that names a vitest CONFIG rather than the runner is not a spawn of
 * vitest, so it is excluded by name; `configPath` is passed to plenty of
 * children that are not vitest.
 */
function namesAVitest(node: ts.CallExpression, source: ts.SourceFile): boolean {
  const tokens: string[] = [];
  for (const arg of node.arguments) {
    if (ts.isArrayLiteralExpression(arg)) for (const el of arg.elements) tokens.push(resolved(el, source));
    else if (!ts.isObjectLiteralExpression(arg)) tokens.push(resolved(arg, source));
  }
  return tokens.some((t) => /vitest/i.test(t.replace(/vitest[.\-\w]*config[.\w]*/gi, '')));
}

/** The one shared spelling of the child environment (`helpers/child-vitest-env.ts`). */
const HELPER = 'childVitestEnv';

/**
 * What the `env:` an individual spawn passes IS — never what its text contains.
 *
 * `helper`  — it IS a call to `childVitestEnv()`, or an object literal that
 *   SPREADS one (`{ ...childVitestEnv(), NO_COLOR: '1' }`), reached directly or
 *   through the name the spawn hands the child.
 * `foreign` — there is an `env:` and it is not that: a hand-rolled copy of
 *   `process.env`, a scrub of some other key, or a comment ABOUT the helper.
 *   All three hand the child this container's agent markers.
 * `absent`  — no `env:` property at all, so the child inherits this worker's
 *   environment outright, markers included.
 */
type EnvVerdict = 'helper' | 'foreign' | 'absent';

/** `childVitestEnv(...)` — the helper, actually CALLED. */
function callsHelper(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === HELPER;
  return ts.isPropertyAccessExpression(callee) && callee.name.text === HELPER;
}

/** The initializer of a `const`/`let` named `name` in this file, as a NODE. */
function declarationInitializer(source: ts.SourceFile, name: string): ts.Expression | null {
  let found: ts.Expression | null = null;
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer !== undefined
    ) {
      found = node.initializer;
    }
    node.forEachChild(visit);
  };
  visit(source);
  return found;
}

/**
 * Where an `env:` expression's value COMES FROM.
 *
 * ⚠️ This is the judgement, and it is made on NODES. The text of the resolved
 * declaration is never consulted, because a comment sitting inside that
 * declaration's span is part of its text and answers "does this name the
 * helper" exactly as well as a line calling it does (objectui#9013).
 *
 * ⛔ The resolution stays deliberately narrow — the declaration of the name the
 * spawn passes, and the names spread into it, never the whole file. Anything
 * wider answers "does this FILE mention `childVitestEnv`", which is the same
 * question by a longer route.
 */
function envVerdict(value: ts.Expression, source: ts.SourceFile, seen: Set<string>): EnvVerdict {
  if (ts.isIdentifier(value)) {
    if (seen.has(value.text)) return 'foreign';
    seen.add(value.text);
    const initializer = declarationInitializer(source, value.text);
    return initializer === null ? 'foreign' : envVerdict(initializer, source, seen);
  }
  if (callsHelper(value)) return 'helper';
  if (ts.isObjectLiteralExpression(value)) {
    for (const property of value.properties) {
      if (!ts.isSpreadAssignment(property)) continue;
      if (envVerdict(property.expression, source, seen) === 'helper') return 'helper';
    }
  }
  return 'foreign';
}

interface VitestSpawn {
  readonly file: string;
  readonly line: number;
  /** What the `env:` this spawn passes IS — decided on the AST, never on text. */
  readonly verdict: EnvVerdict;
}

/** Every call in `file` that starts a child vitest. */
function vitestSpawns(file: string): VitestSpawn[] {
  const abs = path.join(ROOT, file);
  const text = fs.readFileSync(abs, 'utf8');
  // Cheap pre-filter, then AST. Every judgement below is made on the AST.
  if (!text.includes('vitest')) return [];

  const source = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true);
  const found: VitestSpawn[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : ts.isIdentifier(node.expression)
          ? node.expression.text
          : '';
      if (SPAWNERS.has(callee) && namesAVitest(node, source)) {
        const options = node.arguments.find(ts.isObjectLiteralExpression.bind(ts));
        let verdict: EnvVerdict = 'absent';
        if (options !== undefined) {
          for (const property of options.properties) {
            const key =
              property.name !== undefined && ts.isIdentifier(property.name) ? property.name.text : '';
            if (key !== 'env') continue;
            if (ts.isShorthandPropertyAssignment(property)) {
              verdict = envVerdict(property.name, source, new Set<string>());
            } else if (ts.isPropertyAssignment(property)) {
              verdict = envVerdict(property.initializer, source, new Set<string>());
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

const SPAWNS = testFiles().flatMap(vitestSpawns);

/**
 * The floor, plus a named member.
 *
 * The floor is set at 1 rather than at today's count on purpose: it is a
 * vacuity guard, not a second copy of the census, so retiring one spawn stays
 * an ordinary green change while a walk that resolves nothing does not.
 */
const POPULATION_FLOOR = 1;
const NAMED_MEMBER = 'scripts/__tests__/network-escape-worker-coverage-8537.test.ts';

describe(`objectui#8616 — ${SPAWNS.length} vitest spawn(s) in the test tree`, () => {
  it(`finds a real population: floor ${POPULATION_FLOOR}, and ${NAMED_MEMBER}`, () => {
    expect(SPAWNS.length).toBeGreaterThanOrEqual(POPULATION_FLOOR);
    expect(SPAWNS.map((s) => s.file)).toContain(NAMED_MEMBER);
  });

  it('every one of them builds the child environment with childVitestEnv()', () => {
    const leaking = SPAWNS.filter((s) => s.verdict !== 'helper').map(
      (s) =>
        `${s.file}:${s.line} — ${
          s.verdict === 'absent'
            ? 'no `env:` at all'
            : 'this `env:` is not `childVitestEnv()` and does not spread one'
        }`,
    );

    expect(
      leaking,
      'These start a VITEST from inside a vitest worker without going through ' +
        '`childVitestEnv()`, so the child inherits this container\'s agent markers. ' +
        'Vitest reads those and turns off colour, swaps in its `agent` reporter and ' +
        'changes coverage defaults — so whatever is asserted on the output below is a ' +
        'byte stream CI never produces, and the assertion is verified against the wrong ' +
        'thing forever (objectui#8616). ⛔ Imitating CI with `CI=true` does not expose ' +
        'it, and neither does `FORCE_COLOR=1`. Use `childVitestEnv()` from ' +
        '`scripts/__tests__/helpers/child-vitest-env.ts`. ⚠️ NAMING the helper is not ' +
        'using it — this is read off the AST, so a comment about `childVitestEnv()` ' +
        'beside a hand-rolled environment resolves to nothing (objectui#9013):\n  ' +
        leaking.join('\n  '),
    ).toEqual([]);
  });
});

/**
 * The live control. `std-env` is resolved through VITEST's own require, because
 * it is vitest's dependency and not a root one — resolving it from here is how
 * the answer stays the one vitest itself would get.
 */
const stdEnvUrl = (() => {
  const fromVitest = createRequire(createRequire(path.join(ROOT, 'noop.js')).resolve('vitest/package.json'));
  return pathToFileURL(fromVitest.resolve('std-env')).href;
})();

const PROBE = `import { isAgent } from ${JSON.stringify(stdEnvUrl)}; process.stdout.write(String(isAgent));`;

function childSaysIsAgent(env: NodeJS.ProcessEnv): string {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', PROBE], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
    timeout: 60_000,
  });
  expect(child.status, `the isAgent probe did not run: ${child.stderr}`).toBe(0);
  return child.stdout.trim();
}

describe('objectui#8616 — the helper is measured, not trusted', () => {
  it('a child given childVitestEnv() is read as a NON-agent', () => {
    expect(childSaysIsAgent(childVitestEnv())).toBe('false');
  });

  it('control — the same probe still says true when a marker survives', () => {
    // Without this, a probe that had stopped detecting anything would report
    // `false` for both, and the case above would pass while measuring nothing.
    // `overrides` win over the scrub by design, so this is also the pin on that.
    expect(childSaysIsAgent(childVitestEnv({ AI_AGENT: 'objectui-8616-control' }))).toBe('true');
  });

  it('the child carries no VITEST marker either — it is a fresh CLI', () => {
    const env = childVitestEnv();
    expect(Object.keys(env).filter((k) => k.startsWith('VITEST'))).toEqual([]);
    // And this process really is a worker, so the line above removed something.
    expect(Object.keys(process.env).filter((k) => k.startsWith('VITEST')).length).toBeGreaterThan(0);
  });
});
