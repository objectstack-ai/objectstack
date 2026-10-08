// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22238 — every place a CLI command hands its `normalized` stack to an
 * analysis, CLASSIFIED: does the analysis see a multi-package artifact's
 * package bodies, or only its top level, and if only the top level, why.
 *
 * ## The root cause this enumerates
 *
 * `composeStacks([a, b], { manifest: 'preserve' })` emits every definition
 * once, inside the body of the package that owns it (ADR-0130 D4, 2026-09-22
 * addendum). The top level keeps `manifest`, `packages` and `i18n`, and nothing
 * a package owns. `normalizeStackInput` returns that top level, so an analysis
 * handed `normalized` directly judges an EMPTY stack on such an artifact and
 * answers clean. Translation coverage (`os lint`, `os i18n check`), `os i18n
 * extract` and the undeclared-authoring-key walk (`os validate`, `os build`)
 * all did, each found one at a time. This file closes the family: a new call
 * site that takes `normalized` cannot land without a row here saying which
 * stack it reads.
 *
 * ## What a row says
 *
 * - `union`: the value the analysis reads is `authoringRuleUnionStack(…)`,
 *   either at the call or on the callee's own entry (`lintConfig`).
 * - `packages`: the callee walks `packages[]` itself.
 * - `top-level`: the analysis is about something a `preserve` artifact keeps at
 *   its top level, and the reason is written down.
 *
 * ⛔ A red here is not answered by adding a row in the nearest bucket. A
 * `top-level` row is a claim that the analysis is right on a two-package app;
 * measure it on one before writing it.
 *
 * The capability preflight (#22189) is a sibling of this family that reads
 * `config.requires` rather than `normalized`, so it is not a row in THIS
 * table; its per-package reading is pinned in `capability-preflight.test.ts`
 * and `package-union-readers.test.ts`.
 *
 * ## The second enumeration: every top-level read of a package-owned key
 *
 * `(normalized` is one spelling of the defect. `os serve` read
 * `(config as any).requires` and the scan above could not see it (#22288), and
 * neither could it see `os doctor`, `os diff`, `os generate` or `os migrate
 * meta`, whose stacks are named `config` or `stack`. The second half of this
 * file names the defect by WHAT is read rather than by the variable's name at a
 * call: a member read of a package-owned key off a receiver that holds a stack.
 * Its header, below the first table, states the grammar and its bounds.
 *
 * ## How a site is named
 *
 * By file and by the chain of callees directly wrapping the identifier, never
 * by line or by count: `computeI18nCoverage(authoringRuleUnionStack(normalized`
 * names both the analysis and the fold it reads through. A grouping paren is
 * named by the member read off it: `(normalized).i18n`. Comments and string
 * bodies are blanked first, so prose and messages do not count; the bound that
 * buys is that a site inside a template literal's `${…}` is blanked too, and none
 * exists today. Test files are not scanned.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { packageOwnedCollectionKeys } from '../src/utils/stack-collections.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const COMMANDS = resolve(HERE, '../src/commands');
const SRC = resolve(HERE, '../src');

type Reads = 'union' | 'packages' | 'top-level';

/** The classified sites. Key: `<file under src/commands> :: <site>`. */
const SITES: Readonly<Record<string, { reads: Reads; why: string }>> = {
  // ── os build ───────────────────────────────────────────────────────────
  'compile.ts :: lowerCallables(normalized': {
    reads: 'packages',
    why: 'lowers the handlers on the top level AND in each `packages[i].manifest` body (`lower-callables.ts`).',
  },
  'compile.ts :: authoringRuleUnionStack(normalized': {
    reads: 'union',
    why: 'the author-time rule table\'s `normalized` tier: it IS the fold.',
  },
  'compile.ts :: lintUnknownStackKeys(normalized': {
    reads: 'top-level',
    why: 'judges the ENVELOPE\'s own keys. A package body is a closed shape (it inherits the manifest\'s strict close), so an undeclared key there is refused by the parse, never dropped.',
  },
  'compile.ts :: lintUnknownAuthoringKeys(authoringRuleUnionStack(normalized': {
    reads: 'union',
    why: 'the undeclared-key walk over every item; moved onto the union by #22238.',
  },
  // ── os validate ────────────────────────────────────────────────────────
  'validate.ts :: lowerCallables(normalized': {
    reads: 'packages',
    why: 'as in compile.ts.',
  },
  'validate.ts :: authoringRuleUnionStack(normalized': {
    reads: 'union',
    why: 'as in compile.ts.',
  },
  'validate.ts :: lintUnknownStackKeys(normalized': {
    reads: 'top-level',
    why: 'as in compile.ts.',
  },
  'validate.ts :: lintUnknownAuthoringKeys(authoringRuleUnionStack(normalized': {
    reads: 'union',
    why: 'as in compile.ts; moved onto the union by #22238.',
  },
  // ── os lint ────────────────────────────────────────────────────────────
  'lint.ts :: resolveJsxGateManifest(normalized': {
    reads: 'union',
    why: 'counts html pages over `authoringRuleUnionStack(…)` and each package body (`sdui-manifest.ts`).',
  },
  'lint.ts :: lintConfig(normalized': {
    reads: 'union',
    why: 'folds `authoringRuleUnionStack(…)` on entry and runs the per-package pass.',
  },
  'lint.ts :: computeI18nCoverage(authoringRuleUnionStack(normalized': {
    reads: 'union',
    why: 'translation coverage; moved onto the union by #22238.',
  },
  'lint.ts :: scoreMetadata(normalized': {
    reads: 'union',
    why: 'a schema parse of the whole stack plus `lintConfig`, which folds.',
  },
  // ── os i18n ────────────────────────────────────────────────────────────
  'i18n/check.ts :: computeI18nCoverage(authoringRuleUnionStack(normalized': {
    reads: 'union',
    why: 'translation coverage; moved onto the union by #22238.',
  },
  'i18n/extract.ts :: (normalized).i18n': {
    reads: 'top-level',
    why: '`i18n` is an envelope key (its compose disposition is `single`): a `preserve` artifact keeps it at the top level and no package body carries it.',
  },
  'i18n/extract.ts :: extractTranslations(authoringRuleUnionStack(normalized': {
    reads: 'union',
    why: 'the keys extracted and the bundles merged against; moved onto the union by #22238.',
  },
  // ── os migrate meta ────────────────────────────────────────────────────
  'migrate/meta.ts :: applyMetaMigrationsToPackages(normalized': {
    reads: 'packages',
    why: 'replays the conversion chain over the AUTHORED stack and over each `packages[i].manifest` body as a stack, reporting a body\'s edits under that body\'s own path, which `--write` traces to the `composeStacks` input that authored it. A folded union would report paths no source file holds. Measured on a two-package `preserve` app in `migrate-meta-composed.test.ts`.',
  },
  'migrate/meta.ts :: planProtocolRange(normalized': {
    reads: 'top-level',
    why: 'reads the handshake range off `manifest`, where the load seam reads it (`AppPlugin`: `bundle.manifest || bundle`); a `preserve` artifact keeps `manifest` at the top level.',
  },
};

/** Keywords a parenthesis can follow without being a call of anything. */
const KEYWORDS: ReadonlySet<string> = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'await', 'function',
  'new', 'do', 'else', 'yield', 'void', 'delete', 'in', 'of', 'as', 'async',
]);

