// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical-expression-envelope audit for raw-literal `Page` exports
 * (#11255 → #11480).
 *
 * ## The hazard this detects
 *
 * `PageComponentSchema.visibleWhen` is an `ExpressionInputSchema`, whose
 * transform normalizes a bare string into the canonical
 * `{ dialect: 'cel', source }` envelope. **That transform only runs if
 * something parses the page.** A page authored as a raw typed object literal —
 *
 * ```ts
 * export const SysUserDetailPage: Page = { … }
 * ```
 *
 * — is type-checked and never *parsed*, so whatever the author wrote reaches
 * `/api/v1/meta/page` verbatim. A page built through `definePage()` is parsed
 * and serves the envelope.
 *
 * Bare is not cosmetic. objectui's `ExpressionEvaluator.evaluateCondition`
 * routes by SHAPE — bare strings stay on the legacy JS evaluator for its
 * back-compat window, and only an explicit `{ dialect: 'cel' }` envelope is
 * rerouted to CEL. The legacy evaluator has no `has()`, component visibility
 * is fail-**soft**, so a guarded predicate throws and resolves to SHOWN: a
 * declared gate stops gating. In a production console bundle it is completely
 * silent — `SchemaRenderer`'s diagnostic probe sits behind `if (__DEV__)`.
 *
 * Authoring-time signals are all green while this is true: the type accepts
 * the bare string, `tsc` passes, every test passes, the gate farm passes.
 * That is what makes this worth a gate rather than a review habit.
 *
 * ## Why the detector lives HERE, once
 *
 * The first gate on this class was package-local to `platform-objects` (a
 * `packages/spec` test reading platform-objects sources would trip
 * `check:cross-package-test-inputs`), which left every raw-literal page in
 * every OTHER published package unreachable — #11480 records one, found in a
 * `*-ui.ts` file no `*.page.ts` sweep ever looked at. Copying the detector
 * per package is the failure mode `page-walk.ts`'s own header documents as
 * having produced a dead rule, so the detector lives beside that walk and
 * each owning package runs a thin test over its own `Page` exports
 * (`packages/platform-objects/src/pages/canonical-expression-envelopes.test.ts`
 * is the reference consumer — its header carries the population discipline a
 * consuming gate owes: export-shape discovery, coverage floor, precondition
 * asserts).
 *
 * ## Why THREE parse doors, and why each is load-bearing
 *
 * There is no single parse that reaches every expression position on a page,
 * so {@link auditPageExpressionEnvelopes} uses three and unions their
 * findings. `page-envelope-audit.test.ts` proves each one catches something
 * the others miss — none is decoration:
 *
 * | door | parses | reaches | blind to |
 * |:--|:--|:--|:--|
 * | 1 `PageSchema` | the whole page | every schema-typed position (component `visibleWhen`, and any expression key nested in a typed sub-schema) | anything inside `properties` |
 * | 2 `PageComponentSchema` | each walked component | components nested INSIDE `properties` (`page:tabs` → `items[].children[]`, `page:card` → `body`/`footer`) | the `properties` bag itself |
 * | 3 `ComponentPropsMap[type]` | each component's `properties` | expression keys the per-type props schema declares (`record:alert.properties.visible`) | types absent from the map |
 *
 * Door 2 exists because `PageComponentSchema.properties` is
 * `z.record(z.unknown())` — an opaque bag served verbatim. Door 1 walks
 * straight past a whole nested component tree, so a bare predicate on a tab's
 * child is invisible to it. Door 3 exists because that same opacity means a
 * props-level predicate never reaches `ExpressionInputSchema` at all:
 * `record:alert` declares `properties.visible`, and a bare one there hits the
 * legacy evaluator exactly like a bare node `visibleWhen`.
 *
 * ## How a position is IDENTIFIED — behaviourally, not by name
 *
 * Nothing here hardcodes `visibleWhen`. Each door walks the authored object
 * and its parsed counterpart in lockstep and flags exactly one shape: **the
 * author wrote a string, and the parse turned that same string into an
 * expression envelope**. That is the observable signature of an
 * `ExpressionInputSchema` position and of nothing else, so the audit covers
 * `visibility`, every dialect (`cel` / `cron` / `template`), and any
 * expression key added later — without an edit here. Keys that parse merely
 * MATERIALIZES (defaults) are absent from the authored side and so are never
 * flagged. The deprecated-alias case is caught too: when the parse consumed
 * an authored key and re-homed its value under the canonical name, the
 * finding reports both.
 *
 * ## Preconditions are REPORTED, never assumed
 *
 * A door that cannot parse reports nothing, which is indistinguishable from
 * "clean" — the silent-coverage-shrink shape. So the audit reports every
 * door's failure to open (`pageParseError`, `componentParseErrors`,
 * `unmappedTypes`, `unreadableProps`) alongside its findings, and a consuming
 * gate must assert each of those channels — as its own test, so the red says
 * which door just stopped reading rather than the gate going quietly green
 * over a population it no longer covers. An `unmappedTypes` entry may be a
 * deliberate exemption (a console-registered widget type with no
 * `ComponentPropsMap` row); a consumer records that exemption in its own
 * assert, with the reason, never by ignoring the channel.
 *
 * @see packages/spec/src/shared/expression.zod.ts — `ExpressionInputSchema`
 * @see packages/spec/src/ui/page.zod.ts — `PageComponentSchema.visibleWhen`
 */

