/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { isConfigBag } from './configBag.js';
import { isInlineLocaleMap, mapLocaleMapMembers } from './localeMap.js';
import { PARAMS_KEY, isParamsBag, mapParamsLeaves } from './paramsBag.js';

/**
 * Dev-build diagnostic: an UNEVALUATED template expression reached the DOM.
 *
 * ## The defect this names (objectui#4795, Direction 3)
 *
 * A value only reaches the user if it passes two gates: `SchemaRenderer`
 * must EVALUATE it, and the renderer must READ IT BACK. Those two sets do not
 * fully overlap, and where they miss, the failure is SILENT — measured on a
 * real render with `dataSource: { total: 99 }`:
 *
 *   { type: 'ui:statistic', value: '${data.n}' }            -> screen shows
 *                                                              `${data.n}`
 *   { type: 'ui:card', props: { title: '${data.total}' } }  -> card body EMPTY
 *                                                              (the evaluated
 *                                                              `99` landed on a
 *                                                              DOM attribute)
 *
 * The first shape is what this module catches: the memo in `SchemaRenderer`
 * evaluates `content`, the `properties` / `props` bags and the predicate keys,
 * and passes every other top-level key through untouched — so the raw source
 * text is what the renderer receives, and it is placed verbatim. An author
 * (increasingly, an AI authoring metadata) gets no signal at all: a literal
 * `${data.n}` on screen reads like a data problem, not a contract violation.
 *
 * The second shape this module also catches, in its residue form: when an
 * expression IS evaluated but the evaluation THROWS, `ExpressionEvaluator`
 * returns the original source verbatim (`return match` in its interpolation
 * branch, `defaultValue ?? expression` in its outer catch), so a failed
 * evaluation is indistinguishable on screen from a key that was never
 * evaluated at all. Both end as raw `${…}` in front of a user.
 *
 * ## What this deliberately does NOT do
 *
 * It changes NO evaluation behaviour — it reads the schema after the memo has
 * run and reports. Widening the set of evaluated keys is objectui#4795's
 * Direction 1, which the maintainer DEFERRED behind a named restart condition
 * (ruling of 2026-08-17); this diagnostic is Direction 3 and must not
 * pre-empt it. Merging `props` into the node (Direction 2) is permanently
 * rejected.
 *
 * ## Depth: exactly the evaluator's own radius, and not one level more
 *
 * The scan is SHALLOW because evaluation is shallow. `ExpressionEvaluator`
 * returns every non-string untouched, so a nested `aria: { label: '${…}' }`
 * under either bag keeps its raw source today — deliberately, and pinned as
 * such by objectui#4799's parity tests. A deeper scan would therefore report,
 * as a defect, a shape the repo has explicitly decided not to change yet: the
 * diagnostic would be louder than the contract it speaks for. Deepening
 * evaluation is a separate decision, and this scan follows it the day it is
 * taken, not before.
 *
 * That decision has been taken for exactly ONE key: `params` (objectui#7867,
 * ruling A). Every string leaf of a `params` bag is evaluated, at any depth,
 * on every channel — so this scan walks the same leaves, through the same
 * walker (`paramsBag.ts`, which the evaluation memo also uses), and a template
 * that still cannot resolve is reported by its path (`params.target.id`,
 * `properties.params.ids[0]`). Radius equal to evaluation by construction,
 * not by two copies agreeing; every other key stays shallow on both sides.
 *
 * And for exactly ONE value shape, one level deep: an inline locale map
 * (objectui#12936). Each member is evaluated like a plain string on the same
 * key, so each member is scanned like one, through the same recogniser and
 * walker (`localeMap.ts`), and a member whose expression threw is reported by
 * its locale (`properties.title.zh-CN`). Any other object stays unscanned, as
 * it stays unevaluated.
 */

/** What counts as an expression — the evaluator's own definition. */
const EXPRESSION_PATTERN = /\$\{([^}]+)\}/g;

/**
 * Mirrors `ExpressionEvaluator.evaluate`: a `${` with no closing brace, or an
 * empty `${}`, is not an expression to the evaluator (its interpolation regex
 * requires at least one character), so it is not one here either. Matching the
 * PRODUCER's definition is what keeps this from reporting strings the engine
 * never intended to touch — prose and code samples that merely contain `${`.
 */
export function findExpressionSources(value: string): string[] {
  const found: string[] = [];
  // `matchAll` needs the /g flag and a fresh lastIndex per call; the literal
  // above is module-scope, so reset before use rather than allocating a regex
  // per value (this runs per key, per node, per render, in dev).
  EXPRESSION_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = EXPRESSION_PATTERN.exec(value);
  while (match !== null) {
    found.push(match[0]);
    match = EXPRESSION_PATTERN.exec(value);
  }
  return found;
}

/** Which authored channel a residual expression was found on. */
export type UnevaluatedChannel = 'schema' | 'properties' | 'props';

