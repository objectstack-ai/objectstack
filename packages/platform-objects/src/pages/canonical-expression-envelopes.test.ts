// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Gate — every `Page` this package exports must serve the CANONICAL
 * `{ dialect, source }` envelope at every `ExpressionInputSchema` position.
 *
 * The detector — the three parse doors, the behavioural lockstep walk that
 * identifies an expression position without hardcoding key names, and the
 * finding renderer — lives in `@objectstack/lint` (`page-envelope-audit.ts`;
 * #11255 → #11480). Its header carries the hazard (a raw-literal page is
 * type-checked, never PARSED, so bare predicates reach the wire verbatim and
 * the console silently routes them to its legacy fail-soft evaluator), the
 * door table, and the negative controls proving each door is load-bearing.
 * It moved there because this file was the detector's first home and a
 * package-local detector cannot reach the raw-literal pages OTHER published
 * packages ship — #11480 records one in a `*-ui.ts` file no `*.page.ts`
 * sweep ever looked at.
 *
 * What stays HERE is what only this package can assert:
 *
 *  - **the population** — every `export const X: Page =` declared anywhere in
 *    this package's `src/` is covered (scanned from source text, because the
 *    hazard is precisely the page nobody wired into the barrel), with a floor
 *    so the gate cannot silently read nothing;
 *  - **the door preconditions, per page** — a door that cannot parse reports
 *    nothing, which is indistinguishable from "clean", so each channel is its
 *    own test naming which door just stopped reading;
 *  - **the verdict** — no exported page authors a bare expression string;
 *  - **a downgrade control over a SHIPPED page** — proof the imported
 *    detector actually reaches this package's real exports, not only its own
 *    fixtures (and the reverse-verification surface: ablate the lint module
 *    and this is the test that reds).
 *
 * @see packages/lint/src/page-envelope-audit.ts — the detector
 * @see packages/spec/src/shared/expression.zod.ts — `ExpressionInputSchema`
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Page } from '@objectstack/spec/ui';
import { auditPageExpressionEnvelopes, renderBareExpressionFindings } from '@objectstack/lint';
// The one answer this tree has to "comment, literal, or code". It is a plain
// `.mjs`, but `scripts/js-comment-mask.d.mts` beside it is a hand-written
// declaration mirror (governed by `check:declaration-mirrors`), so this import
// is typed and needs no suppression -- a `@ts-expect-error` here would be an
// UNUSED directive. That `.d.mts` is what gives `maskComments` its type, so it
// is an input to this package's typecheck verdict as well as to this scan.
// Same spelling `packages/cli`'s contract tests use.
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';
import * as pageExports from './index.js';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec =>
  !!v && typeof v === 'object' && !Array.isArray(v);

// ───────────────────────────────────────────────────────────────────────────
// The population this gate covers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Seeded from `__dirname`, not `fileURLToPath(import.meta.url)` — the same
 * choice `managed-api-method-affordance-sweep.test.ts` makes in this package,
 * for the reason it records there: this package has no ESM `tsconfig.test.json`,
 * so `import.meta` is a **TS1470** the moment
 * `check:type-check-coverage --re-measure` puts the test layer in front of tsc,
 * and that ledger may only shrink. `__dirname` type-checks under the package's
 * own config and vitest's transform defines it at runtime.
 *
 * (Measured, not assumed: the `import.meta` spelling was written here first and
 * the ratchet caught it — `TEST_DEBT records 3 … now reports 4 (+1)`.)
 */
const HERE = __dirname;
/** …/src/pages → this package's own `src/`. The scan never leaves the package. */
const PACKAGE_SRC = resolve(HERE, '..');

/** Every `Page` the package's page barrel exports, by export name. */
const EXPORTED_PAGES: [string, Page][] = Object.entries(pageExports)
  .filter((entry): entry is [string, Page] => isRec(entry[1]))
  .sort((a, b) => a[0].localeCompare(b[0]));

function pageLabel(exportName: string, page: Page): string {
  const name = typeof (page as AnyRec).name === 'string' ? (page as AnyRec).name : '(unnamed)';
  return `${exportName} (${String(name)})`;
}

function tsFilesUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      tsFilesUnder(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every `export const X: Page = …` this source text declares, read from CODE.
 *
 * ## Why the shared mask and not a private comment-stripper
 *
 * Masking is not a detail of this scan, it is the scan's population rule: text
 * this function mistakes for a comment is a page this gate never audits, and
 * the gate still reports GREEN — a green line over a page nobody read, which is
 * the exact defect class this file exists to prevent, re-entering through the
 * detector instead of through the authoring.
 *
 * What used to stand here was two regexes, block pass first
 * (`/\*[\s\S]*?\*\/` lazily, then `^[ \t]*\/\/.*$`) — the same pair #9367
 * retired from six gates and #10453 found surviving in two `packages/cli`
 * tests. Its failure is
 * the silent one: a block-comment OPENER that is not a comment at all — inside
 * a string literal, or inside a line comment — opens a phantom comment that
 * runs to the next real `\*\/` and deletes every line between, declarations
 * included.
 *
 * That is not a shape only a fixture writes. Measured on this tree at the time
 * of the conversion, `packages/cloud-connection/src/cloud-connection-ui.ts`
 * carries one: the line comment `// … /api/v1/cloud-connection/* routes this
 * plugin mounts.` opens a phantom that the next docblock's terminator closes,
 * and the retired regex deletes 122 bytes of live page literal in between. Both
 * gates stayed green only because the opener happens to sit BELOW the
 * `export const … : Page =` the scan anchors on — a page declared thirty lines
 * further down that file would simply have vanished from the population.
 *
 * `maskComments` blanks comment spans and leaves string, template and regex
 * literals intact, so offsets and line numbers both survive and a `: Page =`
 * inside prose still cannot be read as a declaration.
 *
 * Split out from the walk so the pin below drives the REAL scan over a fixture
 * rather than over whatever this package happens to contain today.
 */
function pageDeclarationsIn(source: string): string[] {
  return [...maskComments(source).matchAll(/export\s+const\s+(\w+)\s*:\s*Page\s*=/g)]
    .map(match => match[1]!);
}

/**
 * Every `export const X: Page = …` declared anywhere in this package's `src/`.
 *
 * Scanning source text rather than the barrel is what makes "a page nobody
 * covered" visible: the barrel can only tell this gate about pages already
 * wired into it, and the hazard is precisely the page that is not. Filename is
 * NOT the discriminator either — the sweep that first recorded this defect
 * class looked at `*.page.ts` and therefore missed a raw-literal page living in
 * a `*-ui.ts` file in a sibling package.
 */
function declaredPageExports(): { name: string; file: string }[] {
  const out: { name: string; file: string }[] = [];
  for (const file of tsFilesUnder(PACKAGE_SRC)) {
    for (const name of pageDeclarationsIn(readFileSync(file, 'utf8'))) {
      out.push({ name, file: file.slice(PACKAGE_SRC.length + 1) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const AUDITS = EXPORTED_PAGES.map(([exportName, page]) => ({
  exportName,
  page,
  audit: auditPageExpressionEnvelopes(page, pageLabel(exportName, page)),
}));

// ───────────────────────────────────────────────────────────────────────────
// The gate
// ───────────────────────────────────────────────────────────────────────────

describe('platform Page exports serve canonical expression envelopes', () => {
  it('covers every `Page` declared in this package', () => {
    const declared = declaredPageExports();
    const covered = new Set(EXPORTED_PAGES.map(([name]) => name));
    const uncovered = declared.filter(d => !covered.has(d.name));

    expect(
      uncovered.map(d => `${d.name} (${d.file})`).join('\n'),
      'a raw-literal `Page` in this package is not exported from `src/pages/index.ts`, '
        + 'so this gate never reads it. Export it from the barrel (or, if it is deliberately '
        + 'unexported, say so here).',
    ).toBe('');

    // Population floor: the gate is worthless if it silently reads nothing.
    expect(EXPORTED_PAGES.length).toBeGreaterThanOrEqual(3);
    expect(declared.length).toBeGreaterThanOrEqual(3);
  });

  it.each(AUDITS)('$exportName parses through PageSchema (door 1 precondition)', ({ audit }) => {
    expect(
      audit.pageParseError ?? '',
      'door 1 cannot run: this page does not parse, so every schema-typed expression '
        + 'position on it is unread by this gate.',
    ).toBe('');
  });

  it.each(AUDITS)('$exportName: every component parses through PageComponentSchema (door 2 precondition)', ({ audit }) => {
    expect(
      audit.componentParseErrors.map(e => `${e.path} [${e.type}]: ${e.issues}`).join('\n'),
      'door 2 cannot run for these components: they do not parse, so their expression '
        + 'positions are unread by this gate.',
    ).toBe('');
    expect(audit.componentCount).toBeGreaterThan(0);
  });

  it.each(AUDITS)('$exportName: every component type is declared in ComponentPropsMap (door 3 precondition)', ({ audit }) => {
    expect(
      audit.unmappedTypes.map(e => `${e.path} [${e.type}]`).join('\n'),
      'door 3 has no props schema for these component types, so any expression key inside '
        + 'their `properties` is unread by this gate. Either declare the props schema, or '
        + 'record the exemption here with the reason.',
    ).toBe('');
  });

  it.each(AUDITS)('$exportName: every authored `properties` bag parses against its props schema (door 3 precondition)', ({ audit }) => {
    expect(
      audit.unreadableProps.map(e => `${e.path} [${e.type}]: ${e.issues}`).join('\n'),
      'door 3 cannot run for these components: their authored `properties` are refused by '
        + 'the declared props schema, so a props-level expression key there is unread by '
        + 'this gate.',
    ).toBe('');
  });

  it.each(AUDITS)('$exportName authors NO bare expression string', ({ audit }) => {
    expect(renderBareExpressionFindings(audit.findings)).toBe('');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Downgrade control — the imported detector reaches this package's REAL pages
// ───────────────────────────────────────────────────────────────────────────

describe('downgrade control — a shipped page, predicate downgraded to bare', () => {
  it('flags a REAL exported page the moment its predicate is down-graded to bare', () => {
    // The operative acceptance criterion, exercised against the shipped page
    // rather than a fixture: take the real export, replace its one canonical
    // envelope with the bare source it wraps, and confirm the gate reds with a
    // path an author can act on. Deep-cloned — the export itself is untouched.
    // (The detector's own fixture-based negative controls live at its home,
    // `packages/lint/src/page-envelope-audit.test.ts`; this control is the
    // half only this package can run, and the one that reds if the lint
    // detector is ablated or its import breaks.)
    const source = JSON.parse(JSON.stringify(pageExports.SysUserDetailPage)) as AnyRec;
    const slots = source.slots as AnyRec;
    const alerts = slots.alerts as AnyRec[];
    const authored = (alerts[0]!.visibleWhen as AnyRec).source as string;
    expect(
      typeof authored,
      'this control expects the shipped page to still carry the CANONICAL envelope. '
        + 'If it is already bare, THIS is not the failure to read — the gate above '
        + '(`authors NO bare expression string`) is, and it names the offending path.',
    ).toBe('string');
    alerts[0]!.visibleWhen = authored;

    const audit = auditPageExpressionEnvelopes(source, pageLabel('SysUserDetailPage', source as unknown as Page));
    expect(audit.findings.map(f => f.path)).toEqual(['slots.alerts[0].visibleWhen']);
    const rendered = renderBareExpressionFindings(audit.findings);
    expect(rendered).toContain('sys_user_detail');
    expect(rendered).toContain('slots.alerts[0].visibleWhen');

    // …and the untouched export is still clean, so the red above came from the
    // mutation and not from something this test left behind.
    const pristine = auditPageExpressionEnvelopes(
      pageExports.SysUserDetailPage,
      pageLabel('SysUserDetailPage', pageExports.SysUserDetailPage),
    );
    expect(renderBareExpressionFindings(pristine.findings)).toBe('');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Pin — a phantom comment cannot delete a page from the population
// ───────────────────────────────────────────────────────────────────────────

/**
 * The conversion above, pinned by the shape it was made for.
 *
 * Both fixtures carry a block-comment OPENER that is not a comment — one in a
 * line comment, one in a string literal — followed by a real terminator further
 * down, with a `Page` declaration in between. The retired two-regex stripper
 * honours the opener, runs lazily to that terminator, and the declaration
 * between them is gone; the scan then reports a population one page short and
 * every audit downstream is green over a page it never read.
 *
 * Measured at the conversion, on this exact text: the retired regex found only
 * the trailing page in each fixture, `maskComments` finds both. Reverting
 * `pageDeclarationsIn` to that stripper reds these two cases and nothing else
 * in this file — the scan is the only thing they exercise.
 *
 * The `openerIsNotAComment` precondition is here so the pin cannot go quietly
 * vacuous: strip the opener out of a fixture while editing and both strippers
 * agree again, leaving two tests that pass without asserting anything.
 */
const PHANTOM_IN_LINE_COMMENT = [
  "import type { Page } from '@objectstack/spec/ui';",
  '',
  '// The console panel talks to the same-origin /api/v1/cloud-connection/*',
  '// routes this plugin mounts.',
  '',
  'export const PhantomPage: Page = {',
  "    name: 'phantom_page',",
  "    regions: [{ name: 'main', width: 'full', components: [] }],",
  '};',
  '',
  '/** Setup-nav contribution — the terminator that closes the phantom. */',
  "export const LaterPage: Page = { name: 'later_page', regions: [] };",
].join('\n');

const PHANTOM_IN_STRING_LITERAL = [
  "import type { Page } from '@objectstack/spec/ui';",
  '',
  "const PROXY_GLOB = '/api/v1/marketplace/*';",
  '',
  'export const LiteralPhantomPage: Page = {',
  "    name: 'literal_phantom_page',",
  '    regions: [],',
  '};',
  '',
  '/** A docblock whose terminator closes the phantom opened in the string. */',
  "export const LiteralLaterPage: Page = { name: 'literal_later', regions: [] };",
].join('\n');

/** The fixture still carries the shape: an opener above, a terminator below. */
function openerIsNotAComment(fixture: string, declaration: string): void {
  const opener = fixture.indexOf('/' + '*');
  const declaredAt = fixture.indexOf(declaration);
  const terminator = fixture.indexOf('*' + '/', opener);
  expect(opener, 'fixture lost its block-comment opener').toBeGreaterThan(-1);
  expect(declaredAt, 'fixture lost its page declaration').toBeGreaterThan(opener);
  expect(terminator, 'fixture lost the terminator that closes the phantom')
    .toBeGreaterThan(declaredAt);
}

describe('population scan reads comments, not comment-shaped text', () => {
  it('keeps a page straddled by an opener inside a LINE COMMENT', () => {
    openerIsNotAComment(PHANTOM_IN_LINE_COMMENT, 'export const PhantomPage');
    expect(pageDeclarationsIn(PHANTOM_IN_LINE_COMMENT)).toEqual(['PhantomPage', 'LaterPage']);
  });

  it('keeps a page straddled by an opener inside a STRING LITERAL', () => {
    openerIsNotAComment(PHANTOM_IN_STRING_LITERAL, 'export const LiteralPhantomPage');
    expect(pageDeclarationsIn(PHANTOM_IN_STRING_LITERAL))
      .toEqual(['LiteralPhantomPage', 'LiteralLaterPage']);
  });

  it('still refuses a `: Page =` written inside genuine prose', () => {
    const prose = [
      '/** Authors write `export const X: Page = {}` in docblocks like this. */',
      "// and in line comments: export const YPage: Page = {}",
      "export const RealPage: Page = { name: 'real', regions: [] };",
    ].join('\n');
    expect(pageDeclarationsIn(prose)).toEqual(['RealPage']);
  });
});
