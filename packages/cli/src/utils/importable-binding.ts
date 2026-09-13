// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Can a consumer IMPORT the barrel alias a scaffolder is about to write? (#17410)
 *
 * ## The defect this exists to end
 *
 * `os generate <type> <name>` writes two files, and the barrel is the one with
 * a consumer: `export { default as <alias> } from './<file>'`. An ES module
 * export clause admits a reserved word there — `ModuleExportName` is an
 * `IdentifierName`, not a `BindingIdentifier` — so the line PARSES. The import
 * side does not: `import { class } from './index'` needs an `ImportedBinding`,
 * and a reserved word is not one. The command therefore exited **0** and wrote
 * a barrel entry no consumer can name:
 *
 *     os generate view class          exit 0
 *     src/views/class.view.ts    ->  const classViews: UI.View = {   // parses
 *     src/views/index.ts         ->  export { default as class } …   // parses
 *     the consumer               ->  import { class } from './views' // SYNTAX ERROR
 *
 * Every layer in front is satisfied, each correctly by its own terms: `class`
 * is inside the charset `packages/spec` declares for an object `name` (#16726 —
 * every character is a lowercase letter), and both emitted files parse
 * (#16541). The gap is exactly a name that is charset-legal AND
 * emission-parseable whose emitted binding is unusable downstream, and
 * `generate.ts` names it in its own words above the parse check.
 *
 * ## ⛔ What this is NOT
 *
 * **Not a third charset.** The #16726 ruling says ⛔ no third charset and this
 * adds none: no character is judged here, and a name of any shape that a
 * consumer can import passes. **Not a sanitiser** — it returns the compiler's
 * reasons and never a repaired alias, so the name the author wrote stays the
 * name that lands (option B, refused in `nameCharsetRefusal`, would decouple
 * them). **Not a relaxation of anything**: it is asked AFTER both landed
 * layers and can only ever refuse more, never less.
 *
 * ## ⛔ Why there is no list of reserved words
 *
 * The obvious implementation is an array of keywords, and it is wrong in both
 * directions at once — which is the whole reason this question needed
 * measuring rather than recalling:
 *
 *   - **Too narrow.** The 36 always-reserved words (`class`, `new`, `enum`, …)
 *     are the ones everybody writes down. But modules are automatically in
 *     strict mode, so `let`, `yield`, `static`, `implements`, `interface`,
 *     `package`, `private`, `protected`, `public` are reserved **here** too,
 *     and `await` is reserved at the top level of a module. All ten are
 *     charset-legal, all ten reached `exit 0`, and a hand-picked list that
 *     stops at the obvious 36 ships the same defect for them. Measured: 46
 *     words, not 36.
 *   - **Too wide.** `type`, `as`, `from`, `async`, `get`, `set`, `keyof`,
 *     `satisfies`, `using`, `undefined`, `arguments`, `eval` and the rest of
 *     the contextual set are perfectly legal import bindings. Refusing a
 *     merely-contextual reserved word would break names that work today —
 *     the failure direction that costs an author a working command.
 *
 * No list gets both right and stays right: the boundary moves with the
 * language, and the position matters more than the word (a reserved word is
 * legal as an `export { default as … }` alias and illegal as an import
 * binding). So the judge is **TypeScript's own parser, asked in the exact
 * position the consumer must write** — the same instrument and the same
 * reasoning as {@link findEmissionParseFailures}, one question further down.
 *
 * ## Why the probe is a two-file module graph
 *
 * A lone `import { <alias> } from './m';` is not enough, and the difference is
 * measurable: the strict-mode reservations above are **grammar** checks the
 * compiler reports as SEMANTIC diagnostics, so a syntactic-only verdict is
 * structurally blind to all ten of them. Resolving the import makes the
 * semantic bucket clean enough to read — the control returns **zero**
 * diagnostics — so both buckets can be required empty and the ten are seen.
 *
 * Asking it as a real graph buys one more thing: the probe does not depend on
 * the layers in front of it. A multi-token alias (`a, b`) or one carrying an
 * escape (`a } from "./x"; const y = 1; //`) parses perfectly well as a bare
 * import clause — it is simply a *different* import — and is refused here
 * because `typeof <alias>` then does not hold together. So this layer stands
 * on its own, exactly as the other two do.
 *
 * `noLib` keeps the verdict about the grammar of these bytes rather than about
 * a `lib.d.ts` a scaffold has no business needing, and the module and
 * resolution modes are stated rather than defaulted so the verdict does not
 * drift with a compiler upgrade.
 *
 * ## Why `ts` arrives through a lazy import
 *
 * The same call, for the same reason, as `emitted-source-parses.ts`: `ts-morph`
 * is already a CLI runtime dependency and re-exports the compiler namespace,
 * and the parser is a heavy load that only a command which reaches this check
 * should pay for.
 */

import type { ts as TS } from 'ts-morph';

const BARREL = '/barrel.ts';
const CONSUMER = '/consumer.ts';

/**
 * The diagnostics TypeScript reports for importing `alias` by name from a
 * barrel that exports it, flattened to text.
 *
 * Both buckets are read: the syntactic one carries the always-reserved words
 * and the malformed shapes, the semantic one carries the strict-mode and
 * module-level reservations. An empty array means a consumer can write
 * `import { <alias> } from './…'` and refer to the result.
 *
 * Exported so a pin can reach the instrument the command actually uses instead
 * of a second copy of it that could drift green.
 */
export function namedImportDiagnostics(ts: typeof TS, alias: string): string[] {
  const sources: Record<string, string> = {
    // The barrel re-exports under `alias` — legal for any `IdentifierName`,
    // which is precisely why the emitted line is not where this shows up.
    [BARREL]: `declare const value: unknown;\nexport { value as ${alias} };\n`,
    // The consumer side: name it in an import clause, then refer to it. The
    // reference is load-bearing — it is what refuses an alias that merely
    // parses as some *other* import clause.
    [CONSUMER]: `import { ${alias} } from './barrel';\ntype Used = typeof ${alias};\nexport type { Used };\n`,
  };
  const files = new Map<string, TS.SourceFile>(
    Object.entries(sources).map(([name, source]) => [
      name,
      ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS),
    ]),
  );
  const host: TS.CompilerHost = {
    getSourceFile: (requested) => files.get(requested),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => files.has(f),
    readFile: (f) => sources[f],
  };
  const program = ts.createProgram([CONSUMER, BARREL], {
    noLib: true,
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  }, host);
  const consumer = files.get(CONSUMER)!;
  return [
    ...program.getSyntacticDiagnostics(consumer),
    ...program.getSemanticDiagnostics(consumer),
  ].map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

/**
 * The compiler's reasons a consumer could not import `alias` by name, or
 * `null` when it can.
 *
 * `null` is the accept verdict and is the answer for every name that already
 * produced importable output — ⛔ never that the check was skipped: `alias` is
 * the same string the command interpolates into the barrel it writes.
 */
export async function findBarrelAliasRefusal(alias: string): Promise<string[] | null> {
  const { ts } = await import('ts-morph');
  const diagnostics = namedImportDiagnostics(ts, alias);
  return diagnostics.length > 0 ? diagnostics : null;
}
