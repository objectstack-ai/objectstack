// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pin: **no CLI command hands a child process an environment that activates
 * oclif's TypeScript source loader.**
 *
 * ## The failure this exists to refuse
 *
 * `os dev` auto-compiles when `dist/objectstack.json` is absent, by spawning
 * `os compile` as a child. That spawn carried a hard-coded
 * `NODE_ENV: 'development'`. Oclif activates its tsx-based TypeScript source
 * loader whenever `NODE_ENV` is `'development'` or `'test'`; tsx honours the
 * **cwd** tsconfig's `paths`; and an example app's tsconfig maps workspace
 * packages to their TypeScript **source** — `@objectstack/formula` →
 * `../../packages/formula/src/index.ts`. Those packages are CommonJS, so once
 * the redirect lands on a `.ts` file, Node's CJS resolver walks that file's
 * sibling relative imports and knows nothing about `.ts`:
 *
 *     Cannot find module './registry'
 *     Require stack:
 *     - packages/formula/src/index.ts
 *     ✗ Compile failed — fix errors above before starting dev server
 *
 * A **type-resolution directive leaking into runtime resolution**. Measured on
 * the three example apps, the failures map 1:1 onto each app's `paths` entries:
 * app-showcase (formula + plugin-email) fails on both specifiers, app-crm
 * (formula only) on one, app-todo (no `paths` block) on none.
 *
 * ⛔ The import **spelling** was never the variable, and this is the part most
 * likely to be re-litigated: `plugin-email` already ships the explicit
 * `./email-plugin.js` extension and fails identically to `formula`'s
 * extensionless `./registry`. Adding extensions to the redirected packages
 * cannot fix this, and neither can removing the `paths` blocks — those are
 * mandated by `pnpm check:type-source-resolution`, which was green throughout.
 * So was `pnpm check:test-source-alias`. The two gates cover the **types** axis
 * and the **vitest** axis; the axis that broke — a CLI child's **runtime**
 * module resolution — is covered by neither, which is why the defect lived on
 * `main` while every gate reported success. The general third-axis guard is
 * separate scope and tracked separately; this pin is the narrow half that
 * belongs to the fix.
 *
 * ## What is actually pinned, and why it is a source assertion
 *
 * The knowledge was already in the tree: `dev.ts`'s **serve** spawn carries a
 * NOTE saying not to set `NODE_ENV='development'`, for an independent reason.
 * `start.ts`'s compile spawn passes `process.env` unmodified, and `dev.ts`'s
 * watch-mode recompile spawn does too. Three of the four sibling spawns were
 * right; the fourth was missed, and a comment on one of two call sites is what
 * a guard is for.
 *
 * ⚠️ **Why not spawn a real `os compile` from an example-app cwd** — the
 * end-to-end form of this assertion, which was considered first and rejected on
 * two measured grounds:
 *
 *  1. **It could not be made to fail.** Turbo's `test` task declares
 *     `dependsOn: ["^build"]` — *dependencies'* builds, not the package's own —
 *     so `packages/cli/dist`, which `bin/run.js` loads, is not guaranteed to
 *     exist when this suite runs. A spawn-based pin would have to skip on an
 *     unbuilt tree: green exactly when it cannot look. The package's other
 *     subprocess tests avoid that by spawning `bin/run-dev.js` **through tsx**
 *     — which starts the child with the source loader already active, so it
 *     cannot distinguish the state this pin exists to distinguish.
 *  2. **It is the package's dominant cost.** `vitest.config.ts`'s header
 *     records the measurement: the 20 files that spawn the real CLI are 56.1%
 *     of this package's file wall (300.1s) for 177 of 1498 tests, at a ~6.5s
 *     floor per spawn.
 *
 * So the property is asserted where it is decidable and cheap — over the
 * command sources themselves — and the behaviour it stands for was verified by
 * hand against all three example apps.
 *
 * ## The four assertions, and why each is needed
 *
 * - **The property.** No command source writes a loader-activating `NODE_ENV`
 *   into a child environment. Reverting the fix re-adds exactly such a write.
 * - **The scan reached real code.** A detector that silently stops finding
 *   anything passes forever; this asserts the walk found the supervisor
 *   commands, and that it reports the *real, safe* `NODE_ENV` write `start.ts`
 *   makes (`'production'`) — proof it is reading production source and
 *   grading it, not returning an empty list.
 * - **Specimens.** The pre-fix spawn options are classified as a violation, a
 *   non-literal value is too (it cannot be proven safe), and a `'production'`
 *   child env is not — so the pin is not merely "any `NODE_ENV` is red".
 * - **The vocabulary is oclif's, not ours.** `'development'` and `'test'` are
 *   read back out of `@oclif/core`'s own `isProd()`. If a future version
 *   changes which values activate the loader, this reds and the next author
 *   re-derives the set instead of trusting the two strings above.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'path';