export interface UnevaluatedExpressionFinding {
  /**
   * The key holding the raw source — or, for a leaf of a `params` bag, that
   * leaf's path from the bag (`params.target.id`, `params.ids[0]`), or, for a
   * member of an inline locale map, the key and the member's locale
   * (`title.zh-CN`).
   */
  key: string;
  /** The authored channel the key was read from. */
  channel: UnevaluatedChannel;
  /** The value, verbatim, as it will be handed to the renderer. */
  value: string;
  /** The `${…}` fragments inside it. */
  expressions: string[];
}

function pushIfUnevaluated(
  key: string,
  channel: UnevaluatedChannel,
  value: string,
  into: UnevaluatedExpressionFinding[]
): void {
  const expressions = findExpressionSources(value);
  if (expressions.length > 0) {
    into.push({ key, channel, value, expressions });
  }
}

function scanBag(
  bag: unknown,
  channel: UnevaluatedChannel,
  into: UnevaluatedExpressionFinding[],
  skip?: (key: string, value: unknown) => boolean
): void {
  if (!isConfigBag(bag)) return;
  for (const [key, value] of Object.entries(bag)) {
    if (skip?.(key, value)) continue;
    // objectui#7867 — `params` is evaluated leaf-deep, so it is scanned
    // leaf-deep, by the evaluator's own walker; the finding's `key` is the
    // leaf's path (`params.target.id`). The visitor hands every leaf back
    // unchanged, so the walk allocates nothing.
    if (key === PARAMS_KEY && isParamsBag(value)) {
      mapParamsLeaves(value, (leaf, path) => {
        pushIfUnevaluated(path, channel, leaf, into);
        return leaf;
      });
      continue;
    }
    // objectui#12936 — an inline locale map's members are evaluated like plain
    // strings, so they are scanned like them, through the evaluator's own
    // recogniser and walker. The visitor returns each member unchanged.
    if (isInlineLocaleMap(value)) {
      mapLocaleMapMembers(value, (member, locale) => {
        pushIfUnevaluated(key + '.' + locale, channel, member, into);
        return member;
      });
      continue;
    }
    if (typeof value !== 'string') continue;
    pushIfUnevaluated(key, channel, value, into);
  }
}

/**
 * Collect every unevaluated `${…}` that is about to be handed to a renderer.
 *
 * Pure and side-effect free — the reporting half is {@link reportUnevaluatedExpressions}.
 * Kept separate so the scan can be asserted directly: a diagnostic whose only
 * test is "a spy was called" goes green the moment someone no-ops it.
 *
 * @param spread  The post-strip top-level bag — exactly what `SchemaRenderer`
 *   spreads as React props, which is also what renderers read as `schema.<key>`.
 *   Schema METADATA (`visible` / `hidden` / `disabled` / … ) must already be
 *   removed by the caller: those keys carry raw predicate source BY DESIGN and
 *   are evaluated as conditions, never placed.
 * @param properties  The node's `properties` bag, if any. Reported in
 *   preference to the top-level copy the hoist makes of it, so the finding
 *   names the key the author actually wrote.
 * @param props  The node's legacy `props` bag, if any.
 */
export function collectUnevaluatedExpressions(
  spread: Record<string, unknown> | undefined | null,
  properties?: unknown,
  props?: unknown
): UnevaluatedExpressionFinding[] {
  const findings: UnevaluatedExpressionFinding[] = [];

  scanBag(properties, 'properties', findings);

  // The hoist copies every `properties.*` value onto the node's top level, so
  // the same residue is visible twice. Report the authored spelling only.
  const hoisted = isConfigBag(properties) ? properties : undefined;
  scanBag(spread, 'schema', findings, (key, value) => hoisted?.[key] === value);

  scanBag(props, 'props', findings);

  return findings;
}

/**
 * Prefix every diagnostic line starts with. Exported so tests can match on it
 * and so an app can filter it out of its console transport if it must.
 */
export const UNEVALUATED_EXPRESSION_PREFIX =
  '[ObjectUI] Unevaluated expression reached the DOM';

/** Where a finding sits, spelled the way an author would search for it. */
function locate(finding: UnevaluatedExpressionFinding): string {
  switch (finding.channel) {
    case 'properties':
      return 'properties.' + finding.key;
    case 'props':
      return 'props.' + finding.key;
    default:
      return finding.key;
  }
}

