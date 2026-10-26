/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  EXPRESSION_BINDABLE_TEXT_KEYS,
  expressionBindableTextKeysFor,
} from '@objectstack/spec/ui';
import { nodeSlotValues, nodeSlotsFor } from '@object-ui/types';

import { formatIssuePath } from './issue-path.js';
import { isKnownSchemaType } from './known-schema-types.js';

/**
 * `objectui check` refuses a `${…}` expression written into a text key that
 * `SchemaRenderer` never evaluates (objectui#4795, ruling item 2).
 *
 * ## The defect this refuses
 *
 * A value reaches the screen only when `SchemaRenderer` evaluates it AND the
 * renderer reads it back. For the four closed text keys — `title`, `label`,
 * `value`, `description` — the evaluation half is decided by one lookup:
 * `expressionBindableTextKeysFor(type)` from `@objectstack/spec`, which
 * `SchemaRenderer`'s evaluation memo consumes. A key the lookup does not list
 * for the node's type is passed through untouched, so `${data.total}` reaches
 * the user as those literal characters, or the node renders blank.
 *
 * The ruling (maintainer, 2026-08-31, on objectui#4795): reject a `${…}` in
 * any of the four keys on a component node whose lookup answer excludes that
 * key — types with no row included, since the empty set is the contract's
 * answer for them. Two sub-rules:
 *
 *   (i)  Component nodes only. The page document root's own `title` is a page
 *        key, not a component text key.
 *   (ii) A type no registered component answers to gets a WARNING, not a
 *        refusal: a custom renderer may evaluate its own keys.
 *
 * ## One lookup, called the way the runtime calls it
 *
 * The vocabulary and the carriage map are the spec's, IMPORTED here rather
 * than copied, so a row added upstream moves this gate and the runtime in the
 * same install. The type string is passed VERBATIM, because that is what the
 * evaluation memo in `SchemaRenderer` passes: no prefix stripping, so
 * `ui:card` answers the empty set exactly as it does at render time. Each half
 * is pinned against that verbatim lookup: the runtime's by the `@object-ui/react`
 * suite `SchemaRenderer.bindableTextKeys.test.tsx`, this gate's over every
 * registered type by `check-unbindable-text-expression-4795.test.ts`.
 *
 * ## What a component node is: the root, what `children` holds, and the
 * ## node slots the node's type declares
 *
 * `SchemaRenderer` does not recurse on its own. Each renderer decides which of
 * its keys it hands back to `SchemaRenderer`, and many keys that hold objects
 * with a string `type` are not nodes at all: a form's `fields[]` entries are
 * field definitions rendered by the form's field widgets, a grid's `columns[]`
 * entries are column definitions, and `{ "type": "multiple" }` can be a
 * selection mode. A walk over every object with a string `type` would refuse
 * `{ "type": "text", "label": "${…}" }` inside `fields[]` — a false refusal
 * on a key this gate has no business judging.
 *
 * So the walk follows two things and nothing else, from the document root:
 * the protocol's ONE composition key, `BaseSchema.children`, on every node;
 * and the NODE SLOTS declared for the node's type — `nodeSlotsFor(type)` in
 * `@object-ui/types` (objectui#11170), the one declaration of where a
 * renderer hands nodes back through a key of its own (`trigger`, `footer`, a
 * page's `regions[].components`, a tab's `items[].content`). The core
 * validator's recursive walk and the SDUI parser read the same declaration;
 * ⛔ this gate keeps no slot list of its own. The declaration's header says
 * what a slot is, how a position is spelled and which test holds each row
 * against the live renderer. A type with no row — an unknown or custom type
 * included — has its `children` walked and nothing else.
 *
 * ## What an expression is
 *
 * The evaluator's own interpolation pattern: a `${` closed by a `}` with at
 * least one character between them. A lone `${`, or an empty `${}`, is not an
 * expression to the evaluator, so it is not one here either.
 */

/** The evaluator's interpolation pattern, as `ExpressionEvaluator.evaluate` matches it. */
const EXPRESSION_PATTERN = /\$\{[^}]+\}/;

/**
 * The protocol's one composition key: `BaseSchema.children`. Walked on every
 * node; the per-type node slots beside it come from `nodeSlotsFor`.
 */
const COMPOSITION_KEY = 'children';

/**
 * The document-root type whose own text keys are page keys (sub-rule i). Its
 * `children` are still component nodes and are still walked.
 */
const PAGE_DOCUMENT_ROOT_TYPE = 'page';