/** The source with comment bodies and string/template bodies blanked to spaces. */
function codeOnly(src: string): string {
  const out = src.split('');
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < src.length; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const j = src.indexOf('\n', i);
      const end = j === -1 ? src.length : j;
      blank(i, end);
      i = end;
    } else if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j === -1 ? src.length : j + 2;
      blank(i, end);
      i = end;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/** The index of the `)` closing the `(` at `open`. */
function closingParen(code: string, open: number): number {
  let depth = 0;
  for (let k = open; k < code.length; k++) {
    if (code[k] === '(') depth += 1;
    else if (code[k] === ')' && --depth === 0) return k;
  }
  return -1;
}

/** Every `(normalized` site in a source text, named as the header describes. */
function normalizedSitesOf(src: string): string[] {
  const code = codeOnly(src);
  const sites: string[] = [];
  const re = /\(\s*normalized\b/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const callees: string[] = [];
    let at = m.index;
    for (;;) {
      const head = /(?<![\w$])([A-Za-z_$][\w$]*)\s*$/.exec(code.slice(0, at));
      if (!head || KEYWORDS.has(head[1])) break;
      // `x.foo(` is a method, not a bare callee; a spread `...foo(` is not a member access.
      if (/(?<!\.)\.\s*$/.test(code.slice(0, head.index))) break;
      callees.unshift(head[1]);
      const outer = /\(\s*$/.exec(code.slice(0, head.index));
      if (!outer) break;
      at = outer.index;
    }
    if (callees.length > 0) {
      sites.push(`${callees.map((c) => `${c}(`).join('')}normalized`);
      continue;
    }
    const close = closingParen(code, m.index);
    const member = close < 0 ? null : /^\s*\.\s*([A-Za-z_$][\w$]*)/.exec(code.slice(close + 1));
    sites.push(`(normalized).${member ? member[1] : '?'}`);
  }
  return sites;
}

function commandSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...commandSources(full));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** `<file> :: <site>` for every site under `src/commands`, duplicates kept. */
function scanCommands(): string[] {
  return commandSources(COMMANDS).flatMap((file) => {
    const rel = relative(COMMANDS, file).split('\\').join('/');
    return normalizedSitesOf(readFileSync(file, 'utf8')).map((site) => `${rel} :: ${site}`);
  });
}

describe('every `(normalized` call site in src/commands is classified (#22238)', () => {
  const found = scanCommands();

  it('no site is unclassified', () => {
    const unclassified = [...new Set(found)].filter((key) => !(key in SITES)).sort();
    expect(
      unclassified,
      `New call site(s) hand the top-level \`normalized\` stack to something: ${unclassified.join('; ')}. ` +
        'On a multi-package `preserve` artifact that stack carries no package-owned collection. ' +
        'Hand it `authoringRuleUnionStack(normalized)` (src/utils/stack-collections.ts) and add a `union` row, ' +
        'or, if the analysis is about the artifact envelope, add a `top-level` row saying why.',
    ).toEqual([]);
  });

  it('no row is stale', () => {
    const live = new Set(found);
    const stale = Object.keys(SITES).filter((key) => !live.has(key)).sort();
    expect(stale, `rows whose call site is gone: ${stale.join('; ')}. Delete them.`).toEqual([]);
  });

  it('a row\'s verdict agrees with how its site is spelled', () => {
    for (const [key, { reads }] of Object.entries(SITES)) {
      const folds = key.includes('authoringRuleUnionStack(');
      if (reads === 'top-level') expect(folds, `${key} is a top-level row but reads the union`).toBe(false);
      // A union row either folds at the call or names a callee that folds on its own entry.
      if (reads === 'union' && !folds) {
        expect(
          ['lintConfig(', 'resolveJsxGateManifest(', 'scoreMetadata('].some((c) => key.includes(`:: ${c}normalized`)),
          `${key} is a union row that neither folds at the call nor names a callee known to fold`,
        ).toBe(true);
      }
    }
  });
});

describe('the site scanner', () => {
  it('names the callee chain, a grouping paren by its member, and nothing in prose', () => {
    expect(normalizedSitesOf('const r = computeI18nCoverage(authoringRuleUnionStack(normalized as X), {});\n'))
      .toEqual(['computeI18nCoverage(authoringRuleUnionStack(normalized']);
    expect(normalizedSitesOf('const a = [...lintUnknownStackKeys(normalized, S)];\n'))
      .toEqual(['lintUnknownStackKeys(normalized']);
    expect(normalizedSitesOf('const d = (normalized as { i18n?: unknown }).i18n;\n'))
      .toEqual(['(normalized).i18n']);
    expect(normalizedSitesOf('run({ normalized: authoringRuleUnionStack(normalized) });\n'))
      .toEqual(['authoringRuleUnionStack(normalized']);
    expect(normalizedSitesOf('// computeI18nCoverage(normalized)\nconst s = \'f(normalized)\';\n')).toEqual([]);
    // A method call is not a bare callee; it is reported as an unnamed paren so it cannot hide.
    expect(normalizedSitesOf('x.foo(normalized);\n')).toEqual(['(normalized).?']);
  });

  it('the coverage readers are seen where they are (positive control on the real tree)', () => {
    expect(scanCommands()).toEqual(expect.arrayContaining([
      'lint.ts :: computeI18nCoverage(authoringRuleUnionStack(normalized',
      'i18n/check.ts :: computeI18nCoverage(authoringRuleUnionStack(normalized',
    ]));
  });
});

// ═════════════════════════════════════════════════════════════════════════
// #22288 — every top-level read of a package-owned key in src, classified
// ═════════════════════════════════════════════════════════════════════════
//
// ## What is enumerated
//
// A member read of a PACKAGE-OWNED key off a receiver that holds a stack,
// anywhere in `packages/cli/src` (tests excluded). The key set is
// `packageOwnedCollectionKeys()` from `src/utils/stack-collections.ts`, which
// derives it from the two schemas (`ObjectStackDefinitionSchema` ∩
// `AssembledPackageBodySchema`): ⛔ never listed here, so a key the schema gains
// is enumerated the day it is declared. Those are exactly the keys a
// multi-package `preserve` stack carries inside its package bodies and not at
// its top level, so a read of one off the top level answers `[]` there.
//
// A receiver holds a stack by its NAME: `config`, `stack`, `normalized`,
// `bundle`, `cfg`, or any name ending in `Config`, `Stack` or `Bundle`. The
// read forms are `R.key`, `R?.key`, `R!.key`, `(R as T).key` (a `T` without
// parentheses) and `R['key']`. Comments and string bodies are blanked first.
// An assignment target (`R.key = …`) is a write and is not a read.
//
// ⛔ Bounds, stated so they are not mistaken for coverage: a stack held under
// any other name, a computed key (`stack[key]`), a member chain
// (`this.config.objects`), and a cast whose type contains parentheses are not
// seen. None of those spellings reads a package-owned key in src today
// (measured with `git grep` when this table was written).
//
// ## What a row says
//
// - `resolved`, keyed `<file under src> :: <receiver>`: every package-owned key
//   read off that receiver in that file reads a stack that ALREADY went through
//   the resolution rule (`authoringRuleUnionStack`, `resolveStackCollection`).
//   `evidence` is code that must be present, comments and strings blanked,
//   that proves it: the fold that binds the receiver, or the fold at the
//   callers. The receiver is matched by name, so the evidence is what keeps
//   a `resolved` row honest.
// - `top-level`, keyed `<file under src> :: <receiver>.<key>`: this one key is
//   read off the top level ON PURPOSE, and `why` says why that is right on a
//   two-package app. ⛔ The same warning as the first table: measure before you
//   write one.
//
// A read of `requires` (or any package-owned key) off a config's top level
// that is not in this table turns the first test red, which is what put
// `os serve`'s provider read here instead of in a bug report.

type Evidence = { readonly in?: string; readonly code: string };

type ReadRow =
  | { readonly reads: 'resolved'; readonly evidence: readonly Evidence[]; readonly why: string }
  | { readonly reads: 'top-level'; readonly why: string };

/** Key: `<file under src> :: <receiver>` (resolved) or `… :: <receiver>.<key>` (top-level). */
const READS: Readonly<Record<string, ReadRow>> = {
  // ── the build doors' capability preflight ──────────────────────────────
  'commands/compile.ts :: config.requires': {
    reads: 'top-level',
    why: 'handed to `preflightDeclaredCapabilities` beside the stack\'s `packages`; the preflight applies the rule itself (the top level wins when present, otherwise each body, attributed to its package, #22189).',
  },
  'commands/validate.ts :: config.requires': {
    reads: 'top-level',
    why: 'as in compile.ts.',
  },
  // ── os diff / os doctor / os generate / os migrate meta (#22288) ───────
  'commands/diff.ts :: beforeConfig': {
    reads: 'resolved',
    evidence: [{ code: 'const beforeConfig: any = authoringRuleUnionStack(' }],
    why: 'each side is folded where it is loaded.',
  },
  'commands/diff.ts :: afterConfig': {
    reads: 'resolved',
    evidence: [{ code: 'const afterConfig: any = authoringRuleUnionStack(' }],
    why: 'each side is folded where it is loaded.',
  },
  'commands/doctor.ts :: config': {
    reads: 'resolved',
    evidence: [{ code: 'const config: any = authoringRuleUnionStack(normalizeStackInput(' }],
    why: '`run()` binds `config` to the fold, and `findOrphanViews`, `findUnusedObjects` and `findUnscopedGlobalUniques` are handed that binding.',
  },
  'commands/generate.ts :: stack': {
    reads: 'resolved',
    evidence: [{ code: 'const stack = authoringRuleUnionStack(config) as any;' }],
    why: 'the types, client and migration generators fold the loaded config on entry; `stackBindingCandidates` binds its own `stack` to the fold too.',
  },
  'commands/migrate/meta.ts :: stack': {
    reads: 'resolved',
    evidence: [{ code: 'pendingDataMigrations( authoringRuleUnionStack(result.stack' }],
    why: '`pendingDataMigrations` is called once, with the migrated stack folded.',
  },
  // ── os lint ────────────────────────────────────────────────────────────
  'commands/lint.ts :: stack': {
    reads: 'resolved',
    evidence: [{ code: 'const stack: any = authoringRuleUnionStack(config as Record<string, unknown>);' }],
    why: '`lintConfig` folds once on entry (#17528).',
  },
  'lint/hook-body-lowering.ts :: config': {
    reads: 'resolved',
    evidence: [{ in: 'commands/lint.ts', code: 'issues.push(...checkHookBodyLowering(stack as Record<string, unknown>));' }],
    why: 'its one caller is `lintConfig`, which hands it the stack it folded on entry.',
  },
  // ── os serve ───────────────────────────────────────────────────────────
  'commands/serve.ts :: config.analyticsCubes': {
    reads: 'top-level',
    why: 'the first leg of the rule, kept so the legacy `cubes` spelling keeps its precedence: the top level\'s own array, then `cubes`, then `resolveStackCollection(config, \'analyticsCubes\')` for the bodies.',
  },
  'commands/serve.ts :: config.docs': {
    reads: 'top-level',
    why: 'the dev mirror of `os build`: the root `src/docs` collection joins the TOP-LEVEL `docs`, as `collectAndLintDocs` returns it for the artifact\'s top level, and each package\'s own docs are attached to that package\'s body (`attachPackageDocs`, beside it).',
  },
  // ── shared readers ─────────────────────────────────────────────────────
  'utils/authoring-filter-judge.ts :: stack': {
    reads: 'resolved',
    evidence: [
      { in: 'commands/compile.ts', code: 'stackFilterJudge(parsedUnion)' },
      { in: 'commands/validate.ts', code: 'stackFilterJudge(parsedUnion)' },
      { in: 'utils/author-time-rules.ts', code: 'stackFilterJudge(parsedUnion)' },
      { in: 'commands/lint.ts', code: 'stackFilterJudge(lowered as Record<string, unknown>)' },
    ],
    why: 'the doors hand it the parsed union, and `os lint` the lowered copy of its folded stack. `scaffold-validate.ts` hands it one scaffold\'s own stack, which has no `packages[]`.',
  },
  'utils/collect-docs.ts :: stack.docs': {
    reads: 'top-level',
    why: 'the artifact\'s own top-level `docs`; the same function reads each package\'s docs off its body (`bodyDocsOf(stack.packages, …)`) and lints them against that package.',
  },
  'utils/format.ts :: stack': {
    reads: 'resolved',
    evidence: [{ code: 'const stack: any = authoringRuleUnionStack(config);' }],
    why: '`collectMetadataStats` folds on entry.',
  },
  'utils/i18n-coverage.ts :: config': {
    reads: 'resolved',
    evidence: [
      { in: 'commands/lint.ts', code: 'computeI18nCoverage(authoringRuleUnionStack(normalized' },
      { in: 'commands/i18n/check.ts', code: 'computeI18nCoverage(authoringRuleUnionStack(normalized' },
    ],
    why: 'both callers hand it the union (#22238).',
  },
  'utils/i18n-extract.ts :: config': {
    reads: 'resolved',
    evidence: [{ in: 'commands/i18n/extract.ts', code: 'extractTranslations(authoringRuleUnionStack(normalized' }],
    why: 'its caller hands it the union (#22238).',
  },
  'utils/scaffold-wiring.ts :: config.requires': {
    reads: 'top-level',
    why: 'a presence probe only: `declaredCapabilities` answers `[]` rather than `null` for a stack whose top level declares an empty `requires`, so the printed line says it replaces that key. The tokens come from `stackDeclaredCapabilities` (#22288).',
  },
  'utils/sdui-manifest.ts :: stack': {
    reads: 'resolved',
    evidence: [
      { code: 'authoringRuleUnionStack(stack), ...artifactPackages(stack)' },
      { code: 'for (const key of checkedPageKeys(judged))' },
    ],
    why: '`checkedPageKeys` is called only over `jsxGateStacks(stack)`: the union, then each package body.',
  },
};

/** A receiver whose name says it holds a stack (see the header above). */
const STACK_RECEIVER = /^(?:config|stack|normalized|bundle|cfg)$|(?:Config|Stack|Bundle)$/;

/**
 * Every `<receiver>.<key>` read of a package-owned key off a stack-named
 * receiver in one source text, duplicates kept.
 */
function packageOwnedReadsOf(src: string, keys: readonly string[]): string[] {
  const code = codeOnly(src);
  const key = keys.join('|');
  const ident = '[A-Za-z_$][\\w$]*';
  const receiver = `(?<![\\w$.])(?:\\(\\s*(${ident})\\s+as\\s+[^()]*?\\)|(${ident}))\\s*!?`;
  const member = new RegExp(`${receiver}\\s*(?:\\?\\.|\\.)\\s*(${key})(?![\\w$])`, 'g');
  // `R['key']` — the masker blanks the string body but keeps its offsets and
  // quotes, so the key is read back out of the SOURCE at the same position.
  const bracket = new RegExp(`${receiver}\\s*(?:\\?\\.)?\\[\\s*(['"])(\\s*)\\3\\s*\\]`, 'g');
  const reads: string[] = [];
  const isWrite = (end: number) => /^\s*=(?![=>])/.test(code.slice(end));
  for (const m of code.matchAll(member)) {
    const name = m[1] ?? m[2];
    if (!STACK_RECEIVER.test(name) || isWrite(m.index + m[0].length)) continue;
    reads.push(`${name}.${m[3]}`);
  }
  for (const m of code.matchAll(bracket)) {
    const name = m[1] ?? m[2];
    const close = m.index + m[0].lastIndexOf(m[3]);
    const literal = src.slice(close - m[4].length, close);
    if (!STACK_RECEIVER.test(name) || !keys.includes(literal) || isWrite(m.index + m[0].length)) continue;
    reads.push(`${name}.${literal}`);
  }
  return reads;
}

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourcesUnder(full));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** `<file under src> :: <receiver>.<key>` for every read in src, duplicates kept. */
function scanPackageOwnedReads(keys: readonly string[]): string[] {
  return sourcesUnder(SRC).flatMap((file) => {
    const rel = relative(SRC, file).split('\\').join('/');
    return packageOwnedReadsOf(readFileSync(file, 'utf8'), keys).map((read) => `${rel} :: ${read}`);
  });
}

