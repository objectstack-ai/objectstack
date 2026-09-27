// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  classifyFilterToken,
  CONTEXT_TOKENS,
  isRecordContextToken,
  type RecordContextToken,
} from '@objectstack/spec/data';

import { scanForFilters, walkAuthoredFilters, type AuthoredFilter, type FilterSurface } from './filter-walk.js';
import { recordsOf } from './object-graph.js';

/**
 * Build-time filter-placeholder diagnostics (issue #3574).
 *
 * Filter values travel as JSON, so a user-scoped or time-scoped slice cannot
 * call code inline — it writes a placeholder that the client resolves just
 * before querying:
 *
 *     { owner_id: '{current_user_id}', created_at: { $gte: '{week_start}' } }
 *
 * Exactly two vocabularies resolve inside a filter value: context tokens
 * (`{current_user_id}`, `{current_org_id}` — see `context-tokens.zod.ts`) and
 * date macros (`{today}`, `{30_days_ago}` — see `date-macros.zod.ts`).
 * Anything else is passed to the data engine **verbatim**, matches no row, and
 * the surface renders an empty result.
 *
 * ## Why this is an error, not a warning
 *
 * The runtime failure mode is silent and indistinguishable from success. A
 * metric widget filtered on an unresolved `{current_user}` renders `0`, which
 * looks exactly like a metric that is legitimately zero — no console error, no
 * server log, nothing for a human reviewer to notice. Issue #3574 found a
 * dashboard that had been broken this way since the day it was written.
 *
 * That failure mode is worse for AI authors than for humans. An AI reads a
 * successful query returning `0` as a correct answer and builds on it — it has
 * no instinct that the number looks wrong. Its correction loop is
 * "author → validate → fix", so a diagnostic only reaches it if the diagnostic
 * can fail the build. A runtime warning in a server log is invisible to it.
 * Hence: authoring-time error.
 *
 * The near-miss spellings this catches are not hypothetical. Each is a correct
 * spelling *somewhere else* in the platform, which is precisely why authors
 * reach for them:
 *
 * - `{current_user}` — `current_user.id` is the RLS expression root
 * - `{user_id}` — `{user_id}` is valid `titleFormat` field interpolation
 * - `{current_organization_id}` — `organization_id` is the real column name
 *
 * `CONTEXT_TOKEN_SUGGESTIONS` maps each to what the author meant, so the
 * diagnostic names the fix instead of only reporting the symptom.
 *
 * ## Scope — filter subtrees only
 *
 * Finding those subtrees is `filter-walk.ts`'s job since #5330 gave the same
 * traversal a second consumer; this file owns only the judgement on the strings
 * inside them. The shared walk descends into `filter` / `filters` /
 * `runtimeFilter` and deliberately does NOT check navigation `recordId` /
 * `params`, which resolve an additional vocabulary — `AppContextSelector` ids
 * such as `{active_package}` — that is meaningless in a filter because filters
 * are not evaluated with the sidebar's selector state. Restricting the walk
 * keeps that legitimate usage out of the rule and holds false positives at
 * zero. The seven surfaces below stay THIS rule's declaration, not the walk's:
 * a shared surface list would let another rule's widening land here silently.
 *
 * Only whole-string placeholders are considered (`'{token}'` / `'${token}'`,
 * anchored). A value that merely contains braces is left alone.
 *
 * ## `{record_id}` — valid on a record page, refused by name everywhere else
 *
 * The record-context token (`RECORD_CONTEXT_TOKENS`) is the id of the record a
 * `type: 'record'` page is showing. Only that page's renderer can resolve it,
 * so the verdict depends on the SURFACE: accepted in any filter on a record
 * page, and refused on every other surface this rule walks (list views and the
 * rest of an object definition, dashboard widgets, reports, datasets, apps, and
 * `home` / `app` / `utility` / `list` pages). The refusal says why, "no record
 * in context on this surface". The unknown-token message would send the author
 * hunting for a spelling mistake that is not there.
 *
 * Which pages are record pages is read from the page's own `type`, and this
 * rule runs on the PARSED stack (`input: 'parsed'` in `authoring-rules.ts`),
 * where `PageSchema` has already applied its `'record'` default. That is why
 * the `pages` collection is walked page by page here, through the walk's
 * exported single-item entry {@link scanForFilters}, rather than through
 * {@link walkAuthoredFilters}: the walk reports a filter's value, path and
 * label, and deliberately holds no judgement about the item it came from.
 * The page loop spells the path and label exactly as the walk does, and a test
 * holds the two equal.
 */