import ts from 'typescript';

/**
 * The `NODE_ENV` values that make oclif register its TypeScript source loader.
 *
 * Not a choice — oclif's `isProd()` is
 * `!['development', 'test'].includes(process.env.NODE_ENV ?? '')`, and the
 * loader lookup is skipped only when that is true. Pinned against oclif's own
 * shipped source below.
 */
const SOURCE_LOADER_ACTIVATING = new Set(['development', 'test']);

const COMMANDS_DIR = fileURLToPath(new URL('.', import.meta.url));

/** How a `NODE_ENV` write was spelled — reported so a failure is actionable. */
type WriteShape =
  | 'object property'
  | 'shorthand property'
  | 'property assignment'
  | 'indexed assignment';

interface NodeEnvWrite {
  file: string;
  line: number;
  shape: WriteShape;
  /** True when the assignment target is `process.env` itself. */
  inProcess: boolean;
  /** The static string value, or `undefined` when it is not a literal. */
  value: string | undefined;
}

interface Analysis {
  file: string;
  /** Whether the file starts a child process at all. */
  spawnsChild: boolean;
  writes: NodeEnvWrite[];
}

const CHILD_PROCESS_STARTERS = new Set([
  'spawn', 'spawnSync', 'fork', 'exec', 'execSync', 'execFile', 'execFileSync',
]);

/**
 * Read `NODE_ENV` writes and child-process starts off the TypeScript AST.
 *
 * Deliberately a parser and not a text scan, for the reason the sibling pin in
 * `artifact-child-env.pin.test.ts` records: a comment-stripping regex over
 * these very files reported one of them clean while it carried the write, because
 * a `/*` inside a string literal opened a phantom comment that swallowed
 * hundreds of lines of real code. Strings and comments cannot lie to a parser.
 *
 * Reads are never collected — `process.env.NODE_ENV === 'test'` is how several
 * commands decide their own mode, and that must stay possible. Only writes.
 */
