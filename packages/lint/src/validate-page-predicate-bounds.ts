// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Page component props predicates over the platform's CEL parse bounds (#24953).
 *
 * ## What this closes
 *
 * `@objectstack/formula`'s canonical front end states the platform contract
 * (`parseCelToAst`, `cel-engine.ts`): a source over `DEFAULT_LIMITS`
 * (`maxAstNodes` 256, `maxDepth`, `maxListElements`, …) "does not parse here,
 * because it does not parse anywhere else on the platform either". A predicate
 * that does not parse never evaluates, and the console fails OPEN on a
 * predicate fault — the gated element draws for everyone.
 *
 * The component NODE's own `visibleWhen` is already judged for this
 * (`visibility-predicate-over-budget`, an error, in
 * `validate-visibility-predicates.ts`). The CEL slots a component's props
 * schema declares INSIDE its `properties` bag were judged by nobody: a
 * `page:tabs` item `visibleWhen`, an `object-form` section / inline-field
 * `visibleWhen` / `readonlyWhen` / `requiredWhen`, an inline option's
 * `visibleWhen`, `record:alert` `visible`, the `visible` / `disabled` of the
 * `action:*` blocks and their members. Measured on `main` before this rule: a
 * `page:tabs` item `visibleWhen` of 98 `||` terms (489 AST nodes) parsed
 * through `PageSchema` and drew ZERO findings from `os validate`, `os build`
 * and the page publish door, while the same source on the component node drew
 * the over-budget error.
 *
 * ## Which strings are CEL — read off the props schema, not guessed
 *
 * Every one of those slots is `EvaluatedExpressionInputSchema` (directly, or
 * as the expression arm of a `boolean | expression` union), whose string arm
 * transforms to the `{ dialect: 'cel', source }` envelope. So the positions
 * are the ones where the component's `ComponentPropsMap` row, parsing the
 * authored bag, PRODUCES a CEL envelope — this rule keeps no list of key
 * names, and a slot a props row declares tomorrow is judged with no edit here.
 * A type with no props row, or a bag the row refuses, yields nothing: an
 * unregistered type is an open union by design (`validate-component-props.ts`
 * header), and a refused bag already draws `component-props-invalid` at the
 * same doors.
 *
 * Child components in the bag's composition slots (`children`, `footer`,
 * `items[].children`, from spec's `pageComponentSlotPositions()`) are NOT
 * descended here: `walkPageComponents` yields each of them as a component of
 * its own, so its node `visibleWhen` is the visibility family's and its own
 * bag is judged when the walk reaches it — descending here would report it
 * twice.
 *
 * ## The verdict is `validateExpression`'s
 *
 * Each source is handed to `validateExpression` (ADR-0032) and only its bounds
 * refusal (`cel-too-large`, with the bound's key and value) is reported. The
 * other refusal classes are not this rule's: they depend on the binding
 * environment, and a `page:tabs` item, for one, is evaluated in a different
 * environment from the component node (its row is `data`, and its bare fields
 * are spread), so a root or reference verdict borrowed from another surface
 * would be wrong here. The bounds verdict is environment-free — it is a fact
 * about the source's size. The finding does not echo the source (it is over
 * budget by definition, and `validateExpression`'s own `detail` quotes the
 * author's line); the `path` locates it.
 *
 * ## Why an error
 *
 * Such a source never gates what it was written to gate, at any door, so the
 * finding is a refusal: `os validate`, `os build` and `os lint` fail, and the
 * page publish door answers its structured 422 on the page's next save.
 * Stored pages keep loading and serving — the gate judges writes, never the
 * read path. The 18.x line first shipped this as a warning; under the amended
 * standing ruling for breaking narrowings (「甲」, record 6303865025: a
 * narrowing no ADR-0087 conversion can carry also ships now, as a BREAKING
 * minor) the refusal ships in 18.x too. No conversion carries it: a predicate
 * cannot be shrunk mechanically, so the author's fix is the hint below.
 */

import { validateExpression } from '@objectstack/formula';
import { ComponentPropsMap, pageComponentSlotPositions } from '@objectstack/spec/ui';

import { walkPageComponents, type AnyRec } from './page-walk.js';
import { recordsOf } from './object-graph.js';

/** A CEL slot inside a page component's `properties` that overruns a platform parse bound. */
export const PAGE_PREDICATE_OVER_BUDGET = 'page-predicate-over-budget';

export interface PagePredicateBoundsFinding {
  severity: 'error';
  rule: typeof PAGE_PREDICATE_OVER_BUDGET;
  /** e.g. `page "pipeline_home" · page:tabs`. */
  where: string;
  /** The slot itself, e.g. `pages[0].regions[0].components[0].properties.items[1].visibleWhen`. */
  path: string;
  message: string;
  hint: string;
}

/** A zod schema, as much of one as this file reads. */
interface PropsSchema {
  safeParse(value: unknown): { success: boolean; data?: unknown };
}

const PROPS_SCHEMAS = ComponentPropsMap as unknown as Record<string, PropsSchema>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The parsed form of every CEL slot: `EvaluatedExpressionInputSchema`'s output. */
function celSource(v: unknown): string | undefined {
  if (!isRec(v) || v.dialect !== 'cel' || typeof v.source !== 'string') return undefined;
  return v.source.trim() ? v.source : undefined;
}

/** A CEL slot found in a parsed props bag, with the key it is authored under. */
interface CelSlot {
  /** Path relative to the bag, e.g. `.items[1].visibleWhen`. */
  rel: string;
  /** The key the source sits under, e.g. `visibleWhen`. */
  key: string;
  source: string;
}

/**
 * Every CEL envelope in a parsed props bag, depth-first, skipping the
 * composition slots (see the module header). Cycle-safe on an ANCESTOR set for
 * the reason `walkPageComponents` gives: an open `z.unknown()` member passes
 * authored references through the parse, and a self-containing value is legal
 * input.
 */
function celSlots(bag: AnyRec): CelSlot[] {
  const slots = pageComponentSlotPositions().filter((position) => !position.retired);
  const direct = new Set(slots.filter((s) => s.panelKey === undefined).map((s) => s.key));
  const panels = new Map(slots.filter((s) => s.panelKey !== undefined).map((s) => [s.key, s.panelKey!]));

  const out: CelSlot[] = [];
  const ancestors = new Set<unknown>();
  const visit = (node: unknown, rel: string, key: string, panelKey?: string): void => {
    const source = celSource(node);
    if (source !== undefined) {
      out.push({ rel, key, source });
      return;
    }
    if (!node || typeof node !== 'object' || ancestors.has(node)) return;
    ancestors.add(node);
    try {
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) visit(node[i], `${rel}[${i}]`, key, panelKey);
        return;
      }
      for (const [k, v] of Object.entries(node)) {
        // A panel entry's child list (`items[].children`) is the walk's.
        if (panelKey !== undefined && k === panelKey) continue;
        visit(v, `${rel}.${k}`, k);
      }
    } finally {
      ancestors.delete(node);
    }
  };

  for (const [k, v] of Object.entries(bag)) {
    if (direct.has(k)) continue;
    const panelKey = panels.get(k);
    if (panelKey !== undefined && Array.isArray(v)) {
      ancestors.add(v);
      for (let i = 0; i < v.length; i++) visit(v[i], `.${k}[${i}]`, k, panelKey);
      ancestors.delete(v);
      continue;
    }
    visit(v, `.${k}`, k);
  }
  return out;
}

