/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * No package that depends on `@object-ui/i18n` may hand `Intl` the machine's
 * locale (objectui#9909, ruled on objectui#9786 as letter B′).
 *
 * ## The rule, and where it is stated
 *
 * `useDisplayLocale.ts`, in this package, says it in its own doc comment: the
 * one thing a caller must not do is hand `Intl` the `undefined` it gets on an
 * unconfigured workspace, because `undefined` means "the MACHINE's locale",
 * which is neither of the repo's two locale channels. This file is the check
 * that re-derives that sentence over every package that could violate it.
 *
 * ## Why ONE repo-wide test (the ruling, not a preference)
 *
 * The class was closed six times on six file surfaces — objectui#4541, #4553,
 * #4566, #4576, #9453, #9786 — and reappeared every time, because each repair
 * was scoped to whatever card was in flight. objectui#9786 left a census pin
 * scoped to `packages/plugin-detail`; the ruling on that card made it this
 * test: one census covering every package that depends on `@object-ui/i18n`,
 * landing with objectui#9909's one-time sweep. ⛔ No ESLint rule and no new
 * workflow were ruled in: this file IS the instrument, and it runs in the
 * ordinary test suite.
 *
 * ## The population is read from the MANIFESTS, never listed here
 *
 * Every workspace package (the globs in `pnpm-workspace.yaml`) whose
 * `package.json` names `@object-ui/i18n` in any dependency field. A package
 * that gains the dependency is covered on its next run with no edit to this
 * file; one that loses it drops out the same way. ⚠️ So the population is a
 * RULE, and packages outside it are outside by that rule:
 * `@object-ui/core` does not depend on this package (it is React-free by
 * charter), and its declared contract for a caller with no locale in hand is
 * "follow the runtime default" (`number-display.ts`). Covering it would mean
 * overturning that contract, which this census does not do.
 *
 * ## What it refuses, in three shapes, and what it does NOT judge
 *
 *  - a call with NO argument, or an explicit `undefined` — the machine's
 *    locale in plain sight;
 *  - the `'default'` pseudo-tag — a well-formed subtag no locale data answers,
 *    so `Intl` resolves it to the runtime default: the machine's locale in
 *    disguise (measured in `packages/test-support/src/__tests__/locale-tripwire.test.ts`);
 *  - a hard-coded BCP-47 LITERAL — objectui#4033's class (`'en-US'` is not the
 *    world's default) wearing a different hat.
 *
 * Each can be DECLARED below, with its reason, when it is deliberate. A call
 * that passes an EXPRESSION is not judged here.
 *
 * ## ⛔ What this instrument CANNOT see — stated, not assumed
 *
 * It reads source text, so it is blind to an expression that is `undefined` at
 * RUNTIME: an optional prop no caller supplies (`HistoryTimeline`'s `locale`,
 * objectui#9786's tenth site), a helper whose optional locale its caller never
 * passes (objectui#9909 found four such calls by reading). The instrument for
 * that half is the runtime tripwire in `@object-ui/test-support`
 * (`recordLocaleArguments`), applied per surface in each package's
 * differential pin. The two fail in different directions on purpose.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error — plain-JS shared helper, intentionally untyped (`allowJs: false`)
import { maskComments } from '../../../../scripts/js-comment-mask.mjs';

/** Local annotation, since the import above is untyped — the call site stays checked. */
const mask: (source: string) => string = maskComments;

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/i18n/src/__tests__ -> repository root
const repoRoot = path.resolve(here, '../../../..');

const I18N = '@object-ui/i18n';
const DEP_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const;

/* -------------------------------------------------------------------------- */
/* The population                                                             */
/* -------------------------------------------------------------------------- */

/** The workspace globs, read from `pnpm-workspace.yaml` rather than restated. */
function workspaceGlobs(): string[] {
  const yaml = readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const block = /^packages:\s*\n((?:[ \t]+-[^\n]*\n?)+)/m.exec(yaml);
  if (!block) return [];
  return [...block[1].matchAll(/-\s*['"]?([^'"\s#]+)['"]?/g)].map((m) => m[1]);
}

function workspacePackageDirs(): string[] {
  const dirs: string[] = [];
  for (const glob of workspaceGlobs()) {
    if (glob.endsWith('/*')) {
      const parent = path.join(repoRoot, glob.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(path.join(glob.slice(0, -2), entry.name));
      }
    } else {
      dirs.push(glob);
    }
  }
  return dirs.filter((d) => existsSync(path.join(repoRoot, d, 'package.json')));
}

interface Manifest {
  name?: string;
  [field: string]: unknown;
}

const readManifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8')) as Manifest;

const dependsOnI18n = (m: Manifest): boolean =>
  DEP_FIELDS.some((field) => {
    const deps = m[field] as Record<string, string> | undefined;
    return !!deps && Object.prototype.hasOwnProperty.call(deps, I18N);
  });

const allPackages = workspacePackageDirs().map((dir) => ({ dir, manifest: readManifest(dir) }));
const population = allPackages.filter((p) => dependsOnI18n(p.manifest)).map((p) => p.dir);

/* -------------------------------------------------------------------------- */
/* The sources                                                                */
/* -------------------------------------------------------------------------- */

const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'out', '.turbo', '.next']);
/** Test and measurement tooling never ships; the same shape `check-phantom-dependencies.mjs` reads. */
const TOOLING = /(^|\/)(__tests__|__mocks__|__benchmarks__|e2e)\/|\.(test|spec|bench|stories)\.[cm]?[jt]sx?$/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * ⚠️ Comments are MASKED, not deleted — offsets and line numbers survive — and
 * masked with the repo's one declared masker (`scripts/js-comment-mask.mjs`).
 * The masking is load-bearing: objectui#9786's originating census counted two
 * lines of a doc comment as call sites, and this sweep's own raw re-take
 * counted a comment quoting a PAST repair of this class as a site needing one.
 */
const sources: Array<{ pkg: string; rel: string; masked: string; raw: string }> = population.flatMap((pkg) =>
  walk(path.join(repoRoot, pkg))
    .map((f) => path.relative(repoRoot, f).split(path.sep).join('/'))
    .filter((rel) => !TOOLING.test(rel))
    .map((rel) => {
      const raw = readFileSync(path.join(repoRoot, rel), 'utf8');
      return { pkg, rel, masked: mask(raw), raw };
    }),
);

/* -------------------------------------------------------------------------- */
/* The matcher                                                                */
/* -------------------------------------------------------------------------- */

/** Every API in this tree whose FIRST argument is a BCP-47 tag. */
const LOCALE_CALL =
  /(?:\.toLocale(?:Date|Time)?String|\bIntl\.(?:DateTimeFormat|NumberFormat|RelativeTimeFormat|ListFormat|PluralRules|Collator|DurationFormat|Segmenter|DisplayNames))\s*\(/g;

type Shape = 'bare' | 'undefined' | 'default' | 'literal' | 'expression';

interface Site {
  file: string;
  line: number;
  /** The trimmed raw source line — what an exemption's `expression` is matched against. */
  text: string;
  shape: Shape;
  /** The literal tag, for `shape: 'literal'`. */
  tag?: string;
}

function classify(head: string): { shape: Shape; tag?: string } {
  if (/^\)/.test(head)) return { shape: 'bare' };
  if (/^undefined\b/.test(head)) return { shape: 'undefined' };
  if (/^(['"`])default\1/.test(head)) return { shape: 'default' };
  const literal = /^(['"`])([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*)\1/.exec(head);
  if (literal) return { shape: 'literal', tag: literal[2] };
  return { shape: 'expression' };
}

function scan(file: string, masked: string, raw: string): Site[] {
  const found: Site[] = [];
  const lines = raw.split('\n');
  LOCALE_CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LOCALE_CALL.exec(masked)) !== null) {
    const head = masked.slice(m.index + m[0].length, m.index + m[0].length + 60).trimStart();
    const line = masked.slice(0, m.index).split('\n').length;
    found.push({ file, line, text: (lines[line - 1] ?? '').trim(), ...classify(head) });
  }
  return found;
}

const sites: Site[] = sources.flatMap((s) => scan(s.rel, s.masked, s.raw));

/** The shapes this census judges — everything but a passed expression. */
const judged = (s: Site): boolean => s.shape !== 'expression';

/* -------------------------------------------------------------------------- */
/* The declared exemptions — file · expression · reason, each counted          */
/* -------------------------------------------------------------------------- */

interface Exemption {
  file: string;
  /** A distinctive substring of the call site's source line. Cited by content, never by line number. */
  expression: string;
  /** How many judged sites this entry must match — EXACTLY, so a deletion without its entry is red too. */
  count: number;
  verdict: 'deliberate fallback' | 'not applicable';
  reason: string;
}

const DECLARED: Exemption[] = [
  {
    // ⭐ THE LIT CONTROL — a NEGATIVE. Repairing it would BE the defect.
    file: 'packages/collaboration/src/CommentThread.tsx',
    expression: 'return date.toLocaleDateString();',
    count: 1,
    verdict: 'deliberate fallback',
    reason:
      'the `catch` of `formatAbsoluteDate`, whose `try` already passes the display locale (`useDisplayLocale()`, ' +
      'objectui#10375; the session language before that): it fires only on the `RangeError` a structurally ' +
      'malformed tag raises, and restores the pre-localisation face instead of letting the raw ISO string reach the ' +
      'reader.',
  },
  {
    file: 'packages/fields/src/currency.ts',
    expression: "new Intl.NumberFormat(undefined, { style: 'currency', currency }).resolvedOptions()",
    count: 1,
    verdict: 'not applicable',
    reason:
      'an ICU metadata PROBE for the ISO-4217 fraction-digit count, which is locale-independent; nothing is ' +
      'formatted and no face is rendered.',
  },
  {
    file: 'apps/console/src/pages/settings/workspaceTimezonePromptLogic.ts',
    expression: 'const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;',
    count: 1,
    verdict: 'not applicable',
    reason:
      'reads the HOST time zone for the workspace-timezone prompt (objectui#11758), the one member of ' +
      '`resolvedOptions()` the locale does not decide; nothing is formatted and no face is rendered.',
  },
  {
    file: 'packages/app-shell/src/console/organizations/CreateWorkspaceDialog.tsx',
    expression: 'const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;',
    count: 1,
    verdict: 'not applicable',
    reason:
      'reads the HOST time zone a new workspace is seeded with at creation (objectui#11908), the one member of ' +
      '`resolvedOptions()` the locale does not decide; nothing is formatted and no face is rendered.',
  },
  {
    file: 'packages/components/src/ui/calendar.tsx',
    expression: 'data-day={day.date.toLocaleDateString()}',
    count: 1,
    verdict: 'not applicable',
    reason:
      'a `data-*` attribute value no reader sees, in a No-Touch upstream Shadcn file (AGENTS.md commandment #7) ' +
      'that the sync script overwrites.',
  },
  {
    file: 'packages/components/src/ui/calendar.tsx',
    expression: 'date.toLocaleString("default", { month: "short" })',
    count: 1,
    verdict: 'not applicable',
    reason:
      'the machine locale in disguise, inside a No-Touch upstream Shadcn file (AGENTS.md commandment #7): it is ' +
      'the `formatMonthDropdown` default, reached only under a dropdown `captionLayout` no first-party caller sets, ' +
      'and `formatters` is the declared override for a wrapper in `components/src/custom/`.',
  },
  {
    file: 'apps/console/src/sdui-tiers-preview.tsx',
    expression: "{'$' + r.amount.toLocaleString()}",
    count: 1,
    verdict: 'not applicable',
    reason:
      'demo page source inside a template literal, in a dev-server-only preview entry: the console build declares ' +
      'no `rollupOptions.input`, so only `index.html` ships.',
  },
  {
    file: 'apps/console/src/sdui-tiers-preview.tsx',
    expression: "Total: {'$' + total.toLocaleString()}",
    count: 1,
    verdict: 'not applicable',
    reason:
      'the total line of the same dev-server-only demo page source; the console build ships `index.html` alone.',
  },
  {
    file: 'packages/plugin-gantt/src/GanttView.tsx',
    expression: "task.start.toLocaleDateString('en-CA')",
    count: 2,
    verdict: 'deliberate fallback',
    reason:
      'an ISO-8601 formatter, not a display locale: it feeds the inline editor\'s `<input type="date">` value (double-click and ' +
      'context-menu edit both seed it).',
  },
  {
    file: 'packages/plugin-gantt/src/tzShift.ts',
    expression: "new Intl.DateTimeFormat('en-US', {",
    count: 1,
    verdict: 'deliberate fallback',
    reason:
      "`tzOffsetMs`'s machine-read PARSER: `formatToParts` is read back through `Number()`, so the tag must " +
      'guarantee Latin digits and the 24-hour cycle the arithmetic assumes; nothing is shown to a reader.',
  },
  {
    file: 'packages/plugin-gantt/src/useGanttTranslation.ts',
    expression: "const EN_PLURAL_RULES = new Intl.PluralRules('en');",
    count: 1,
    verdict: 'not applicable',
    reason:
      'picks the `_one` / `_other` row of the provider-less ENGLISH defaults table for a count family ' +
      '(objectui#11445): the rows are English, so English plural rules select among them; nothing is formatted, ' +
      'and a provider-mounted host reads the pack through i18next instead.',
  },
  {
    file: 'packages/plugin-grid/src/ImportWizard.tsx',
    expression: "const EN_PLURAL_RULES = new Intl.PluralRules('en');",
    count: 1,
    verdict: 'not applicable',
    reason:
      "the same English-row selector in the import wizard's hand-rolled defaults table (objectui#11445): it picks " +
      'which English string a count family answers with on a provider-less host; no number or date is formatted.',
  },
];

const matches = (e: Exemption, s: Site): boolean => s.file === e.file && s.text.includes(e.expression);

const where = (s: Site): string => `${s.file}:${s.line}: ${s.text}`;

/* -------------------------------------------------------------------------- */

describe('no package that depends on @object-ui/i18n formats in the machine locale (objectui#9909)', () => {
  /**
   * ⭐ The width guards. Every assertion below is "the scan found no bad site",
   * which a scan that found NOTHING satisfies perfectly — so a silent narrowing
   * has to be loud, the direction AGENTS.md #9 names as worse than no check.
   */
  it('the population is derived from the manifests, and it is wide', () => {
    expect(workspaceGlobs().length, 'pnpm-workspace.yaml was read').toBeGreaterThan(0);
    expect(allPackages.length, 'the workspace globs expanded').toBeGreaterThan(30);
    expect(population.length, 'packages that depend on @object-ui/i18n').toBeGreaterThan(15);

    // Known dependents, by the dependency field that makes them one — including
    // an app that declares it only as a devDependency (it bundles its deps).
    for (const pkg of ['packages/plugin-detail', 'packages/fields', 'packages/app-shell', 'apps/console']) {
      expect(population, `${pkg} depends on ${I18N}`).toContain(pkg);
    }
    // …and the filter is a filter: the channel's own package and the React-free
    // engine do not depend on it, so a manifest read that answered "everything"
    // is red here.
    expect(population).not.toContain('packages/i18n');
    expect(population).not.toContain('packages/core');
  });

  it('every package in the population contributed sources, and the matcher found call sites', () => {
    const perPackage = new Map(population.map((p) => [p, 0]));
    for (const s of sources) perPackage.set(s.pkg, (perPackage.get(s.pkg) ?? 0) + 1);
    const empty = [...perPackage].filter(([, n]) => n === 0).map(([p]) => p);
    expect(empty, 'a package in the population with no scanned source').toEqual([]);
    expect(sources.length).toBeGreaterThan(1000);
    expect(sites.length).toBeGreaterThan(100);
  });

  /**
   * ⭐ The lit control, and it is a NEGATIVE: the scan must SEE the deliberate
   * fallback — so it cannot tell "read" from "not scanned" — and must find it
   * declared, not silently skipped.
   */
  it('the lit control is scanned, judged, and declared rather than skipped', () => {
    const control = sites.filter(
      (s) => s.file === 'packages/collaboration/src/CommentThread.tsx' && s.shape === 'bare',
    );
    expect(control.map((s) => s.text)).toEqual(['return date.toLocaleDateString();']);
    expect(DECLARED.some((e) => matches(e, control[0]))).toBe(true);
  });

  it('no call site passes nothing, `undefined` or the `default` pseudo-tag unless it is declared', () => {
    const offenders = sites
      .filter((s) => s.shape === 'bare' || s.shape === 'undefined' || s.shape === 'default')
      .filter((s) => !DECLARED.some((e) => matches(e, s)))
      .map(where);
    expect(
      offenders,
      'these format in the MACHINE locale — route a component through `useDisplayLocale()`, thread the locale a ' +
        'pure helper is handed, or declare the site in DECLARED with its reason',
    ).toEqual([]);
  });

  it('no call site hard-codes a BCP-47 tag unless it is declared', () => {
    const offenders = sites
      .filter((s) => s.shape === 'literal')
      .filter((s) => !DECLARED.some((e) => matches(e, s)))
      .map((s) => `${where(s)}  [${s.tag}]`);
    expect(
      offenders,
      "a hard-coded tag on a DISPLAY path is objectui#4033 again ('en-US' is not the world's default) — use " +
        '`useDisplayLocale()`, or declare the site in DECLARED with its reason',
    ).toEqual([]);
  });

  /**
   * Counted EXACTLY, in both directions: a deleted site whose entry stays would
   * leave a standing exemption for the next call written on that line shape,
   * and a second copy of a declared expression would inherit the first's reason
   * without anyone reading it.
   */
  it('every declared exemption matches exactly the sites it declares', () => {
    const wrong = DECLARED.map((e) => ({ e, n: sites.filter((s) => judged(s) && matches(e, s)).length }))
      .filter(({ e, n }) => n !== e.count)
      .map(({ e, n }) => `${e.file} · ${e.expression} — declared ${e.count}, found ${n}`);
    expect(wrong, 'update or delete the entry together with the call site').toEqual([]);
    for (const e of DECLARED) expect(e.reason.length, `${e.file} carries a reason`).toBeGreaterThan(40);
  });

  /**
   * ⭐ The matcher's own control. Without it every `toEqual([])` above is
   * satisfied by a regex that matches nothing.
   */
  it('the matcher classifies each shape it is meant to classify', () => {
    const fixture = [
      'const a = d.toLocaleDateString();',
      "const b = d.toLocaleString(undefined, { dateStyle: 'medium' });",
      'const c = new Intl.DateTimeFormat(undefined, {});',
      'const e = new Intl.RelativeTimeFormat(locale, {});',
      "const f = d.toLocaleDateString('en-CA');",
      "const g = d.toLocaleString(\"default\", { month: 'short' });",
      'const h = n.toLocaleString();',
      '// const i = d.toLocaleTimeString();',
      '/* const j = new Intl.NumberFormat(); */',
    ].join('\n');
    const shapes = scan('fixture', mask(fixture), fixture).map((s) => s.shape);
    // Seven live call sites; the two commented out must not be sites.
    expect(shapes).toEqual(['bare', 'undefined', 'undefined', 'expression', 'literal', 'default', 'bare']);
  });
});