/** One `${…}` sitting on a closed text key its node's type does not evaluate. */
export interface UnbindableTextExpression {
  /**
   * `refusal` when the type is a registered component; `warning` when no
   * registered component answers to it (sub-rule ii).
   */
  severity: 'refusal' | 'warning';
  /** From the document root to the key: `['children', 0, 'value']`. */
  path: readonly (string | number)[];
  /** The node's `type`, verbatim. */
  type: string;
  /** The closed text key holding the expression. */
  key: string;
  /** The keys of the four this type's node DOES evaluate: the lookup's answer. */
  evaluatedKeys: readonly string[];
}

type ComponentNode = Record<string, unknown> & { type: string };

function isComponentNode(value: unknown): value is ComponentNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function judge(
  node: ComponentNode,
  path: readonly (string | number)[],
  into: UnbindableTextExpression[],
): void {
  const evaluatedKeys: readonly string[] = expressionBindableTextKeysFor(node.type);
  for (const key of EXPRESSION_BINDABLE_TEXT_KEYS) {
    const value = node[key];
    if (typeof value !== 'string' || !EXPRESSION_PATTERN.test(value)) continue;
    if (evaluatedKeys.includes(key)) continue;
    into.push({
      severity: isKnownSchemaType(node.type) ? 'refusal' : 'warning',
      path: [...path, key],
      type: node.type,
      key,
      evaluatedKeys,
    });
  }
}

function visit(
  node: ComponentNode,
  path: readonly (string | number)[],
  isDocumentRoot: boolean,
  into: UnbindableTextExpression[],
): void {
  if (!(isDocumentRoot && node.type === PAGE_DOCUMENT_ROOT_TYPE)) {
    judge(node, path, into);
  }
  const children = node[COMPOSITION_KEY];
  if (Array.isArray(children)) {
    children.forEach((child, index) => {
      if (isComponentNode(child)) visit(child, [...path, COMPOSITION_KEY, index], false, into);
    });
  } else if (isComponentNode(children)) {
    visit(children, [...path, COMPOSITION_KEY], false, into);
  }
  // The node slots this type's renderer reads (objectui#11170): the same
  // declaration core's `validateChildren` and the SDUI parser walk. Retired
  // positions are walked too — the renderer still paints them, so a `${…}`
  // under one still reaches the user.
  for (const slot of nodeSlotsFor(node.type)) {
    for (const { segments, value } of nodeSlotValues(node, slot.path)) {
      if (isComponentNode(value)) visit(value, [...path, ...segments], false, into);
    }
  }
}

/**
 * Every `${…}` on one of the four closed text keys of a component node whose
 * type does not evaluate that key, in document order. `document` is a parsed
 * file `objectui check` has recognised as an ObjectUI schema.
 */
export function findUnbindableTextExpressions(document: unknown): UnbindableTextExpression[] {
  const found: UnbindableTextExpression[] = [];
  if (isComponentNode(document)) visit(document, [], true, found);
  return found;
}

const inCode = (key: string): string => '`' + key + '`';

/**
 * The line `check` prints for a finding, after the file name: the path spelled
 * as `objectui validate` spells it, the type, the key, and the keys this type
 * does evaluate.
 */
export function describeUnbindableTextExpression(finding: UnbindableTextExpression): string {
  const at = formatIssuePath(finding.path);
  if (finding.severity === 'warning') {
    return (
      `at ${at}: "${finding.type}" is not a registered component, so the expression on ` +
      `${inCode(finding.key)} is not refused; a custom renderer may evaluate it itself.`
    );
  }
  const evaluates =
    finding.evaluatedKeys.length > 0
      ? `it evaluates only ${finding.evaluatedKeys.map(inCode).join(', ')}`
      : `it evaluates none of ${EXPRESSION_BINDABLE_TEXT_KEYS.map(inCode).join(', ')}`;
  return (
    `at ${at}: "${finding.type}" never evaluates ${inCode(finding.key)} ` +
    `(${evaluates}), so the expression is never resolved: the user sees its ` +
    'literal text, or nothing.'
  );
}

/**
 * The channels a refused expression can move to: the keys this type evaluates,
 * then the channels the runtime's unevaluated-expression diagnostic names —
 * `content`, the `properties` bag (evaluated, then hoisted onto the node), and
 * resolving the value in the host. The line says these are EVALUATED; whether
 * a renderer reads a key back is the renderer's, and this gate cannot see it.
 */
export function workingChannels(finding: UnbindableTextExpression): string {
  const channels = [
    ...finding.evaluatedKeys.map(inCode),
    inCode('content'),
    `${inCode(`properties.${finding.key}`)} (evaluated, then hoisted onto the node)`,
  ];
  return (
    `Channels SchemaRenderer evaluates: ${channels.join(', ')}; ` +
    'or resolve the value in the host before the schema reaches SchemaRenderer.'
  );
}
