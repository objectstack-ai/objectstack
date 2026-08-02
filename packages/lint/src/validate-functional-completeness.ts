// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0078 Phase 1] The functional-completeness gate — `validate-functional-
// completeness`, the validator the ADR names and, until now, the one it said
// did not exist.
//
// A pure `(stack) => Finding[]` rule (ADR-0019). All judgement lives in the
// SHARED predicate — `@objectstack/spec/kernel`'s `checkFieldCompleteness` /
// `checkViewCompleteness`, the sibling of `isIncoherentAggregate` that cloud
// graph-lint is meant to re-home onto — so this file is only the walk: where
// fields and list views live in a stack, and how a predicate finding becomes a
// lint finding with a location. If a rule seems wrong, fix the predicate (and
// its runtime citation), never this walk.
//
// Why this closes a real hole: instance-completeness checks existed only in
// cloud's AI-build graph-lint, so a stack authored via `os` + a coding
// assistant, an MCP agent, `os validate` in CI, or a hand author got NONE of
// them (`formula_without_expression` existed nowhere in the framework). One
// predicate, every surface — the ADR's core decision.
//
// Runs on the NORMALIZED (pre-parse) stack like validate-list-view-mode: the
// findings must reach the author even when an unrelated schema error would
// stop the parse, and nothing here depends on parse-time defaults.

import {
  checkFieldCompleteness,
  checkViewCompleteness,
  checkWebhookCompleteness,
  type CompletenessFinding,
} from '@objectstack/spec/kernel';

export type FunctionalCompletenessSeverity = 'error' | 'warning';

export interface FunctionalCompletenessFinding {
  severity: FunctionalCompletenessSeverity;
  /** Stable rule id from the shared predicate (e.g. `field/summary-without-operations`). */
  rule: string;
  /** Human-readable location, e.g. `object "order" › fields.total`. */
  where: string;
  /** Config path, e.g. `objects[2].fields.total.summaryOperations`. */
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Array-or-name-keyed-map collection → entries with a name and an index label. */
function entriesOf(v: unknown): Array<{ name: string; def: AnyRec; key: string }> {
  if (Array.isArray(v)) {
    return v.flatMap((def, i) =>
      isRec(def) ? [{ name: String(def.name ?? i), def, key: `[${i}]` }] : [],
    );
  }
  if (isRec(v)) {
    return Object.entries(v).flatMap(([name, def]) =>
      isRec(def) ? [{ name, def: { name, ...def }, key: `.${name}` }] : [],
    );
  }
  return [];
}

function push(
  out: FunctionalCompletenessFinding[],
  found: CompletenessFinding[],
  where: string,
  basePath: string,
): void {
  for (const f of found) {
    out.push({
      severity: f.severity,
      rule: f.rule,
      where,
      path: `${basePath}.${f.path}`,
      message: f.message,
      hint: f.fix,
    });
  }
}

/**
 * Walk every field definition and every list-view definition in the stack
 * through the shared completeness predicate.
 */
export function validateFunctionalCompleteness(stack: unknown): FunctionalCompletenessFinding[] {
  const out: FunctionalCompletenessFinding[] = [];
  if (!isRec(stack)) return out;

  // ── Fields: objects[].fields (map or array) ─────────────────────────────
  for (const [oi, obj] of entriesOf(stack.objects).entries()) {
    for (const field of entriesOf(obj.def.fields)) {
      push(
        out,
        checkFieldCompleteness(field.def),
        `object "${obj.name}" › fields.${field.name}`,
        `objects[${oi}].fields${field.key}`,
      );
    }
  }

  // ── List views: views[] containers → list / listViews.* ────────────────
  // (Form views carry no layout-binding contract; field completeness inside
  // objects is already covered above.)
  for (const [vi, container] of entriesOf(stack.views).entries()) {
    const where = container.def.object ? `view container "${container.name}"` : `view container [${vi}]`;
    if (isRec(container.def.list)) {
      push(out, checkViewCompleteness(container.def.list), `${where} › list`, `views[${vi}].list`);
    }
    for (const lv of entriesOf(container.def.listViews)) {
      push(
        out,
        checkViewCompleteness(lv.def),
        `${where} › listViews.${lv.name}`,
        `views[${vi}].listViews${lv.key}`,
      );
    }
  }

  // ── Webhooks: stack.webhooks[] ─────────────────────────────────────────
  // [ADR-0078 Phase 3] The one Tier-B candidate that survived its verification
  // pass. A webhook materializes into `sys_webhook` and looks armed in Setup
  // whether or not it declares a trigger, so the omission is invisible on every
  // surface an author can see.
  for (const hook of entriesOf(stack.webhooks)) {
    push(
      out,
      checkWebhookCompleteness(hook.def),
      `webhook "${hook.name}"`,
      `webhooks${hook.key}`,
    );
  }

  return out;
}
