/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Where an action NODE's static execution values come from (objectui#10289).
 *
 * An action's `params` has exactly one meaning: the `ActionParam[]` list of
 * inputs to collect from the user before the action runs. That is what
 * `UIActionSchema.params` declares ("always an `ActionParam[]`"), and what
 * `@objectstack/spec` 17.4.0's `ActionSchema.params` declares while refusing
 * the object form by name. The SDUI node envelope (`PageComponentSchema`)
 * declares no node-level `params` key at all.
 *
 * Static values a handler reads (`navigate_edit`'s `objectName` / `recordId`,
 * say) therefore ride the node's already-declared config bag, as
 * `properties.params`. `SchemaRenderer` template-evaluates every string leaf
 * of that bag (objectui#10282), so `"recordId": "${record.id}"` resolves on a
 * record page. An `action:bar` member reaches `action:button` /
 * `action:icon` without passing through `SchemaRenderer`, so the bar evaluates
 * its `properties` with the same rule and scope (`useConfigBagEvaluator`,
 * objectui#10290).
 *
 * An `action:group` / `action:menu` member has no such bag. The spec's member
 * prescription: "A member carries no `properties` bag: its static parameter
 * values (`properties.params`) are not part of the inline action vocabulary."
 * An action that needs static values is authored as its own `action:button`
 * node, and neither container reads a member's `properties` (objectui#11638).
 *
 * The maintainer's ruling on objectui#10289 (letter A, 2026-09-25): `params`
 * never carries two shapes, and no new value-bag key is declared. So an OBJECT
 * written at node level under `params` — the shape the record-edit guide used
 * to teach — is not read as values. It is ignored, and a development build
 * says so once per action, naming `properties.params` as the home (AGENTS.md
 * #0.1: one strict contract; the renderer does not make off-contract metadata
 * work).
 *
 * Why the renderer reads `schema.properties.params` itself instead of the
 * hoisted `schema.params`: `SchemaRenderer` copies every `properties.*` value
 * onto the node, so after the hoist `schema.params` could be either spelling.
 * `action:bar` mounts its members without `SchemaRenderer` (no hoist at all).
 * Reading the bag directly answers the same on both paths, and the identity
 * check below tells a hoisted copy (same object) from a node-level object.
 */

import { isConfigBag } from '@object-ui/react';

/** The two keys this module reads off an action node. */
export interface StaticParamsSubject {
  params?: unknown;
  properties?: unknown;
  name?: unknown;
  label?: unknown;
}

// Warn once per action, not once per click: the same node is clicked
// repeatedly, and a warning that floods the console is one that gets muted.
const warned = new Set<string>();

/** Reset the warn-once memo. Exported for tests. */
export function resetStaticParamsWarnings(): void {
  warned.clear();
}

function warnNodeLevelObjectParams(subject: StaticParamsSubject, where: string): void {
  if (process.env.NODE_ENV === 'production') return;
  const name = String(subject.name ?? subject.label ?? '(unnamed)');
  const memo = `${where}:${name}`;
  if (warned.has(memo)) return;
  warned.add(memo);
  console.warn(
    `[${where}] action "${name}" carries an OBJECT under node-level \`params\`; it is ignored. ` +
      '`params` is only the `ActionParam[]` list of inputs to collect from the user. ' +
      'Put static execution values under `properties.params` instead ' +
      '(for a `type: "api"` request payload, use `bodyExtra`). See objectui#10289.',
  );
}

/** The subject's `properties.params` when it is an object bag, otherwise `undefined`. */
function propertiesParams(subject: StaticParamsSubject): Record<string, unknown> | undefined {
  const properties = subject.properties;
  return isConfigBag(properties) && isConfigBag(properties.params)
    ? (properties.params as Record<string, unknown>)
    : undefined;
}

/**
 * The static values to forward as the runner's `ActionDef.params`: the node's
 * `properties.params` when it is an object bag, otherwise `undefined`.
 *
 * A node-level OBJECT `params` that is not the hoisted `properties.params` is
 * never returned; it triggers the development warning above.
 */
export function readStaticParamValues(
  subject: StaticParamsSubject,
  where: string,
): Record<string, unknown> | undefined {
  const values = propertiesParams(subject);
  const nodeLevel = subject.params;
  if (isConfigBag(nodeLevel) && nodeLevel !== values) {
    warnNodeLevelObjectParams(subject, where);
  }
  return values;
}

/**
 * Evaluates a config bag the way `SchemaRenderer` evaluates `properties`: the
 * function `useConfigBagEvaluator()` (`@object-ui/react`) returns.
 */
export type ConfigBagEvaluator = (bag: unknown) => unknown;

/**
 * An `action:bar` member with its `properties` evaluated (objectui#10290).
 *
 * `action:bar` mounts its inline members on `action:button` / `action:icon`
 * itself, so a member never passes through the `SchemaRenderer` memo that
 * evaluates a node's `properties`. The renderer it lands on reads the static
 * values off `properties.params` ({@link readStaticParamValues},
 * objectui#10289), and they are templates (objectui#7867): on a record page,
 * `"recordId": "${record.id}"` has to reach the handler as the record's id. The
 * bar evaluates the member's `properties` with the memo's own evaluator and
 * scope (`evaluateBag`, from `useConfigBagEvaluator()`), once, where it
 * composes the member.
 *
 * Returns the member itself when it carries no `properties` bag. Only
 * `properties` is evaluated. It is not copied onto the member (the memo's
 * hoist), and the member's other keys are left as authored.
 *
 * `action:group` and `action:menu` do not call this: their members carry no
 * `properties` bag (objectui#11638).
 */
export function withEvaluatedProperties<T extends object>(
  member: T,
  evaluateBag: ConfigBagEvaluator,
): T {
  const properties = (member as { properties?: unknown }).properties;
  return isConfigBag(properties) ? { ...member, properties: evaluateBag(properties) } : member;
}

/**
 * The same ruling on a spec ACTION ENTRY (objectui#10462): `element:button`'s
 * inline `action`, `action:group` / `action:menu` items and `page:header`'s
 * actions. `params` is an entry's `ActionParam[]` input list and nothing else.
 * (No entry surface reads a `properties.params` bag. `UIActionSchema` declares
 * no `properties`, and the spec refuses one on an `action:group` /
 * `action:menu` member: its static parameter values are not part of the inline
 * action vocabulary, and an action that needs them is its own `action:button`
 * node (objectui#11638).)
 *
 * One type is still different: `api`. The objectstack#5777 window keeps the
 * runner reading an object `params` as the request payload (with its own
 * development warning, naming `bodyExtra`) until 18, so for `api` the object is
 * returned unchanged. For every other type it is not returned, and a
 * development build says so once per action.
 *
 * `type` is the executor the surface dispatches the entry as. Call this on the
 * non-array branch only; an array `params` is the input list, forwarded as
 * `actionParams`.
 */
export function readActionEntryParamValues(
  entry: StaticParamsSubject,
  type: unknown,
  where: string,
): Record<string, unknown> | undefined {
  const params = entry.params;
  if (params == null || Array.isArray(params)) return undefined;
  // objectstack#5777: unchanged for `api` until the window closes at 18.
  if (type === 'api') return params as Record<string, unknown>;
  if (isConfigBag(params)) warnEntryObjectParams(entry, type, where);
  return undefined;
}

function warnEntryObjectParams(entry: StaticParamsSubject, type: unknown, where: string): void {
  if (process.env.NODE_ENV === 'production') return;
  const name = String(entry.name ?? entry.label ?? '(unnamed)');
  const memo = `entry:${where}:${name}`;
  if (warned.has(memo)) return;
  warned.add(memo);
  console.warn(
    `[${where}] action "${name}" (type "${String(type)}") carries an OBJECT under \`params\`; ` +
      'it is not forwarded. `params` is only the `ActionParam[]` list of inputs to collect ' +
      'from the user. Only a `type: "api"` action still reads an object `params`, as its ' +
      'request payload, until 18 (use `bodyExtra`). See objectui#10462.',
  );
}
