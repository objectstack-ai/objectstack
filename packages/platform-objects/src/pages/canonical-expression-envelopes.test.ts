// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Gate — every `Page` this package exports must serve the CANONICAL
 * `{ dialect, source }` envelope at every `ExpressionInputSchema` position.
 *
 * ## The hazard this closes
 *
 * `PageComponentSchema.visibleWhen` is an `ExpressionInputSchema`, whose
 * transform normalizes a bare string into `{ dialect: 'cel', source }`. **That
 * transform only runs if something parses the page.** A page authored as a raw
 * typed object literal —
 *
 * ```ts
 * export const SysUserDetailPage: Page = { … }
 * ```
 *
 * — is type-checked and never *parsed*, so whatever the author wrote reaches
 * `/api/v1/meta/page` verbatim. Every page in this package is authored that
 * way; a page built through `definePage()` is parsed and serves the envelope.
 *
 * Bare is not cosmetic. objectui's `ExpressionEvaluator.evaluateCondition`
 * routes by SHAPE — bare strings stay on the legacy JS evaluator for its
 * back-compat window, and only an explicit `{ dialect: 'cel' }` envelope is
 * rerouted to CEL. The legacy evaluator has no `has()`, component visibility is
 * fail-**soft**, so a guarded predicate throws and resolves to SHOWN: a declared
 * gate stops gating. In a production console bundle it is completely silent —
 * `SchemaRenderer`'s diagnostic probe sits behind `if (__DEV__)`.
 *
 * Authoring-time signals are all green while this is true: the type accepts the
 * bare string, `tsc` passes, every test passes, the gate farm passes. That is
 * what makes this worth a gate rather than a review habit.
 *
 * ## Why THREE parse doors, and why each is load-bearing
 *
 * There is no single parse that reaches every expression position on a page, so
 * this gate uses three and unions their findings. `negative control` below
 * proves each one catches something the others miss — none is decoration:
 *
 * | door | parses | reaches | blind to |
 * |:--|:--|:--|:--|
 * | 1 `PageSchema` | the whole page | every schema-typed position (component `visibleWhen`, and any expression key nested in a typed sub-schema) | anything inside `properties` |
 * | 2 `PageComponentSchema` | each walked component | components nested INSIDE `properties` (`page:tabs` → `items[].children[]`, `page:card` → `body`/`footer`) | the `properties` bag itself |
 * | 3 `ComponentPropsMap[type]` | each component's `properties` | expression keys the per-type props schema declares (`record:alert.properties.visible`) | types absent from the map |
 *
 * Door 2 exists because `PageComponentSchema.properties` is
 * `z.record(z.unknown())` — an opaque bag served verbatim. Door 1 walks straight
 * past a whole nested component tree, so a bare predicate on a tab's child is
 * invisible to it. Door 3 exists because that same opacity means a props-level
 * predicate never reaches `ExpressionInputSchema` at all: `record:alert`
 * declares `properties.visible`, and a bare one there hits the legacy evaluator
 * exactly like a bare node `visibleWhen`.
 *
 * ## How a position is IDENTIFIED — behaviourally, not by name
 *
 * Nothing here hardcodes `visibleWhen`. Each door walks the authored object and
 * its parsed counterpart in lockstep and flags exactly one shape: **the author
 * wrote a string, and the parse turned that same string into an expression
 * envelope**. That is the observable signature of an `ExpressionInputSchema`
 * position and of nothing else, so the gate covers `visibility`, every dialect
 * (`cel` / `cron` / `template`), and any expression key added later — without an
 * edit here. Keys that parse merely MATERIALIZES (defaults) are absent from the
 * authored side and so are never flagged.
 *
 * The deprecated-alias case is caught too: when the parse consumed an authored
 * key and re-homed its value under the canonical name, the finding reports both.
 *
 * ## The preconditions are asserted, not assumed
 *
 * A door that cannot parse reports nothing, which is indistinguishable from
 * "clean" — the silent-coverage-shrink shape. So each door's precondition is its
 * own test: the page parses, every component parses, every component type is
 * mapped, every authored props bag parses. If one of those ever goes red, the
 * message says which door just stopped reading, rather than this file going
 * quietly green over a population it no longer covers.
 *
 * @see packages/spec/src/shared/expression.zod.ts — `ExpressionInputSchema`
 * @see packages/spec/src/ui/page.zod.ts — `PageComponentSchema.visibleWhen`
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ComponentPropsMap, PageComponentSchema, PageSchema } from '@objectstack/spec/ui';
import type { Page } from '@objectstack/spec/ui';
import { walkPageComponents } from '@objectstack/lint';
import * as pageExports from './index.js';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * An expression envelope, as much of one as this file needs to recognise:
 * `ExpressionSchema` requires `dialect` and at least one of `source` / `ast`.
 */
