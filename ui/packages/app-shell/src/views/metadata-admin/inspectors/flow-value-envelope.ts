// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-value-envelope — the `value`-role slot of a flow node's config map
 * (objectui#7588, the Studio half of objectstack#14149 ruling A).
 *
 * The `assignment` node's `assignments` map takes two authoring forms per
 * value: a plain string, and a CEL value envelope `{ dialect: 'cel', source }`,
 * which the expression engine evaluates, so the CEL stdlib (`joinNonEmpty`, …)
 * becomes authorable from metadata. The two are told apart by SHAPE, never by
 * a mode key: an object naming a `dialect` is an envelope, and everything else
 * is a literal. That is why a plain string is never rewritten into an envelope
 * here. Through `@objectstack/spec` 17 a plain string was `{token}` flow
 * interpolation; from 18 (ADR-0032 §3, objectui#12030) it is the literal text
 * it spells, and the spec refuses a `{…}` token in it with
 * `VALUE_SLOT_TEMPLATE_REFUSAL`, which the editor shows like any other refusal.
 *
 * Every decision below is read from `@objectstack/spec/automation`, never
 * restated:
 *
 * - WHICH slot takes an envelope: the expression ledger
 *   (`FLOW_NODE_EXPRESSION_PATHS`), whose `value`-role entries name a node
 *   type, the node block the path is rooted in (`config`, or a declared
 *   sibling block) and a `KEY.*` path. The key/value editor serves many other
 *   maps (an action's `params`, a request's `headers` …), where an object
 *   naming a `dialect` is just data, so the affordance is offered only where
 *   the ledger declares the role.
 * - WHAT is an envelope: `isExpressionEnvelopeShaped`, the predicate the
 *   ledger resolver and the executor both use.
 * - WHEN a value is refused: `AssignmentValueSchema`, whose issues lead with
 *   `ASSIGNMENT_VALUE_ENVELOPE_REFUSAL` for a malformed envelope and with
 *   `VALUE_SLOT_TEMPLATE_REFUSAL` for a `{…}` token in a string. The editor
 *   shows those messages verbatim beside the cell, so the author reads the
 *   same sentence `registerFlow` would refuse the flow with.
 * - The one dialect the slot evaluates: read off
 *   `AssignmentExpressionValueSchema`'s own `dialect` literal.
 *
 * The map is the only shape that reads an envelope as an expression. The
 * legacy `assignments: [{ variable, value }]` array is read-compatible but
 * undeclared, and an envelope-shaped object there is a literal
 * (`ASSIGNMENT_ARRAY_FORM_PRESCRIPTION` says so in the spec's own words).
 */

import {
  AssignmentExpressionValueSchema,
  AssignmentValueSchema,
  FLOW_NODE_EXPRESSION_PATHS,
  flowNodeExpressionBlock,
  isExpressionEnvelopeShaped,
  type AssignmentExpressionValue,
} from '@objectstack/spec/automation';

export { ASSIGNMENT_ARRAY_FORM_PRESCRIPTION } from '@objectstack/spec/automation';

/** The dialect a value envelope is evaluated in, as the spec declares it. */
const VALUE_DIALECT = AssignmentExpressionValueSchema.shape.dialect.value;

/**
 * A stored envelope the source editor can show and write back without loss:
 * the spec's own `dialect` / `source` members, any other key carried as is.
 */
export type ValueEnvelope = Pick<AssignmentExpressionValue, 'dialect' | 'source'> & Record<string, unknown>;

/**
 * Whether the field at `path` on a node of `nodeType` is a `value`-role map,
 * meaning its values may be CEL value envelopes.
 *
 * Only a `[BLOCK, KEY]` field can be one: a ledger path is a dot path into the
 * node block its entry is rooted in (`flowNodeExpressionBlock` — `config`, or
 * a declared sibling block such as a `connector_action` node's
 * `connectorConfig`), and a value-role map is written as `KEY.*`. The block is
 * part of the answer: `['config', 'input']` on a `connector_action` node is
 * not its input map, which lives at `['connectorConfig', 'input']`.
 */
export function isValueEnvelopeSlot(nodeType: unknown, path: readonly string[]): boolean {
  if (typeof nodeType !== 'string' || path.length !== 2) return false;
  const [block, key] = path;
  const ledgerPath = `${key}.*`;
  return FLOW_NODE_EXPRESSION_PATHS.some(
    (entry) =>
      entry.nodeType === nodeType &&
      entry.role === 'value' &&
      entry.path === ledgerPath &&
      flowNodeExpressionBlock(entry) === block,
  );
}

/**
 * Whether `value` is an envelope in the slot's own dialect with a string
 * `source`: the envelopes the text/expression toggle edits as source text.
 *
 * Any other envelope-shaped value (another dialect, no `source`) stays in the
 * text cell as its JSON, with the spec's refusal under it. Loading one into
 * the source editor would rewrite its dialect on the next save, silently.
 */
export function isEditableValueEnvelope(value: unknown): value is ValueEnvelope {
  return (
    isExpressionEnvelopeShaped(value) &&
    (value as { dialect: unknown }).dialect === VALUE_DIALECT &&
    typeof (value as { source?: unknown }).source === 'string'
  );
}

/**
 * The envelope an expression cell stores for `source`.
 *
 * With a prior envelope, `source` is the only key that changes, following the
 * write table objectui#3218 ruled for expression envelopes: `meta` survives the
 * edit, `ast` is dropped because it was compiled from the OLD source, and an
 * unedited `source` hands the prior object back unchanged.
 */
export function writeValueEnvelope(prior: unknown, source: string): Record<string, unknown> {
  if (isEditableValueEnvelope(prior)) {
    if (prior.source === source) return prior;
    const next: Record<string, unknown> = { ...prior, source };
    delete next.ast;
    return next;
  }
  return { dialect: VALUE_DIALECT, source };
}

/**
 * The spec's refusal of `value` as a slot value, one message per issue, or
 * `null` when the spec accepts it. A malformed envelope is refused, and from
 * `@objectstack/spec` 18 so is a string carrying a `{…}` token; any other
 * literal answers `null`.
 */
export function valueEnvelopeRefusal(value: unknown): string[] | null {
  const result = AssignmentValueSchema.safeParse(value);
  return result.success ? null : result.error.issues.map((issue) => issue.message);
}

/**
 * The spec's refusal of an expression left blank, read once from the spec's
 * own judge rather than restated: the messages {@link valueEnvelopeRefusal}
 * gives an envelope in the slot's dialect whose `source` is empty.
 */
const BLANK_EXPRESSION_REFUSALS: ReadonlySet<string> = new Set(
  valueEnvelopeRefusal({ dialect: VALUE_DIALECT, source: '' }) ?? [],
);

/**
 * Whether `message` is the spec's refusal of a blank expression in a value
 * slot, so an editor can say it in business words. The node's value cell and
 * the flow's Problems list both ask this of the one verdict they show (the
 * cell's live spec parse, the publish verdict the draft read serves), so the
 * two say the same thing.
 */
export function isBlankExpressionRefusal(message: string): boolean {
  return BLANK_EXPRESSION_REFUSALS.has(message);
}