/**
 * Diagnostic rule id: a filter placeholder this surface cannot resolve.
 *
 * Two causes share it: a placeholder outside every vocabulary (`{current_user}`,
 * `{TODAY()}`), and the record-context token `{record_id}` on a surface with
 * no record in context. The message and hint say which, so the finding stays
 * actionable. A consumer keyed on the id acts the same either way: this
 * filter cannot run where it is written.
 */
export const FILTER_TOKEN_UNKNOWN = 'filter-token-unknown';

export type FilterTokenSeverity = 'error' | 'warning';

export interface FilterTokenFinding {
  /** Always `error` today — an unresolved placeholder silently matches nothing. */
  severity: FilterTokenSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `dashboard "sales" · widget "my_deals"`. */
  where: string;
  /** Config path, e.g. `dashboards[0].widgets[2].filter.owner_id`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

const KNOWN_LIST = CONTEXT_TOKENS.join('}, {');

/** A walked collection, plus how a `{record_id}` refusal names it. */
interface TokenFilterSurface extends FilterSurface {
  readonly noun: string;
}

/**
 * The presentation collections this rule has scanned since #3574. Declared
 * here, handed to the shared walk — see the scope note above for why it is not
 * a constant in `filter-walk.ts`.
 */
const TOKEN_FILTER_SURFACES: readonly TokenFilterSurface[] = [
  { key: 'dashboards', kind: 'dashboard', noun: 'a dashboard' },
  { key: 'objects', kind: 'object', noun: 'an object definition (its list views and field filters)' },
  { key: 'views', kind: 'view', noun: 'a view' },
  { key: 'reports', kind: 'report', noun: 'a report' },
  { key: 'datasets', kind: 'dataset', noun: 'a dataset' },
  // Judged page by page — see `pageRecordScope`.
  { key: 'pages', kind: 'page', noun: 'a page' },
  { key: 'apps', kind: 'app', noun: 'an app' },
];

/**
 * Whether the filters being judged have a record in context, and, when they
 * do not, how to name the surface in the refusal.
 */
interface RecordScope {
  readonly recordInContext: boolean;
  /** e.g. `a dashboard`, `a page of type "list"`. Unused when a record is in context. */
  readonly surface: string;
}

/** `PageSchema.type`'s default: a record page. */
const PAGE_TYPE_DEFAULT = 'record';

/**
 * The record scope of one page: a record is in context on a `type: 'record'`
 * page and on no other.
 *
 * On the parsed stack this rule is registered for, `type` is always present.
 * An absent `type` is the same page, before `PageSchema`'s `'record'` default
 * was applied, so it is judged as that default. That is the schema's declared
 * default, not a tolerated spelling; a test holds it equal to the schema.
 */
function pageRecordScope(page: AnyRec): RecordScope {
  const type = page.type === undefined ? PAGE_TYPE_DEFAULT : page.type;
  return type === PAGE_TYPE_DEFAULT
    ? { recordInContext: true, surface: 'a record page' }
    : { recordInContext: false, surface: `a page of type ${JSON.stringify(type)}` };
}

/** Same `where` label as the shared walk: the item's `name`, else `id`, else `#i`. */
function itemLabel(item: AnyRec, i: number): string {
  const v = item.name ?? item.id;
  return typeof v === 'string' && v.length > 0 ? v : `#${i}`;
}

function recordContextFinding(
  node: string,
  token: RecordContextToken,
  path: string,
  where: string,
  scope: RecordScope,
): FilterTokenFinding {
  return {
    severity: 'error',
    rule: FILTER_TOKEN_UNKNOWN,
    where,
    path,
    message:
      `Filter value "${node}" stands for the record in context, and there is no record ` +
      `in context on this surface (${scope.surface}). {${token}} resolves only in a filter ` +
      `on a component of a \`type: 'record'\` page, where the renderer knows which record ` +
      `is in view. Anywhere else the server refuses the query rather than counting every ` +
      `record or none.`,
    hint:
      `Move this filter onto a component of a record page (\`type: 'record'\`), or filter on ` +
      `a concrete id. To scope to the signed-in user instead, use {current_user_id}.`,
  };
}

/**
 * Classify every string inside an already-identified filter subtree.
 *
 * Walks arrays and plain objects uniformly, which is what makes this work
 * across the platform's two filter shapes: the MongoDB-style object a
 * dashboard widget carries (`{ owner_id: '{current_user_id}' }`) and the
 * condition/triple arrays a list view carries
 * (`[{ field, operator, value }]` / `[['owner','=','…']]`). The bug this rule
 * exists for was caused by a resolver that handled only one of those shapes.
 */
function walkFilterValues(
  node: unknown,
  path: string,
  where: string,
  scope: RecordScope,
  out: FilterTokenFinding[],
  seen: Set<unknown>,
): void {
  if (node === null || node === undefined) return;

  if (typeof node === 'string') {
    const cls = classifyFilterToken(node);
    if (cls?.kind === 'record-context' && !scope.recordInContext) {
      out.push(recordContextFinding(node, cls.token, path, where, scope));
    } else if (cls?.kind === 'unknown') {
      const suggestion = cls.suggestion;
      out.push({
        severity: 'error',
        rule: FILTER_TOKEN_UNKNOWN,
        where,
        path,
        message:
          `Filter value "${node}" is not a resolvable placeholder. It is sent to the ` +
          `data engine as a literal string, matches no record, and the surface renders empty.`,
        hint: suggestion && isRecordContextToken(suggestion)
          ? `Did you mean "{${suggestion}}"? It resolves only in a filter on a component of a ` +
            `\`type: 'record'\` page, to the id of the record in view.`
          : suggestion
          ? `Did you mean "{${suggestion}}"? Context tokens are {${KNOWN_LIST}}; ` +
            `time-based values use date macros such as {today} or {30_days_ago}.`
          : `Resolvable placeholders are the context tokens {${KNOWN_LIST}} and the ` +
            `date macros (e.g. {today}, {week_start}, {30_days_ago}). To filter on a ` +
            `literal value that happens to look like a placeholder, this is not supported — ` +
            `rename the value.`,
      });
    }
    return;
  }

  if (typeof node !== 'object') return;
  // Metadata graphs can be cyclic once normalized; guard the walk.
  if (seen.has(node)) return;
  seen.add(node);

  if (Array.isArray(node)) {
    node.forEach((v, i) => walkFilterValues(v, `${path}[${i}]`, where, scope, out, seen));
    return;
  }

  for (const [k, v] of Object.entries(node as AnyRec)) {
    walkFilterValues(v, `${path}.${k}`, where, scope, out, seen);
  }
}

/**
 * Validate filter placeholders across a schema-parsed stack.
 *
 * Pure `(stack) => Finding[]`; no I/O. Covers dashboards (widget + global
 * filters), objects (list views), top-level view containers, reports,
 * datasets, and pages.
 */
export function validateFilterTokens(stack: Record<string, unknown> | undefined | null): FilterTokenFinding[] {
  if (!stack || typeof stack !== 'object') return [];
  const out: FilterTokenFinding[] = [];

  const judge = (scope: RecordScope) => ({ value, path, where }: AuthoredFilter): void => {
    walkFilterValues(value, path, where, scope, out, new Set());
  };

  // One surface at a time, in the declared order, so findings keep the order
  // one call over the whole list produced.
  for (const surface of TOKEN_FILTER_SURFACES) {
    if (surface.kind === 'page') {
      recordsOf(stack[surface.key]).forEach((page, i) => {
        scanForFilters(
          page,
          `${surface.key}[${i}]`,
          `${surface.kind} "${itemLabel(page, i)}"`,
          judge(pageRecordScope(page)),
        );
      });
      continue;
    }
    walkAuthoredFilters(
      stack,
      [surface],
      judge({ recordInContext: false, surface: surface.noun }),
    );
  }

  return out;
}