/** `validateExpression`'s bounds verdict on one source, or `null` when it gives none. */
function boundsVerdict(source: string): { limit?: string; limitValue?: number } | null {
  const result = validateExpression('predicate', { dialect: 'cel', source });
  for (const error of result.errors) {
    if (error.code !== 'cel-too-large') continue;
    const { limit, limitValue } = error.params as { limit?: string; limitValue?: number };
    return { limit, limitValue };
  }
  return null;
}

/** Report every CEL slot in a page component's props that overruns a `DEFAULT_LIMITS` bound. */
export function validatePagePredicateBounds(stack: AnyRec): PagePredicateBoundsFinding[] {
  const findings: PagePredicateBoundsFinding[] = [];
  if (!isRec(stack)) return findings;

  const pages = recordsOf(stack.pages);
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (!isRec(page)) continue;
    const pageName = typeof page.name === 'string' && page.name ? page.name : `pages[${pi}]`;

    for (const { component, path } of walkPageComponents(page, `pages[${pi}]`)) {
      const type = typeof component.type === 'string' ? component.type : undefined;
      if (!type || !isRec(component.properties)) continue;
      const schema = PROPS_SCHEMAS[type];
      if (!schema) continue;
      const parsed = schema.safeParse(component.properties);
      if (!parsed.success || !isRec(parsed.data)) continue;

      for (const slot of celSlots(parsed.data)) {
        const verdict = boundsVerdict(slot.source);
        if (!verdict) continue;
        const bound = verdict.limit && verdict.limitValue !== undefined
          ? `the \`${verdict.limit}\` budget (platform limit ${verdict.limitValue})`
          : "one of the platform's CEL parse budgets";
        findings.push({
          severity: 'error',
          rule: PAGE_PREDICATE_OVER_BUDGET,
          where: `page "${pageName}" · ${type}`,
          path: `${path}.properties${slot.rel}`,
          message:
            `\`${slot.key}\` is valid CEL that exceeds ${bound}, so it does not parse anywhere on the ` +
            'platform: it faults on every evaluation and never gates what it was written to gate.',
          hint:
            "Make the expression smaller: collapse an `||` chain into one `in ['a', 'b', …]` test, or " +
            'precompute the heavy part into a formula or roll-up field on the object and test that one field',
        });
      }
    }
  }
  return findings;
}