import { ComponentPropsMap, PageComponentSchema, PageSchema } from '@objectstack/spec/ui';
import { walkPageComponents } from './page-walk.js';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * An expression envelope, as much of one as this audit needs to recognise:
 * `ExpressionSchema` requires `dialect` and at least one of `source` / `ast`.
 */
const isEnvelope = (v: unknown): v is { dialect: string; source?: unknown } =>
  isRec(v) && typeof v.dialect === 'string';

/** Which parse produced a finding — see the door table in the module header. */
export type EnvelopeAuditDoor = 'PageSchema' | 'PageComponentSchema' | 'ComponentPropsMap';

/** One bare-expression position: authored as a string, normalized by a parse. */
export interface BareExpressionFinding {
  /** The consumer's page label, e.g. `<ExportName> (<page.name>)`. */
  page: string;
  /** Authored path from the page root, e.g. `slots.alerts[0].visibleWhen`. */
  path: string;
  /** The bare string the author wrote — what reaches the wire verbatim. */
  authored: string;
  /** Set when the parse also RENAMED the key (deprecated alias). */
  normalizedTo?: string;
  door: EnvelopeAuditDoor;
}

/**
 * A minimal zod-schema face — all this module calls on the schemas it reads.
 * Structural on purpose: the audit compares parse OUTPUT against authored
 * input and never touches zod's own types, so a zod major cannot ripple here.
 */
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
 * every position where the author wrote a string that the parse turned into
 * an expression envelope.
 *
 * Iteration is driven by the AUTHORED side, deliberately: keys the parse
 * materialized (defaults) have no authored counterpart and must not be read
 * as findings.
 *
 * ## The cycle guard — ancestor-scoped, on the authored side
 *
 * `properties` is `z.record(z.unknown())` and `properties.children` is
 * `z.array(z.unknown())`, so a page whose component tree contains itself
 * (`A -> B -> A`) is input the schema ADMITS: `PageSchema.safeParse` succeeds
 * and this walk then recursed until the stack died. Door 1 runs it over the
 * WHOLE page before anything else, so the audit died HERE first — the shared
 * walk's own guard is a different function and never got the chance to help.
 *
 * Two properties of the guard are load-bearing, and each is pinned by a test:
 *
 *   - **It tracks the current descent path, not every object ever visited.** A
 *     visited-set would also skip a subtree that is merely SHARED — the same
 *     component literal referenced from two slots is legal, acyclic authoring —
 *     and would silently drop its findings. An ancestor set skips a node only
 *     when it is its own ancestor, which on acyclic input never happens, so the
 *     guard is report-neutral there by construction rather than by luck.
 *   - **It tracks `raw`, not `parsed`.** Iteration is driven by the authored
 *     side (above), so every recursive call descends one level in `raw`;
 *     bounding `raw`'s simple-path depth bounds the recursion whatever shape
 *     `parsed` has. Tracking `parsed` too would add nothing and would risk
 *     suppressing findings wherever a parse legitimately shares one object
 *     across positions.
 *
 * Cycles through arrays are covered as well as cycles through records: the set
 * holds any object identity, so an array that contains itself terminates too.
 *
 * On a cyclic page the descent stops at the repeat and no DISTINCT position is
 * lost — every node of a finite graph is reachable by a simple path, so each
 * authored position is still visited; what is dropped is the infinite tail of
 * re-reports at ever-longer paths. The truncation is not surfaced on any
 * precondition channel: unlike a door that could not open, this one read
 * everything there was to read.
 *
 * @internal Package-internal (not re-exported from the barrel): a consumer
 * always wants the three-door union {@link auditPageExpressionEnvelopes};
 * this single-door primitive exists so `page-envelope-audit.test.ts` can
 * prove door necessity — running one door in isolation and showing what it
 * alone cannot see.
 */
