// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#17410) — the instrument that decides whether a generated barrel alias
 * can be imported by name, measured across every class of word that matters.
 *
 * ## What this file measures, and what it deliberately does not
 *
 * This is the UNIT half: given an alias, does the check refuse it. The other
 * half — that the COMMAND consults it, before the writes, on every branch, and
 * exits non-zero — cannot be measured here, because `process.exitCode` set in
 * a vitest worker is not an exit status. That half is
 * `generate-refuses-unimportable-alias.test.ts`, on a real child process, for
 * the same reasons its two siblings document at length.
 *
 * ## ⛔ Why the rows are word CLASSES and not a list of keywords
 *
 * The implementation could have been an array of reserved words, and the
 * reason it is not is the reason these rows are grouped this way: a list is
 * wrong in **both** directions, and only a matrix that carries both failure
 * directions can hold that. The classes below are therefore not decoration —
 * each is a distinct way to get this wrong:
 *
 *   - `ALWAYS_RESERVED` (36) — the words everybody writes down. Refusing only
 *     these is the **too narrow** failure.
 *   - `STRICT_MODE_RESERVED` (10) — reserved because a module is automatically
 *     in strict mode (`await` because it is reserved at a module's top level).
 *     Every one is charset-legal and every one reached `exit 0` before this
 *     layer, so a list stopping at the obvious 36 ships the same defect for
 *     them. These are the rows a SYNTACTIC-only verdict cannot see at all: the
 *     compiler reports them as grammar errors in the SEMANTIC bucket, which is
 *     why the instrument reads both and why its probe resolves its own import.
 *   - `CONTEXTUAL_ONLY` (31) — legal import bindings that merely look
 *     keyword-ish. Refusing one of these is the **too wide** failure, and it is
 *     the expensive direction: it breaks a name that works today. ⭐ These rows
 *     are the load-bearing control of this file.
 *   - `REAL_NAMES` (14) — the second control: ordinary authored names,
 *     including near-misses (`classy`, `klass`, `letter`, `statically`,
 *     `awaited`, `myClass`) that a substring-matching implementation would
 *     refuse while satisfying every assertion about `class` and `let`.
 *   - `MALFORMED` (8) — multi-token and escape-shaped aliases. They are
 *     stopped by the charset gate long before this layer, and are asserted
 *     here anyway so this layer is measured as standing on its own rather than
 *     on the one in front: a bare `import { a, b } from './m'` parses fine, it
 *     is simply a different import, and only asking the graph to hold together
 *     refuses it. ⛔ A future edit that makes this layer depend on the charset
 *     gate reddens here.
 *
 * A refusal that fired on everything would satisfy every `REFUSES` row in this
 * file and would be a far worse command than the broken one, so the two
 * control classes are asserted with the same instrument, in the same run.
 */

import { describe, expect, it } from 'vitest';
import { ts } from 'ts-morph';
import { namedImportDiagnostics, findBarrelAliasRefusal } from '../src/utils/importable-binding.js';

/** Reserved in every context — illegal as an import binding, always. */
const ALWAYS_RESERVED = [
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'new', 'null',
  'return', 'super', 'switch', 'this', 'throw', 'true', 'try', 'typeof',
  'var', 'void', 'while', 'with',
];

/**
 * Reserved because the file is a MODULE, and modules are automatically in
 * strict mode. Invisible to a syntactic-only verdict.
 */
const STRICT_MODE_RESERVED = [
  'implements', 'interface', 'let', 'package', 'private', 'protected',
  'public', 'static', 'yield', 'await',
];

/** ⭐ CONTROL — keyword-ish, and perfectly legal as an import binding. */
const CONTEXTUAL_ONLY = [
  'as', 'async', 'from', 'get', 'of', 'set', 'type', 'any', 'string', 'number',
  'boolean', 'never', 'unknown', 'declare', 'namespace', 'module', 'abstract',
  'asserts', 'infer', 'is', 'keyof', 'readonly', 'require', 'satisfies', 'out',
  'accessor', 'using', 'undefined', 'globalThis', 'arguments', 'eval',
];

/** ⭐ CONTROL — ordinary names, plus near-misses of the refused words. */
const REAL_NAMES = [
  'order_line', 'orderLine', 'classViews', '_internal', 'x2', 'customer',
  'sales_order', 'lead_qual', 'myClass', 'classy', 'klass', 'letter',
  'statically', 'awaited',
];

/** Not a single token at all — the charset gate's territory, asserted anyway. */
const MALFORMED = [
  'a, b',
  'a as b',
  'a } from "./x"; const y = 1; //',
  'a\nb',
  'a.b',
  'a-b',
  'a*/b',
  'a`b',
];

describe('[#17410] the reserved-word classes a keyword list gets wrong', () => {
  it.each(ALWAYS_RESERVED)('refuses `%s` — reserved in every context', (alias) => {
    expect(namedImportDiagnostics(ts, alias).length).toBeGreaterThan(0);
  });

  it.each(STRICT_MODE_RESERVED)(
    'refuses `%s` — reserved because a module is strict mode',
    (alias) => {
      // ⚠️ The rows a syntactic-only check cannot see. Asserted individually
      // so that narrowing the instrument back to one bucket names the word it
      // stopped seeing rather than emptying a whole describe block.
      expect(namedImportDiagnostics(ts, alias).length).toBeGreaterThan(0);
    },
  );

  it('names the STRICT-MODE reason, so the verdict is not a coincidence', () => {
    // A refusal that fired for the wrong reason would satisfy the row above.
    // These words are refused specifically because a module is strict, and the
    // compiler says so — if this stops matching, the instrument has changed
    // what it is measuring even though the pass/fail is unchanged.
    expect(namedImportDiagnostics(ts, 'let').join(' ')).toContain(
      "'let' is a reserved word in strict mode",
    );
    expect(namedImportDiagnostics(ts, 'await').join(' ')).toContain(
      "'await' is a reserved word at the top-level of a module",
    );
  });

  it('⛔ the always-reserved set is refused for a DIFFERENT reason than strict mode', () => {
    // `class` cannot be an import binding at all, strict mode or not, and the
    // compiler's reason for it carries no strict-mode clause. Pinned so the
    // two classes cannot silently collapse into one code path.
    const classReasons = namedImportDiagnostics(ts, 'class').join(' ');
    expect(classReasons).toContain('Identifier expected');
    expect(classReasons).not.toContain('strict mode');
  });
});

describe('[#17410] ⭐ CONTROL — every name that works today still works', () => {
  it.each(CONTEXTUAL_ONLY)('admits `%s` — contextual only, legal as a binding', (alias) => {
    // ⛔ The expensive failure direction. Refusing one of these breaks a
    // working command, which is why the accept verdict is asserted per word
    // rather than as a count.
    expect(namedImportDiagnostics(ts, alias)).toEqual([]);
  });

  it.each(REAL_NAMES)('admits `%s` — an ordinary authored name', (alias) => {
    expect(namedImportDiagnostics(ts, alias)).toEqual([]);
  });

  it('the control classes are not empty, and the two verdicts really differ', () => {
    // Guards the shape of this file rather than the code: an `it.each` over an
    // accidentally-empty array passes by running nothing.
    expect(CONTEXTUAL_ONLY.length).toBe(31);
    expect(REAL_NAMES.length).toBe(14);
    expect(ALWAYS_RESERVED.length).toBe(36);
    expect(STRICT_MODE_RESERVED.length).toBe(10);
    // And the instrument discriminates: same call, opposite answers.
    expect(namedImportDiagnostics(ts, 'class')).not.toEqual([]);
    expect(namedImportDiagnostics(ts, 'classy')).toEqual([]);
  });
});

describe('[#17410] this layer stands on its own, not on the charset gate', () => {
  it.each(MALFORMED)('refuses `%j` — not a single import binding', (alias) => {
    expect(namedImportDiagnostics(ts, alias).length).toBeGreaterThan(0);
  });

  it('⛔ a bare import clause is NOT enough to refuse a multi-token alias', () => {
    // The measurement that decided the probe's shape, kept as an assertion so
    // the reasoning cannot be simplified away. `import { a, b } from './m'`
    // parses — it is simply a *different* import — so a probe that only parsed
    // an import clause would admit it. Requiring the alias to be REFERRED to
    // is what refuses it.
    const fileName = 'probe.ts';
    const source = `import { a, b } from './m';`;
    const sourceFile = ts.createSourceFile(
      fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
    );
    const host: ts.CompilerHost = {
      getSourceFile: (requested) => (requested === fileName ? sourceFile : undefined),
      getDefaultLibFileName: () => 'lib.d.ts',
      writeFile: () => {},
      getCurrentDirectory: () => '/',
      getCanonicalFileName: (f) => f,
      useCaseSensitiveFileNames: () => true,
      getNewLine: () => '\n',
      fileExists: (f) => f === fileName,
      readFile: (f) => (f === fileName ? source : undefined),
    };
    const program = ts.createProgram(
      [fileName], { noLib: true, noResolve: true, target: ts.ScriptTarget.Latest }, host,
    );
    expect(program.getSyntacticDiagnostics(sourceFile)).toEqual([]);
    // ⇒ and the instrument this command uses refuses it anyway.
    expect(namedImportDiagnostics(ts, 'a, b').length).toBeGreaterThan(0);
  });
});

describe('[#17410] the async wrapper the command actually calls', () => {
  it('returns the compiler`s reasons for a refused alias, and null for an accepted one', async () => {
    const refused = await findBarrelAliasRefusal('class');
    expect(refused).not.toBeNull();
    expect(refused!.length).toBeGreaterThan(0);
    // ⛔ `null` is the ACCEPT verdict, never "could not run": a wrapper that
    // swallowed a loader failure would return null for `class` too.
    expect(await findBarrelAliasRefusal('order_line')).toBeNull();
  });

  it('agrees with the synchronous instrument it wraps', async () => {
    // One question, one answer — a wrapper that drifted would let the command
    // and every pin above disagree while both stayed green.
    for (const alias of ['class', 'let', 'await', 'type', 'order_line']) {
      const wrapped = await findBarrelAliasRefusal(alias);
      const direct = namedImportDiagnostics(ts, alias);
      expect(wrapped).toEqual(direct.length > 0 ? direct : null);
    }
  });
});