const analyze = (file: string, text: string): Analysis => {
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const writes: NodeEnvWrite[] = [];
  let spawnsChild = false;

  const lineOf = (node: ts.Node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const staticName = (node: ts.Node): string | undefined =>
    ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;

  const literalValue = (node: ts.Node): string | undefined =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;

  /** `process.env` — the current process's environment, not a child's. */
  const isProcessEnv = (node: ts.Node): boolean =>
    ts.isPropertyAccessExpression(node)
    && node.name.text === 'env'
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'process';

  const calleeName = (expr: ts.Expression): string | undefined => {
    if (ts.isIdentifier(expr)) return expr.text;
    if (ts.isPropertyAccessExpression(expr)) return expr.name.text;
    return undefined;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name && CHILD_PROCESS_STARTERS.has(name)) spawnsChild = true;
    }

    // `{ NODE_ENV: value }`
    if (ts.isPropertyAssignment(node) && staticName(node.name) === 'NODE_ENV') {
      writes.push({
        file,
        line: lineOf(node),
        shape: 'object property',
        inProcess: false,
        value: literalValue(node.initializer),
      });
    }

    // `{ NODE_ENV }` — whatever the binding holds; never statically safe.
    if (ts.isShorthandPropertyAssignment(node) && node.name.text === 'NODE_ENV') {
      writes.push({
        file, line: lineOf(node), shape: 'shorthand property', inProcess: false, value: undefined,
      });
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const lhs = node.left;
      // `env.NODE_ENV = value`
      if (ts.isPropertyAccessExpression(lhs) && lhs.name.text === 'NODE_ENV') {
        writes.push({
          file,
          line: lineOf(node),
          shape: 'property assignment',
          inProcess: isProcessEnv(lhs.expression),
          value: literalValue(node.right),
        });
      }
      // `env['NODE_ENV'] = value`
      if (
        ts.isElementAccessExpression(lhs)
        && staticName(lhs.argumentExpression) === 'NODE_ENV'
      ) {
        writes.push({
          file,
          line: lineOf(node),
          shape: 'indexed assignment',
          inProcess: isProcessEnv(lhs.expression),
          value: literalValue(node.right),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { file, spawnsChild, writes };
};

/**
 * The writes that put a child under the source loader.
 *
 * A write to `process.env.NODE_ENV` is exempt **only in a file that starts no
 * child process** — that is a command setting its own mode (`serve.ts` does it
 * deliberately, after its imports have already been loaded). In a file that
 * does spawn, the same write reaches the child through the inherited
 * environment, so it is graded like any other.
 *
 * A value that is not a static string literal is a violation: it cannot be
 * proven safe, and this pin refuses to guess.
 */
const dangerousWrites = (a: Analysis): NodeEnvWrite[] =>
  a.writes.filter((w) => {
    if (w.inProcess && !a.spawnsChild) return false;
    return w.value === undefined || SOURCE_LOADER_ACTIVATING.has(w.value);
  });

const describeWrite = (w: NodeEnvWrite) =>
  `${w.file}:${w.line} (${w.shape}, value ${w.value === undefined ? 'NOT A LITERAL' : `'${w.value}'`})`;

/** Every non-test command source, recursively. */
const commandSources = (): Analysis[] => {
  const out: Analysis[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      if (/\.(test|pin\.test|contract\.test|integration\.test)\.ts$/.test(entry.name)) continue;
      if (entry.name.endsWith('.d.ts')) continue;
      out.push(analyze(rel, readFileSync(path.join(dir, entry.name), 'utf8')));
    }
  };
  walk(COMMANDS_DIR, '');
  return out;
};

describe('no CLI command puts a child process under oclif\'s TypeScript source loader', () => {
  const sources = commandSources();

  it('writes no loader-activating NODE_ENV into any child environment', () => {
    const offenders = sources.flatMap(dangerousWrites).map(describeWrite);

    expect(
      offenders,
      'A child spawned with NODE_ENV=development (or =test) runs under oclif\'s tsx source '
      + 'loader. tsx honours the CWD tsconfig\'s `paths`, and example apps map workspace '
      + 'packages to their .ts source there — so the child resolves a CommonJS package to '
      + 'TypeScript and Node\'s CJS resolver then fails on that file\'s sibling imports '
      + '(`Cannot find module \'./registry\'`), killing `os dev` before the server starts. '
      + 'Neither check:type-source-resolution (types axis) nor check:test-source-alias '
      + '(vitest axis) sees this; they were both green while it was broken. Pass the child '
      + '`process.env` unmodified, or a NODE_ENV that is not '
      + `${[...SOURCE_LOADER_ACTIVATING].map((v) => `'${v}'`).join(' or ')}`
      + ' — and if a child genuinely needs dev semantics, let the child command set them '
      + 'internally, after its own module loading is done (serve.ts does exactly that).',
    ).toEqual([]);
  });

  it('scanned the supervisor commands, and graded the real write start.ts makes', () => {
    const scanned = sources.map((s) => s.file);
    // Without this the assertion above could pass by having found nothing.
    for (const required of ['dev.ts', 'start.ts', 'serve.ts', 'compile.ts']) {
      expect(scanned, `${required} must be among the scanned command sources`).toContain(required);
    }

    // `start.ts` really does write NODE_ENV into the env it hands `serve`
    // (`if (!localEnv.NODE_ENV) localEnv.NODE_ENV = 'production';`). The
    // detector must SEE it and judge it safe — that is what distinguishes a
    // working detector from one that reports nothing.
    const startWrites = sources.find((s) => s.file === 'start.ts')?.writes ?? [];
    expect(
      startWrites.map((w) => w.value),
      'start.ts is expected to write a NODE_ENV into its child env; if that stopped being '
      + 'true, re-confirm this detector still finds writes at all before trusting its silence.',
    ).toContain('production');
    expect(startWrites.some((w) => w.value === 'production' && !w.inProcess)).toBe(true);
  });

  it('classifies the pre-fix spawn — and only the unsafe shapes — as violations', () => {
    // Verbatim shape of the defect, so a revert of the fix is provably red here.
    const preFix = analyze('specimen-dev.ts', [
      'const compileResult = spawnSync(',
      '  process.execPath,',
      "  [binPath, 'compile', '--output', artifactPath],",
      "  { stdio: 'inherit', env: { ...process.env, NODE_ENV: 'development' } },",
      ');',
    ].join('\n'));
    expect(preFix.spawnsChild).toBe(true);
    expect(dangerousWrites(preFix).map((w) => `${w.shape}:${w.value}`))
      .toEqual(['object property:development']);

    // A value the pin cannot evaluate is not assumed innocent.
    const dynamic = analyze('specimen-dynamic.ts',
      'spawn(bin, args, { env: { ...process.env, NODE_ENV: mode } });');
    expect(dangerousWrites(dynamic)).toHaveLength(1);
    expect(dangerousWrites(dynamic)[0].value).toBeUndefined();

    // ...but a non-activating value is fine: this pin is not "no NODE_ENV ever".
    const safe = analyze('specimen-safe.ts',
      "spawn(bin, args, { env: { ...process.env, NODE_ENV: 'production' } });");
    expect(dangerousWrites(safe)).toEqual([]);

    // A command that sets its OWN mode and spawns nothing is untouched.
    const inProcess = analyze('specimen-serve.ts',
      "if (flags.dev && !process.env.NODE_ENV) { process.env.NODE_ENV = 'development'; }");
    expect(inProcess.spawnsChild).toBe(false);
    expect(dangerousWrites(inProcess)).toEqual([]);

    // ...but the same write in a file that DOES spawn reaches the child.
    const leaks = analyze('specimen-leak.ts',
      "process.env.NODE_ENV = 'development'; spawnSync(bin, args, { env: process.env });");
    expect(dangerousWrites(leaks)).toHaveLength(1);
  });

  it('takes its activating vocabulary from oclif, not from this file', () => {
    // `@oclif/core`'s `exports` map does not publish `lib/util/util.js`, so the
    // predicate is read off disk rather than imported. Resolution goes through
    // `package.json`, which IS exported — no hard-coded node_modules layout.
    const require_ = createRequire(import.meta.url);
    const oclifRoot = path.dirname(require_.resolve('@oclif/core/package.json'));
    const utilSource = readFileSync(path.join(oclifRoot, 'lib', 'util', 'util.js'), 'utf8');

    const body = /function isProd\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(utilSource)?.[1];
    expect(
      body,
      'Could not read `isProd()` out of @oclif/core. That predicate is the whole reason this '
      + 'pin forbids the two values it forbids, so re-derive the activating set from the '
      + 'installed version rather than leaving this assertion unable to look.',
    ).toBeTruthy();

    const literals = new Set(
      [...body!.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]).filter(Boolean),
    );
    expect(
      [...literals].sort(),
      'The NODE_ENV values that activate oclif\'s TypeScript source loader have changed. '
      + 'Widen (or narrow) SOURCE_LOADER_ACTIVATING in this file to match, and re-read the '
      + 'NOTEs on the spawns in dev.ts — they name these values explicitly.',
    ).toEqual([...SOURCE_LOADER_ACTIVATING].sort());
  });
});
