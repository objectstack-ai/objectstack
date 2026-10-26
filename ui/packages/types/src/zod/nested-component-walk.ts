/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * NESTED COMPONENTS IN A PROPS BAG — found by the spec's walk, judged by the
 * node union (objectui#11223).
 *
 * ## The defect
 *
 * A `page:` container takes its child list in its props bag:
 * `properties.children` on `page:card` / `page:section` / `page:footer` /
 * `page:sidebar`, and `properties.items[].children` on `page:tabs` /
 * `page:accordion`. Their arms read the spec's `ComponentPropsMap` rows by
 * reference (`propsBag` in `./public-blocks.zod.ts`), and every one of those
 * slots is `z.array(z.unknown())` in the row. So `safeValidateSchema` and
 * `StrictAnyComponentSchema` (what `objectui validate` runs) never looked inside
 * a bag child list: a malformed nested block, or a nested `type` no arm
 * declares, parsed green, while the same child written in a node-level child
 * slot is judged by the node union at every depth (objectui#8344).
 *
 * ## The positions are the spec's, READ — ⛔ not a list written here
 *
 * `@objectstack/spec` exports ONE walk over page composition:
 * `walkAddressedPageComponents` (`@objectstack/spec/system`), which its own
 * contract names "THE one traversal" behind `translatePage` and the platform
 * CLI's i18n extractor, with the descent rule living "here and ONLY here".
 * {@link nestedComponentsOf} hands a node to that walk and reports what it
 * visited. Nothing in this module names a bag key: a position the spec's walk
 * gains is judged here the day the installed spec carries it, and
 * `../__tests__/nested-page-children-11223.test.ts` re-derives the walk's
 * positions from the installed spec on every run and fails if this module
 * stops judging one of them.
 *
 * The spec's `COMPONENT_CHILD_KEYS` / `mapComponentTree` (its conversions
 * walk) are module-private, and `@objectstack/lint`'s `walkPageComponents` is
 * not a dependency of this package, so neither is read. ⚠️ The three walks do
 * not agree on `page:card`'s `properties.footer` — a slot its row declares and
 * its renderer draws, which the lint walk descends and the exported walk
 * deliberately does not. This module follows the exported walk, so that slot
 * is not judged here yet; objectui#11223 records the disagreement for the spec
 * to settle, and the pin file holds the gap as a row that turns red the day
 * the walk descends it.
 *
 * ## How a visited component is located
 *
 * The walk hands its visitor the component, never a path. Its contract does
 * say what happens to the visitor's return value: it REPLACES the node in the
 * rebuilt tree the walk returns, at the node's own position, with the node's
 * rebuilt child lists re-attached under the same keys. So the visitor returns a
 * marker object, and a generic scan of the rebuilt tree reads each marker's
 * position back. The scan knows no key names either — it descends every own
 * enumerable member and stops at the first marker on each branch, so what it
 * reports is the node's DIRECT nested components; deeper ones are reached when
 * each of those is judged in turn by the same union.
 *
 * Entries the walk does not visit — a string, a number, `null`, an array — are
 * not components to it and are not reported here, as the spec's own contract
 * says of them ("pass through unvisited").
 *
 * ## The judgment, and why it is rebindable
 *
 * {@link nestedComponentJudgment} is a check for the node union: for each
 * nested component it runs the judge — the union itself — and re-issues the
 * judge's issues at the component's real path (`properties.children.0.…`). It
 * runs even when the node carries issues of its own, so an author sees both at
 * once, as a node-level child slot reports them.
 *
 * A check is a closure, and the strict authoring face copies checks as they
 * are, so a closure that consults the tolerant union would keep consulting it
 * on the strict face (the limit `../strict-authoring-face.ts` names). This one
 * is registered, and the strict walker re-points it at its OWN twin of the
 * judge through {@link rebindNestedComponentJudgment}: on the strict face a
 * nested component is judged strictly, unknown keys refused by name.
 */

import { walkAddressedPageComponents } from '@objectstack/spec/system';
import { z } from 'zod';

/** A component a node carries at one of the spec walk's positions. */
export interface NestedComponent {
  /** The component object, by reference — the value the walk visited. */
  component: Record<string, unknown>;
  /** Its path from the node, e.g. `['properties', 'children', 0]`. */
  path: readonly (string | number)[];
}

type SpecVisitor = Parameters<typeof walkAddressedPageComponents>[1];
type SpecComponent = Parameters<SpecVisitor>[0];

/** Marks a visitor's return value; module-private, so no authored value can carry it. */
const VISITED = Symbol('objectui.nestedComponentWalk.visited');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The components `node` carries DIRECTLY at the positions
 * `@objectstack/spec`'s `walkAddressedPageComponents` descends, each with its
 * path from `node`, in the walk's order.
 *
 * Direct only: a nested component's own nested components are its business,
 * reached by calling this again on it. The walk descends further than that in
 * one call, which costs a re-walk per level and changes nothing reported.
 */
export function nestedComponentsOf(node: unknown): NestedComponent[] {
  if (!isRecord(node)) return [];

  const visited: Record<string, unknown>[] = [];
  const { regions } = walkAddressedPageComponents(
    { regions: [{ components: [node as SpecComponent] }] },
    (component) => {
      visited.push(component as Record<string, unknown>);
      return { [VISITED]: visited.length - 1 } as unknown as SpecComponent;
    },
  );
  // The node itself is always the first visit; anything nested comes after it.
  if (visited.length < 2) return [];

  const found: NestedComponent[] = [];
  // Values the walk left in place (a cycle it refused to enter, an entry it
  // does not visit) are scanned for markers too; `onPath` keeps a cyclic one
  // from sending the scan round forever.
  const onPath = new Set<object>();
  const scan = (value: unknown, path: (string | number)[]): void => {
    if (value === null || typeof value !== 'object') return;
    if (path.length > 0 && VISITED in value) {
      const index = (value as { [VISITED]: number })[VISITED];
      found.push({ component: visited[index], path });
      return;
    }
    if (onPath.has(value)) return;
    onPath.add(value);
    try {
      if (Array.isArray(value)) value.forEach((entry, i) => scan(entry, [...path, i]));
      else for (const [key, entry] of Object.entries(value)) scan(entry, [...path, key]);
    } finally {
      onPath.delete(value);
    }
  };
  scan(regions?.[0]?.components?.[0], []);
  return found;
}

/** The judge each registered check consults, keyed by the check. */
const JUDGE_OF = new WeakMap<object, () => z.ZodType>();

/**
 * Components under judgment right now, across nested calls. A JSON document
 * cannot nest a component inside itself, but a JavaScript value can, and each
 * walk guards only its own descent — this stops the re-entry that would
 * otherwise recurse until the stack dies, where the spec's walk would stop.
 */
const underJudgment = new Set<object>();

/**
 * A check for a node schema: every component {@link nestedComponentsOf} finds
 * is parsed by `judge()`, and each issue it raises is re-issued at the
 * component's path from the node.
 *
 * `judge` is read at parse time, so it may name the schema this check is being
 * attached to.
 */
export function nestedComponentJudgment(judge: () => z.ZodType): z.core.$ZodCheck<unknown> {
  const check = z.superRefine<unknown>(
    (value, ctx) => {
      for (const { component, path } of nestedComponentsOf(value)) {
        if (underJudgment.has(component)) continue;
        underJudgment.add(component);
        try {
          const result = judge().safeParse(component);
          if (result.success) continue;
          for (const issue of result.error.issues) {
            ctx.addIssue({ ...issue, path: [...path, ...issue.path] } as Parameters<typeof ctx.addIssue>[0]);
          }
        } finally {
          underJudgment.delete(component);
        }
      }
    },
    // Judged even when the node refused something of its own — unless a check
    // before it explicitly aborted, which zod honours for every `when` check.
    { when: () => true },
  );
  JUDGE_OF.set(check, judge);
  return check;
}

/** Is this one of {@link nestedComponentJudgment}'s checks? */
export const isNestedComponentJudgment = (check: unknown): boolean =>
  typeof check === 'object' && check !== null && JUDGE_OF.has(check);

/**
 * The same judgment, consulting `derive(judge)` instead of the judge itself —
 * how a derived face (the strict authoring face) judges nested components
 * against its own twin of the node union. `undefined` for any other check.
 * `derive` runs once, at the first parse that needs it.
 */
export function rebindNestedComponentJudgment(
  check: unknown,
  derive: (judge: z.ZodType) => z.ZodType,
): z.core.$ZodCheck<unknown> | undefined {
  const judge = typeof check === 'object' && check !== null ? JUDGE_OF.get(check) : undefined;
  if (judge === undefined) return undefined;
  let derived: z.ZodType | undefined;
  return nestedComponentJudgment(() => (derived ??= derive(judge())));
}