/** The row a read falls under, if any: its own `top-level` row, or its receiver's `resolved` row. */
function rowFor(site: string): ReadRow | undefined {
  const exact = READS[site];
  if (exact?.reads === 'top-level') return exact;
  const byReceiver = READS[site.slice(0, site.lastIndexOf('.'))];
  return byReceiver?.reads === 'resolved' ? byReceiver : undefined;
}

/** Whitespace runs collapsed, so evidence is matched by tokens rather than by layout. */
const squash = (text: string) => text.replace(/\s+/g, ' ');

describe('every top-level read of a package-owned key in src is classified (#22288)', () => {
  const keys = packageOwnedCollectionKeys();
  const found = scanPackageOwnedReads(keys);

  it('the key set is the derived one (anti-vacuity control)', () => {
    // Package-owned, the way a `preserve` body carries them …
    expect(keys).toEqual(expect.arrayContaining(['requires', 'objects', 'flows', 'tiers', 'analyticsCubes', 'translations']));
    // … and never an envelope key, which a `preserve` stack keeps at its top level.
    for (const envelope of ['manifest', 'packages', 'i18n', 'plugins', 'api']) expect(keys).not.toContain(envelope);
  });

  it('no read is unclassified', () => {
    const unclassified = [...new Set(found)].filter((site) => rowFor(site) === undefined).sort();
    expect(
      unclassified,
      `Read(s) of a package-owned key off a stack's top level: ${unclassified.join('; ')}. ` +
        'A multi-package `preserve` stack carries that key in its package bodies and not at its top level, so ' +
        'this read answers empty there. Read it with `resolveStackCollection(stack, key)` or off ' +
        '`authoringRuleUnionStack(stack)` (src/utils/stack-collections.ts) and add a `resolved` row with its ' +
        'evidence, or, if the read is about the top level on purpose, add a `top-level` row saying why.',
    ).toEqual([]);
  });

  it('no row is stale', () => {
    const live = new Set(found);
    const liveReceivers = new Set(found.map((site) => site.slice(0, site.lastIndexOf('.'))));
    const stale = Object.entries(READS)
      .filter(([key, row]) => (row.reads === 'top-level' ? !live.has(key) : !liveReceivers.has(key)))
      .map(([key]) => key)
      .sort();
    expect(stale, `rows whose read is gone: ${stale.join('; ')}. Delete them.`).toEqual([]);
  });

  it('a row\'s key has its verdict\'s shape, and every `resolved` row\'s evidence is in the code', () => {
    for (const [key, row] of Object.entries(READS)) {
      const target = key.slice(key.indexOf(' :: ') + 4);
      if (row.reads === 'top-level') {
        expect(target.includes('.'), `${key} is a top-level row and must name one key`).toBe(true);
        continue;
      }
      expect(target.includes('.'), `${key} is a resolved row and names a receiver, not a key`).toBe(false);
      const ownFile = key.slice(0, key.indexOf(' :: '));
      for (const { in: file = ownFile, code } of row.evidence) {
        const text = squash(codeOnly(readFileSync(resolve(SRC, file), 'utf8')));
        expect(text.includes(squash(code)), `${key}: evidence \`${code}\` is not in src/${file}`).toBe(true);
      }
    }
  });
});