export function collectBare(
  raw: unknown,
  parsed: unknown,
  path: string,
  page: string,
  door: EnvelopeAuditDoor,
  out: BareExpressionFinding[],
  ancestors: Set<object> = new Set(),
): void {
  if (typeof raw === 'string') {
    if (isEnvelope(parsed) && parsed.source === raw) {
      out.push({ page, path, authored: raw, door });
    }
    return;
  }
  // Primitives carry no descent and no cycle; below here `raw` is an object.
  if (raw === null || typeof raw !== 'object') return;

  // ── Cycle guard ────────────────────────────────────────────────────────────
  // `ancestors` holds the objects on the CURRENT descent path — added on entry,
  // removed on exit. Both halves of that are load-bearing; see the doc above.
  if (ancestors.has(raw)) return;
  ancestors.add(raw);
  try {
    if (Array.isArray(raw)) {
      if (!Array.isArray(parsed)) return;
      for (let i = 0; i < raw.length; i++) {
        collectBare(raw[i], parsed[i], `${path}[${i}]`, page, door, out, ancestors);
      }
      return;
    }
    if (!isRec(raw) || !isRec(parsed)) return;

    for (const [key, value] of Object.entries(raw)) {
      const childPath = path ? `${path}.${key}` : key;
      const counterpart = parsed[key];

      // Deprecated-alias case: the parse consumed this key and re-homed its
      // value under the canonical name (`visibility` -> `visibleWhen`). A
      // key-parallel walk alone would see `undefined` on the parsed side and
      // move on, so the value is looked up by its own source text instead.
      if (counterpart === undefined && typeof value === 'string' && value.length > 0) {
        const renamed = Object.entries(parsed).find(
          ([, pv]) => isEnvelope(pv) && pv.source === value,
        );
        if (renamed) {
          out.push({ page, path: childPath, authored: value, normalizedTo: renamed[0], door });
          continue;
        }
      }

      collectBare(value, counterpart, childPath, page, door, out, ancestors);
    }
  } finally {
    ancestors.delete(raw);
  }
}

/** The three-door union over one page, findings and door preconditions both. */
export interface PageEnvelopeAudit {
  /** Every bare-expression position any door found, deduped by path, sorted. */
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
 * Run all three parse doors over one authored page and union their findings.
 *
 * Read `findings` for the verdict, and assert the four precondition channels
 * separately (see the module header — a door that could not open reports
 * there, never as a silently smaller `findings`).
 *
 * Exported findings are deduped by path: a top-level component's
 * `visibleWhen` is legitimately seen by doors 1 AND 2, and reporting it twice
 * would read as two defects.
 *
 * @param page - The authored page object, exactly as exported (never parsed
 *   first — the audit's whole subject is what the raw export serves).
 * @param pageLabel - How findings should name the page; consumers use
 *   `<ExportName> (<page.name>)`.
 */
export function auditPageExpressionEnvelopes(page: unknown, pageLabel: string): PageEnvelopeAudit {
  const audit: PageEnvelopeAudit = {
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
  // `walkPageComponents` is the one shared traversal: it knows components hang
  // off `regions[].components[]` and `slots.<slot>` (a slot holds ONE
  // component or an array), and it descends the untyped sub-trees inside
  // `properties`. Duplicating that walk is how a rule built on it goes dead
  // (its own header carries the incident), so it is imported rather than
  // rewritten.
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
export function renderBareExpressionFindings(findings: readonly BareExpressionFinding[]): string {
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
