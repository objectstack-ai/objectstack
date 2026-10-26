/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7712 (`filter`) and objectui#8171 (`sort`) — the QUERY keys
 * `ObjectCalendar` lowers onto its fetch are DECLARED authoring surface on
 * every tag `ObjectCalendarRenderer` is published under. Sibling of the file
 * with the same name in `@object-ui/plugin-kanban`; same defect, same pin
 * shape, the other half of #7712's card.
 *
 * ## The defect this pins closed
 *
 * `ObjectCalendar.tsx` sends both authored keys to the query — `$filter:
 * schema.filter` and `$orderby: convertSortToQueryParams(schema.sort)` — and
 * `@objectstack/spec`'s `ComponentPropsMap['object-calendar']` declares both.
 * But neither of the two registrations that publish this renderer listed
 * either one in `inputs`. Since `sdui-parser`'s `validate.ts` reports
 * `unknown-prop` for every key no `inputs` entry claims, the html tier told an
 * author that the one spelling that WORKS is unknown, while the renderer
 * honoured it (objectui#6678's shape). ADR-0049 enforce-or-remove resolves it
 * toward DECLARE: both keys have live readers on both ends, so the
 * registrations were the side that was wrong.
 *
 * ## Why `sort`'s rows live in a file named for #7712
 *
 * #7712's adjudication was per key and covered `filter` only, so `sort` was
 * filed separately as #8171 — but it is the same defect one key over, and the
 * instrument below (live-registry manifest, real validator, unknown-prop
 * control, spec key-verdict) is the same instrument. A second file would be a
 * parallel harness for one more row, so #8171 is added here as rows in the
 * `QUERY_KEYS` table instead. ⛔ The next query key that needs declaring is a
 * row here too, not a third file.
 *
 * ## Its relation to objectui#7711, which landed first
 *
 * #7711 retired `getCalendarConfig`'s probe of `schema.filter` for a `calendar`
 * key — the `filter.map` shape objectui#4034 closed, one view over. That left
 * exactly one meaning for the key, which is what makes this declaration
 * writable at all: `filter` is the query filter and nothing else, so it is
 * declared here as `type: 'array'`, the same arm `object-grid` and
 * `object-metric` publish. Had the object-shaped spelling survived, this
 * declaration would have contradicted it — the two cards had to be decided in
 * this order, and were.
 *
 * ## Why a gate did not catch it, and still will not catch the next one
 *
 * The framework's `check:react-blocks-declaration-parity` diffs the manifest
 * `manifestFromConfigs` produces AGAINST the spec's zod schemas — manifest to
 * spec, one direction. A key the SPEC declares and the manifest omits is
 * structurally outside what that ratchet measures. This file is the per-key
 * pin for the instances #7712 and #8171 name; making the ratchet bidirectional
 * is its own card (objectui#8176).
 *
 * ## The rows, and what makes each a reading
 *
 * 1. THE HTML TIER ACCEPTS IT — the real validator over a manifest built from
 *    the LIVE registry (never a hand-written one that could agree with itself),
 *    on every tag the renderer is published under. Red on `origin/main`, green
 *    here.
 * 2. THE DECLARED ARM FITS — the same validator draws no `type-mismatch` for
 *    the shape the renderer actually lowers, so the `type: 'array'` written
 *    beside each name is a measured claim and not an unread label.
 * 3. THE CONTROL, on the same call — a prop the component genuinely does not
 *    declare is still reported, so row 1's empty array is a verdict rather than
 *    a validator that reports nothing.
 * 4. THE DECLARATION, read straight off the registry, with `objectName` as its
 *    non-vacuity control.
 * 5. THE CONTRACT AGREES — the spec accepts each authored key on this block
 *    (asserted as a KEY verdict: the key is absent from `unrecognized_keys`),
 *    so declaring it restores `declared = enforced` rather than widening past
 *    the contract.
 */

import { describe, it, expect } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';
import { ComponentPropsMap } from '@objectstack/spec/ui';
import { manifestFromConfigs, validateTree } from '@object-ui/sdui-parser';
// Module scope, not a hook: this import IS the registration (AGENTS.md's
// test-discipline section — an unbounded module load must not be billed to a
// bounded window).
import '../index';

/** The two tags this one renderer is published under. */
const CALENDAR_TAGS = [
  { tagLabel: 'object-calendar', type: 'object-calendar', namespace: 'plugin-calendar' },
  { tagLabel: 'view:calendar', type: 'calendar', namespace: 'view' },
] as const;

/** A filter in the JSON-rules form `ObjectCalendar` forwards as `$filter`. */
const AUTHORED_FILTER = [{ field: 'status', operator: 'eq', value: 'confirmed' }];

/**
 * A sort in the `[{ field, order }]` form `convertSortToQueryParams` lowers to
 * `$orderby`. That helper also honours the legacy string clause (`'start desc'`),
 * which every `sort` declaration in this repo leaves undeclared — all seven of
 * them are `type: 'array'`. This pin follows that convention rather than
 * widening the arm set, which would be its own contract decision.
 */
const AUTHORED_SORT = [{ field: 'start', order: 'desc' }];

/** The query keys `ObjectCalendar` lowers onto the fetch, one row per card. */
const QUERY_KEYS = [
  { card: 'objectui#7712', key: 'filter', lowersTo: '$filter', authored: AUTHORED_FILTER },
  { card: 'objectui#8171', key: 'sort', lowersTo: '$orderby', authored: AUTHORED_SORT },
] as const;

/** Every (tag, key) pair — so a registration that omits one key reddens alone. */
const CASES = CALENDAR_TAGS.flatMap((tag) =>
  QUERY_KEYS.map((k) => ({ ...tag, ...k, label: `${tag.tagLabel} · ${k.key}` })),
);

const declaredInputNames = (type: string, namespace?: string): string[] =>
  ((ComponentRegistry.getConfig(type, namespace) as any)?.inputs ?? []).map((i: any) => i.name);

/**
 * A manifest built the way `gen-manifest.ts` and the JSX-page compiler build
 * theirs — from the live registry — so these verdicts are the ones a real
 * author gets, not the ones a fixture was written to produce.
 */
const liveManifest = () =>
  manifestFromConfigs(
    ComponentRegistry.getKnownTypes().map((type) => {
      const meta = ComponentRegistry.getMeta(type);
      return { type, namespace: meta?.namespace, isContainer: meta?.isContainer, inputs: meta?.inputs };
    }) as unknown as Parameters<typeof manifestFromConfigs>[0],
  );

/** Messages of one diagnostic code that a one-node document draws for `props`. */
const diagnosticsOf = (type: string, props: Record<string, unknown>, code: string): string[] =>
  validateTree({ type, objectName: 'event', ...props } as never, liveManifest())
    .diagnostics.filter((d) => d.code === code)
    .map((d) => d.message);

/** `unknown-prop` messages a one-node document draws for `props`. */
const unknownProps = (type: string, props: Record<string, unknown>): string[] =>
  diagnosticsOf(type, props, 'unknown-prop');

describe('objectui#7712 / #8171 — object-calendar publishes the query keys it reads', () => {
  it.each(CASES)('$label — the html tier accepts the authored key', ({ type, key, authored, lowersTo }) => {
    expect(
      unknownProps(type, { [key]: authored }),
      `<${type}> reports the spec-declared \`${key}\` as unknown while ObjectCalendar.tsx sends it as ${lowersTo}`,
    ).toEqual([]);
  });

  it.each(CASES)('$label — the declared `array` arm accepts the lowered shape', ({ type, key, authored }) => {
    expect(diagnosticsOf(type, { [key]: authored }, 'type-mismatch')).toEqual([]);
  });

  it.each(CALENDAR_TAGS)('$tagLabel — control: a genuinely unknown prop is still reported', ({ type }) => {
    expect(unknownProps(type, { bogusProp: AUTHORED_FILTER })).toEqual([
      `<${type}> has no prop "bogusProp"`,
    ]);
  });

  it.each(CASES)('$label — the registration declares it', ({ type, namespace, key }) => {
    const declared = declaredInputNames(type, namespace);
    // Non-vacuity: an empty read (wrong type/namespace) fails both lines rather
    // than silently passing one.
    expect(declared, `${type} inputs`).toContain('objectName');
    expect(declared, `${type} inputs`).toContain(key);
  });

  it.each(QUERY_KEYS)('$card — the spec accepts `$key`, so this declares rather than widens', ({ key, authored }) => {
    const parsed = (ComponentPropsMap as Record<string, any>)['object-calendar'].safeParse({
      objectName: 'event',
      [key]: authored,
    });
    const unrecognized = parsed.success
      ? []
      : parsed.error.issues.flatMap((issue: any) => issue.keys ?? []);
    expect(unrecognized).not.toContain(key);
    // The control for that zero: the same strict schema DOES refuse a key it
    // never declared, so "not rejected" is a verdict and not a vacuous read.
    const bogus = (ComponentPropsMap as Record<string, any>)['object-calendar'].safeParse({
      objectName: 'event',
      bogusProp: authored,
    });
    expect(bogus.success).toBe(false);
    expect(bogus.error.issues.flatMap((issue: any) => issue.keys ?? [])).toContain('bogusProp');
  });
});