describe('the package-owned read scanner', () => {
  const keys = ['requires', 'objects', 'flows'];

  it('sees every read form, off stack-named receivers only, and skips writes and prose', () => {
    expect(packageOwnedReadsOf('const r = (config as any).requires;\n', keys)).toEqual(['config.requires']);
    expect(packageOwnedReadsOf('const r = (config as { requires?: unknown } | null)?.requires;\n', keys))
      .toEqual(['config.requires']);
    expect(packageOwnedReadsOf('const r = config?.requires ?? stack!.objects;\n', keys))
      .toEqual(['config.requires', 'stack.objects']);
    expect(packageOwnedReadsOf('const r = hostConfig.flows; const b = finalBundle.objects;\n', keys))
      .toEqual(['hostConfig.flows', 'finalBundle.objects']);
    expect(packageOwnedReadsOf('const r = config[\'requires\'] ?? stack["objects"];\n', keys))
      .toEqual(['config.requires', 'stack.objects']);
    // Not a stack: a package body, an item, a member chain.
    expect(packageOwnedReadsOf('const r = body.requires ?? pkg.objects ?? this.config.flows;\n', keys)).toEqual([]);
    // A write is not a read; a comparison is.
    expect(packageOwnedReadsOf('stack.objects = [];\n', keys)).toEqual([]);
    expect(packageOwnedReadsOf('if (stack.objects === x) f();\n', keys)).toEqual(['stack.objects']);
    // An envelope key, a key outside the set, prose and strings.
    expect(packageOwnedReadsOf('const m = config.manifest ?? config.packages;\n', keys)).toEqual([]);
    expect(packageOwnedReadsOf('// (config as any).requires\nconst s = \'config.requires\';\n', keys)).toEqual([]);
  });

  it('sees the reads where they are (positive control on the real tree)', () => {
    expect(scanPackageOwnedReads(packageOwnedCollectionKeys())).toEqual(expect.arrayContaining([
      'utils/format.ts :: stack.objects',
      'commands/compile.ts :: config.requires',
    ]));
  });
});