/**
 * Build the message. Separate from the emit so a test can assert the words a
 * developer is going to read, not merely that something was logged.
 *
 * ## Why `properties.*` is in the channel list (objectui#7849)
 *
 * It was missing, and the omission CONTRADICTED the sibling diagnostic in
 * `propsBagDiagnostic.ts`, which tells an author who wrote the same key one
 * envelope out: *"`props` is NOT hoisted onto the node — only `properties.*`
 * is … Write them under `properties` instead."* An author whose node trips
 * both messages was told to use `properties` by one and, by the other, that
 * the only channels that work are `content` or host-side resolution.
 *
 * The enumeration was the wrong half. `properties` is not a channel on its way
 * out and there is no retirement on record for it: `@objectstack/spec@17.2.0`
 * calls the vocabulary carried there *"ALIVE — this is not dead surface to
 * retire under ADR-0049"*, keeps `PageComponentSchema.properties` as the open
 * carrier ON PURPOSE, gates it at the authoring door
 * (`validate-component-props.ts`), and tombstones no part of it via
 * `retiredKey()`. In THIS repo `props` — not `properties` — is the spelling
 * annotated as the legacy alias (`SchemaRenderer.tsx`: "the legacy `props`
 * bag, minus every key the canonical `properties` bag also …").
 *
 * Measured on this branch's base through the real renderers, not inferred:
 * `badge` with `properties.label = '${data.status}'` renders `completed` and
 * applies the variant classes; `card` with a conditional
 * `properties.className` renders `class="… border-red-500"`; the same keys
 * under `props` render an EMPTY badge body and no `border-red-500`.
 *
 * The words are borrowed from the sibling message on purpose — one hoist, one
 * vocabulary, so the two diagnostics cannot drift apart again. Pinned by
 * `__tests__/diagnosticChannelConsistency.test.ts`.
 *
 * ## Why `params` is in it too (objectui#7867)
 *
 * The same defect #7849 closed, one channel later: once every string leaf of a
 * `params` bag evaluates, an enumeration that left `params` out would tell an
 * author whose `params.recordId` template THREW that `params` is not a channel
 * at all — and send them to move a correct key somewhere else. A finding on a
 * `params` leaf means the second sentence above (the expression threw, or the
 * value it produced still reads as a template), never the first.
 */
export function formatUnevaluatedExpressionMessage(
  type: unknown,
  id: unknown,
  findings: UnevaluatedExpressionFinding[]
): string {
  const node = typeof type === 'string' && type ? '"' + type + '"' : '(untyped node)';
  const where = typeof id === 'string' && id ? ' (id: "' + id + '")' : '';
  const lines = findings.map(f => {
    const site = locate(f);
    return (
      '  - ' + site + ': ' + JSON.stringify(f.value) +
      '  [' + f.expressions.join(', ') + ']'
    );
  });
  return (
    UNEVALUATED_EXPRESSION_PREFIX + ' - node ' + node + where + '\n' +
    lines.join('\n') + '\n' +
    'The value above is placed VERBATIM: it is handed to the renderer, and spread\n' +
    'to the DOM, with its source text intact. Either SchemaRenderer does not\n' +
    'evaluate this key, or the expression threw and the evaluator returned the\n' +
    'source unchanged.\n' +
    'Channels that do evaluate and read back today: `content`; `properties.*`,\n' +
    'which is evaluated and then HOISTED onto the node, so a renderer declared\n' +
    'as `({ schema })` reads it back as `schema.<key>`; every string leaf of a\n' +
    '`params` bag, at any depth, node-level or under `properties`; or resolve\n' +
    'the value in the host before handing the schema to SchemaRenderer.'
  );
}

/**
 * Reported nodes, so a re-render (or the post-mount forceUpdate that picks up
 * lazy plugin registrations) does not repeat the message. Keyed on the ORIGINAL
 * schema object, matching `validateSchemaOnce`'s dedup: the evaluated copy is a
 * fresh object on every memo recompute and would dedup nothing.
 */
const _reportedNodes: WeakSet<object> =
  typeof WeakSet !== 'undefined'
    ? new WeakSet()
    : ({ add() {}, has() { return false; } } as unknown as WeakSet<object>);

/**
 * Dev-build only. Scans, and on a hit reports once per schema object via
 * `console.error`.
 *
 * `console.error` and not `warn`: this is the loud refusal objectui#4795's
 * ruling asked for, and it follows the assertion shape objectui#5092 landed in
 * SchemaForm. (It is also the level that survives happy-dom, which swallows
 * `console.log`.)
 *
 * The caller applies the production gate, so this stays a single dev-only
 * branch at the call site and the whole module is dead code in a production
 * build.
 */
export function reportUnevaluatedExpressions(
  schema: object | null | undefined,
  type: unknown,
  id: unknown,
  spread: Record<string, unknown> | undefined | null,
  properties?: unknown,
  props?: unknown
): UnevaluatedExpressionFinding[] {
  const findings = collectUnevaluatedExpressions(spread, properties, props);
  if (findings.length === 0) return findings;
  if (schema && typeof schema === 'object') {
    if (_reportedNodes.has(schema)) return findings;
    _reportedNodes.add(schema);
  }
  console.error(formatUnevaluatedExpressionMessage(type, id, findings));
  return findings;
}