const isEnvelope = (v: unknown): v is { dialect: string; source?: unknown } =>
  isRec(v) && typeof v.dialect === 'string';

/** Which parse produced a finding — see the door table in the header. */
type Door = 'PageSchema' | 'PageComponentSchema' | 'ComponentPropsMap';

interface BareExpressionFinding {
  /** `<ExportName> (<page.name>)`. */
  page: string;
  /** Authored path from the page root, e.g. `slots.alerts[0].visibleWhen`. */
  path: string;
  /** The bare string the author wrote — what reaches the wire verbatim. */
  authored: string;
  /** Set when the parse also RENAMED the key (deprecated alias). */
  normalizedTo?: string;
  door: Door;
}

/** A minimal zod-schema face — all this file calls on the schemas it is handed. */
interface Parseable {
  safeParse(value: unknown): {
    success: boolean;
    data?: unknown;
    error?: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> };
  };
}

const PROPS_SCHEMAS = ComponentPropsMap as unknown as Record<string, Parseable | undefined>;

function issueText(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> } | undefined): string {
  if (!error) return '(no issues reported)';
  return error.issues
    .map(i => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join(' | ');
}

/**
 * Walk an authored value and its parsed counterpart in lockstep, collecting
 * every position where the author wrote a string that the parse turned into an
 * expression envelope.
 *
 * Iteration is driven by the AUTHORED side, deliberately: keys the parse
 * materialized (defaults) have no authored counterpart and must not be read as
 * findings.
 */
function collectBare(
  raw: unknown,
  parsed: unknown,
  path: string,
  page: string,
  door: Door,
  out: BareExpressionFinding[],
): void {
  if (typeof raw === 'string') {
    if (isEnvelope(parsed) && parsed.source === raw) {
      out.push({ page, path, authored: raw, door });
    }
    return;
  }
  if (Array.isArray(raw)) {
    if (!Array.isArray(parsed)) return;
    for (let i = 0; i < raw.length; i++) {
      collectBare(raw[i], parsed[i], `${path}[${i}]`, page, door, out);
    }
    return;
  }
  if (!isRec(raw) || !isRec(parsed)) return;

  for (const [key, value] of Object.entries(raw)) {
    const childPath = path ? `${path}.${key}` : key;
    const counterpart = parsed[key];

    // Deprecated-alias case: the parse consumed this key and re-homed its value
    // under the canonical name (`visibility` -> `visibleWhen`). A key-parallel
    // walk alone would see `undefined` on the parsed side and move on, so the
    // value is looked up by its own source text instead.
    if (counterpart === undefined && typeof value === 'string' && value.length > 0) {
      const renamed = Object.entries(parsed).find(
        ([, pv]) => isEnvelope(pv) && pv.source === value,
      );
      if (renamed) {
        out.push({ page, path: childPath, authored: value, normalizedTo: renamed[0], door });
        continue;
      }
    }

    collectBare(value, counterpart, childPath, page, door, out);
  }
}

interface PageAudit {
  findings: BareExpressionFinding[];
  /** Door 1 could not run — the page itself does not parse. */
  pageParseError?: string;
  /** Door 2 could not run for these components. */
  componentParseErrors: { path: string; type: string; issues: string }[];
  /** Door 3 has no schema to parse these components' `properties` with. */
  unmappedTypes: { path: string; type: string }[];
  /** Door 3 could not run — the authored bag is refused by its props schema. */
  unreadableProps: { path: string; type: string; issues: string }[];
  /** How many components the walk reached (coverage floor for doors 2 and 3). */
  componentCount: number;
}

/**
 * Run all three doors over one authored page.
 *
 * Exported findings are deduped by path: a top-level component's `visibleWhen`
 * is legitimately seen by doors 1 AND 2, and reporting it twice would read as
 * two defects.
 */
function auditPage(page: unknown, pageLabel: string): PageAudit {
  const audit: PageAudit = {
    findings: [],
    componentParseErrors: [],
    unmappedTypes: [],
    unreadableProps: [],
    componentCount: 0,
  };
  if (!isRec(page)) {
    audit.pageParseError = 'not an object';
    return audit;
  }

  const raw: BareExpressionFinding[] = [];

  // ── Door 1 — the whole page through `PageSchema` ───────────────────────────
  const parsedPage = (PageSchema as unknown as Parseable).safeParse(page);
  if (parsedPage.success) {
    collectBare(page, parsedPage.data, '', pageLabel, 'PageSchema', raw);
  } else {
    audit.pageParseError = issueText(parsedPage.error);
  }

  // ── Doors 2 & 3 — every component the page walk reaches ────────────────────
  // `walkPageComponents` is the one shared traversal (`@objectstack/lint`): it
  // knows components hang off `regions[].components[]` and `slots.<slot>` (a
  // slot holds ONE component or an array), and it descends the untyped
  // sub-trees inside `properties`. Duplicating that walk here is how a rule
  // built on it goes dead, so it is imported rather than rewritten.
  const walked = walkPageComponents(page, '');
  audit.componentCount = walked.length;

  for (const { component, path: walkedPath } of walked) {
    const componentPath = walkedPath.replace(/^\./, '');
    const type = typeof component.type === 'string' ? component.type : '(non-string type)';

    const parsedComponent = (PageComponentSchema as unknown as Parseable).safeParse(component);
    if (parsedComponent.success) {
      collectBare(component, parsedComponent.data, componentPath, pageLabel, 'PageComponentSchema', raw);
    } else {
      audit.componentParseErrors.push({ path: componentPath, type, issues: issueText(parsedComponent.error) });
    }

    const propsSchema = PROPS_SCHEMAS[type];
    if (!propsSchema) {
      audit.unmappedTypes.push({ path: componentPath, type });
      continue;
    }
    // A component may author no `properties` at all (`element:divider`).
    // Nothing authored is nothing to serve bare, so there is no door to open.
    if (!isRec(component.properties)) continue;

    const parsedProps = propsSchema.safeParse(component.properties);
    if (parsedProps.success) {
      collectBare(
        component.properties,
        parsedProps.data,
        `${componentPath}.properties`,
        pageLabel,
        'ComponentPropsMap',
        raw,
      );
    } else {
      audit.unreadableProps.push({ path: componentPath, type, issues: issueText(parsedProps.error) });
    }
  }

  const seen = new Set<string>();
  for (const finding of raw) {
    const key = `${finding.page}::${finding.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    audit.findings.push(finding);
  }
  audit.findings.sort((a, b) => a.path.localeCompare(b.path));
  return audit;
}

/** Render findings as the actionable red an author reads in CI. */
function renderFindings(findings: readonly BareExpressionFinding[]): string {
  return findings
    .map(f => {
      const renamed = f.normalizedTo
        ? ` (deprecated key — parse re-homes it to \`${f.normalizedTo}\`)`
        : '';
      return (
        `${f.page} · ${f.path}${renamed}\n`
        + `    authored BARE: ${JSON.stringify(f.authored)}\n`
        + `    seen by: ${f.door}\n`
        + '    fix: author the canonical envelope — P`…` (or { dialect: \'cel\', source: … }).\n'
        + '         This page is a raw object literal: nothing parses it, so a bare string\n'
        + '         reaches the wire verbatim and the console routes it to its LEGACY\n'
        + '         evaluator, where a fail-soft predicate stops gating silently.'
      );
    })
    .join('\n\n');
}

// ───────────────────────────────────────────────────────────────────────────
// The population this gate covers
// ───────────────────────────────────────────────────────────────────────────

const HERE = dirname(fileURLToPath(import.meta.url));
/** This package's own `src/` — never escapes the package. */
const PACKAGE_SRC = join(HERE, '..');

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

/** Strip comments so a `: Page =` inside prose is not read as a declaration. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
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
    const source = stripComments(readFileSync(file, 'utf8'));
    for (const match of source.matchAll(/export\s+const\s+(\w+)\s*:\s*Page\s*=/g)) {
      out.push({ name: match[1]!, file: file.slice(PACKAGE_SRC.length + 1) });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const AUDITS = EXPORTED_PAGES.map(([exportName, page]) => ({
  exportName,
  page,
  audit: auditPage(page, pageLabel(exportName, page)),
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
    expect(renderFindings(audit.findings)).toBe('');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Negative control — proof the detector fires, and that each door is needed
// ───────────────────────────────────────────────────────────────────────────

const BARE = 'has(record.id) && record.id == ctx.user.id';

/** A page whose ONE predicate sits on a top-level slot component. */
function topLevelPredicatePage(visibleWhen: unknown): AnyRec {
  return {
    name: 'nc_top_level',
    label: 'Negative control',
    type: 'record',
    object: 'sys_user',
    template: 'default',
    kind: 'slotted',
    regions: [],
    slots: { alerts: [{ type: 'record:alert', visibleWhen, properties: { severity: 'warning' } }] },
  };
}

/** A page whose ONE predicate sits on a component NESTED inside `properties`. */
function nestedPredicatePage(visibleWhen: unknown): AnyRec {
  return {
    name: 'nc_nested',
    label: 'Negative control',
    type: 'record',
    object: 'sys_user',
    template: 'default',
    kind: 'slotted',
    regions: [],
    slots: {
      tabs: {
        type: 'page:tabs',
        properties: {
          items: [
            {
              label: { en: 'Tab' },
              children: [{ type: 'record:alert', visibleWhen, properties: { severity: 'warning' } }],
            },
          ],
        },
      },
    },
  };
}

/** A page whose ONE predicate sits INSIDE the opaque `properties` bag. */
function propsPredicatePage(visible: unknown): AnyRec {
  return {
    name: 'nc_props',
    label: 'Negative control',
    type: 'record',
    object: 'sys_user',
    template: 'default',
    kind: 'slotted',
    regions: [],
    slots: { alerts: [{ type: 'record:alert', properties: { severity: 'warning', visible } }] },
  };
}

const envelope = { dialect: 'cel' as const, source: BARE };

describe('negative control — the detector fires, and every door earns its place', () => {
  it('catches a bare predicate on a top-level component, naming page and key path', () => {
    const audit = auditPage(topLevelPredicatePage(BARE), 'nc (nc_top_level)');
    expect(audit.findings).toHaveLength(1);
    expect(audit.findings[0]!.path).toBe('slots.alerts[0].visibleWhen');
    expect(audit.findings[0]!.authored).toBe(BARE);

    const rendered = renderFindings(audit.findings);
    expect(rendered).toContain('nc_top_level');
    expect(rendered).toContain('slots.alerts[0].visibleWhen');
    expect(rendered).toContain('authored BARE');
  });

  it('passes the SAME predicate authored as the canonical envelope (no blanket flagging)', () => {
    const audit = auditPage(topLevelPredicatePage(envelope), 'nc (nc_top_level)');
    expect(renderFindings(audit.findings)).toBe('');
    // The preconditions hold on the control fixtures too, so a green above is a
    // real verdict rather than a door that never opened.
    expect(audit.pageParseError ?? '').toBe('');
    expect(audit.componentParseErrors).toEqual([]);
  });

  it('catches a bare predicate on a component NESTED inside `properties` — which door 1 alone cannot see', () => {
    const page = nestedPredicatePage(BARE);
    const audit = auditPage(page, 'nc (nc_nested)');
    expect(audit.findings.map(f => f.path)).toEqual([
      'slots.tabs.properties.items[0].children[0].visibleWhen',
    ]);
    expect(audit.findings[0]!.door).toBe('PageComponentSchema');

    // Door 1 in isolation: `PageSchema` serves `properties` verbatim, so the
    // nested predicate is still a bare string in its own output — nothing to
    // compare against, nothing found. This is why door 2 exists.
    const doorOneOnly: BareExpressionFinding[] = [];
    const parsed = (PageSchema as unknown as Parseable).safeParse(page);
    expect(parsed.success).toBe(true);
    collectBare(page, parsed.data, '', 'nc', 'PageSchema', doorOneOnly);
    expect(doorOneOnly).toEqual([]);
  });

  it('catches a bare predicate inside the `properties` bag — which doors 1 and 2 alone cannot see', () => {
    const page = propsPredicatePage(BARE);
    const audit = auditPage(page, 'nc (nc_props)');
    expect(audit.findings.map(f => f.path)).toEqual([
      'slots.alerts[0].properties.visible',
    ]);
    expect(audit.findings[0]!.door).toBe('ComponentPropsMap');

    // Doors 1 and 2 both treat `properties` as an opaque record.
    const doorsOneTwo: BareExpressionFinding[] = [];
    const parsedPage = (PageSchema as unknown as Parseable).safeParse(page);
    collectBare(page, parsedPage.data, '', 'nc', 'PageSchema', doorsOneTwo);
    for (const { component, path } of walkPageComponents(page, '')) {
      const parsedComponent = (PageComponentSchema as unknown as Parseable).safeParse(component);
      collectBare(component, parsedComponent.data, path.replace(/^\./, ''), 'nc', 'PageComponentSchema', doorsOneTwo);
    }
    expect(doorsOneTwo).toEqual([]);
  });

  it('catches a bare predicate at the DEPRECATED `visibility` key and names the canonical one', () => {
    const page = {
      name: 'nc_alias',
      label: 'Negative control',
      type: 'record',
      object: 'sys_user',
      template: 'default',
      kind: 'slotted',
      regions: [],
      slots: { alerts: [{ type: 'record:alert', visibility: BARE, properties: { severity: 'warning' } }] },
    };
    const audit = auditPage(page, 'nc (nc_alias)');
    expect(audit.findings.map(f => f.path)).toEqual(['slots.alerts[0].visibility']);
    expect(audit.findings[0]!.normalizedTo).toBe('visibleWhen');
    expect(renderFindings(audit.findings)).toContain('deprecated key');
  });

  it('flags a REAL exported page the moment its predicate is down-graded to bare', () => {
    // The operative acceptance criterion, exercised against the shipped page
    // rather than a fixture: take the real export, replace its one canonical
    // envelope with the bare source it wraps, and confirm the gate reds with a
    // path an author can act on. Deep-cloned — the export itself is untouched.
    const source = JSON.parse(JSON.stringify(pageExports.SysUserDetailPage)) as AnyRec;
    const slots = source.slots as AnyRec;
    const alerts = slots.alerts as AnyRec[];
    const authored = (alerts[0]!.visibleWhen as AnyRec).source as string;
    expect(typeof authored).toBe('string');
    alerts[0]!.visibleWhen = authored;

    const audit = auditPage(source, pageLabel('SysUserDetailPage', source as unknown as Page));
    expect(audit.findings.map(f => f.path)).toEqual(['slots.alerts[0].visibleWhen']);
    const rendered = renderFindings(audit.findings);
    expect(rendered).toContain('sys_user_detail');
    expect(rendered).toContain('slots.alerts[0].visibleWhen');

    // …and the untouched export is still clean, so the red above came from the
    // mutation and not from something this test left behind.
    const pristine = auditPage(
      pageExports.SysUserDetailPage,
      pageLabel('SysUserDetailPage', pageExports.SysUserDetailPage),
    );
    expect(renderFindings(pristine.findings)).toBe('');
  });
});
