/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7712 — `filter` is DECLARED authoring surface on every tag
 * `ObjectKanbanRenderer` is published under.
 *
 * ## The defect this pins closed
 *
 * `ObjectKanban.tsx:363` sends the authored key to the query as
 * `$filter: schema.filter`, and `@objectstack/spec`'s
 * `ComponentPropsMap['object-kanban']` declares `filter` — but neither of the
 * two registrations that publish this renderer listed it in `inputs`. Since
 * `sdui-parser`'s `validate.ts:76` reports `unknown-prop` for every key no
 * `inputs` entry claims, the html tier told an author that the one spelling
 * that WORKS is unknown, while the renderer honoured it. That is objectui#6678's
 * shape: a correct write drawing the same diagnostic as a write that does
 * nothing, which trains authors (AI authors included) to delete working
 * metadata and to dismiss the reports that are real.
 *
 * ADR-0049 enforce-or-remove resolves this toward DECLARE, not remove: a key
 * with live readers on both ends is not dead, so the registrations were the
 * side that was wrong.
 *
 * ## Why a gate did not catch it, and still will not catch the next one
 *
 * The framework's `check:react-blocks-declaration-parity` diffs the manifest
 * `manifestFromConfigs` produces AGAINST the spec's zod schemas — manifest to
 * spec, one direction. A key the SPEC declares and the manifest omits is
 * structurally outside what that ratchet measures, so this whole class is in
 * its blind spot. Making it bidirectional is its own card; this file is the
 * per-key pin for the two instances objectui#7712 names.
 *
 * ## Why the declaration is hand-written and not derived from the mapping
 *
 * The `ElementDataSourceMapping` beside these registrations
 * (`OBJECT_KANBAN_DATA_SOURCE`) already asserts `filter` is a live query key,
 * which invites deriving `inputs` from it the way `register()` derives the
 * `dataSource` input (objectui#6678). Measured, that derivation would be wrong
 * here: the same mapping also carries `limit`, and
 * `ComponentPropsMap['object-kanban']` is a STRICT object that does not declare
 * `limit` — emitting it would publish a key the save gate refuses, turning the
 * manifest-to-spec parity check red in the opposite direction. So `filter` is
 * declared per key, against the spec, exactly as `object-grid`'s
 * `GRID_QUERY_INPUTS` declares its own.
 *
 * ## The rows, and what makes each a reading
 *
 * 1. THE HTML TIER ACCEPTS IT — the real validator over a manifest built from
 *    the LIVE registry (never a hand-written one that could agree with itself),
 *    on every tag the renderer is published under. This row is red on
 *    `origin/main` and green here.
 * 2. THE CONTROL, on the same call — a prop the component genuinely does not
 *    declare is still reported. Without it, row 1's empty array would also be
 *    produced by a validator that reported nothing at all.
 * 3. THE DECLARATION, read straight off the registry, with `objectName` as its
 *    non-vacuity control.
 * 4. THE CONTRACT AGREES — the spec accepts an authored `filter` on this block
 *    (asserted as a KEY verdict: `filter` is absent from `unrecognized_keys`),
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

/**
 * The tag this one renderer is published under.
 *
 * ⚠️ It was a LIST OF TWO — `object-kanban` and `view:kanban` — until
 * objectui#8802 retired the bare `kanban` node type key (maintainer ruling
 * 2026-09-09). The `it.each` shape is deliberately KEPT over the one survivor:
 * the rows below are per-(tag, key), and collapsing them to bare `it`s would
 * make re-adding a tag a rewrite rather than a one-line edit.
 */
const KANBAN_TAGS = [
  { label: 'object-kanban', type: 'object-kanban', namespace: 'plugin-kanban' },
] as const;

/** A filter in the JSON-rules form `ObjectKanban` forwards as `$filter`. */
const AUTHORED_FILTER = [{ field: 'stage', operator: 'eq', value: 'open' }];

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

/** `unknown-prop` messages a one-node document draws for `props`. */
const unknownProps = (type: string, props: Record<string, unknown>): string[] =>
  validateTree({ type, objectName: 'task', ...props } as never, liveManifest())
    .diagnostics.filter((d) => d.code === 'unknown-prop')
    .map((d) => d.message);

describe('objectui#7712 — object-kanban publishes the `filter` it reads', () => {
  it.each(KANBAN_TAGS)('$label — the html tier accepts an authored filter', ({ type }) => {
    expect(
      unknownProps(type, { filter: AUTHORED_FILTER }),
      `<${type}> reports the spec-declared \`filter\` as unknown while ObjectKanban.tsx sends it as $filter`,
    ).toEqual([]);
  });

  it.each(KANBAN_TAGS)('$label — control: a genuinely unknown prop is still reported', ({ type }) => {
    expect(unknownProps(type, { bogusProp: AUTHORED_FILTER })).toEqual([
      `<${type}> has no prop "bogusProp"`,
    ]);
  });

  it.each(KANBAN_TAGS)('$label — the registration declares it', ({ type, namespace }) => {
    const declared = declaredInputNames(type, namespace);
    // Non-vacuity: a registration that published nothing would satisfy no
    // `toContain`, but an empty read (wrong type/namespace) would fail both
    // lines rather than silently passing one.
    expect(declared, `${type} inputs`).toContain('objectName');
    expect(declared, `${type} inputs`).toContain('filter');
  });

  it('the spec accepts the key, so this declares rather than widens', () => {
    const parsed = (ComponentPropsMap as Record<string, any>)['object-kanban'].safeParse({
      objectName: 'task',
      filter: AUTHORED_FILTER,
    });
    const unrecognized = parsed.success
      ? []
      : parsed.error.issues.flatMap((issue: any) => issue.keys ?? []);
    expect(unrecognized).not.toContain('filter');
    // The control for that zero: the same strict schema DOES refuse a key it
    // never declared, so "not rejected" is a verdict and not a vacuous read.
    const bogus = (ComponentPropsMap as Record<string, any>)['object-kanban'].safeParse({
      objectName: 'task',
      bogusProp: AUTHORED_FILTER,
    });
    expect(bogus.success).toBe(false);
    expect(bogus.error.issues.flatMap((issue: any) => issue.keys ?? [])).toContain('bogusProp');
  });
});
