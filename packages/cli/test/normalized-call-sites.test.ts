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
 * `config.requires` rather than `normalized`, so it is not a row here; its
 * per-package reading is pinned in `capability-preflight.test.ts` and
 * `package-union-readers.test.ts`.
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

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const COMMANDS = resolve(HERE, '../src/commands');

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
  'migrate/meta.ts :: applyMetaMigrations(normalized': {
    reads: 'top-level',
    why: 'replays the conversion chain over the AUTHORED stack, and `--write` edits the authored source at the paths it reports. A folded union would report paths no source file holds. Which bodies a conversion reaches is the chain\'s own walk.',
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
