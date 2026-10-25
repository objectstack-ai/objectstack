// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5495 — the page palette advertises the CANONICAL `record:discussion`,
 * and the legacy `record:chatter` stays RENDERABLE while no longer advertised.
 *
 * ## What this pins, and why it is a separate file
 *
 * `block-config.test.ts` derives palette coverage from `PageComponentType`, so
 * it already fails when a spec block type has no decision at all. What it
 * cannot see is WHICH of two interchangeable spellings the decision picked:
 * offering `record:chatter` and excluding `record:discussion` satisfies every
 * derived assertion in that file exactly as well as the reverse. The direction
 * was a maintainer ruling (2026-08-22, Option A — the palette offers the
 * canonical name), and a ruling that nothing asserts is a comment.
 *
 * ## The second half is the one that matters
 *
 * "Excluded from the palette" and "removed" are one careless edit apart, and
 * the careless edit is invisible: `record:chatter` no longer appears in
 * `BLOCK_TYPE_META`, so a later reader who deletes its registration in
 * `plugin-detail/src/index.tsx` breaks every page schema in the wild that spells
 * the block the Salesforce way — and nothing in the palette suite objects,
 * because the palette is exactly where the type is supposed to be absent now.
 *
 * So the renderability half is asserted here, next to the exclusion that could
 * be mistaken for a retirement:
 *
 *   - the registry still resolves the alias, to the SAME renderer function the
 *     canonical name resolves to (identity, not "both are defined" — two
 *     independent renderers that happened to diverge would pass the latter);
 *   - and the alias schema still renders the discussion panel, asserted on the
 *     DOM rather than on the registration, because a registration pointing at a
 *     renderer that throws is still a registration.
 *
 * Each negative pin carries its positive half, for the reason `block-config.
 * test.ts` states throughout: `expect(BLOCK_TYPE_META['record:chatter'])
 * .toBeUndefined()` passes just as happily over a palette that lost every entry.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { PageComponentType } from '@objectstack/spec/ui';
import { enumOptions } from '@object-ui/test-support';
// Side-effect import: registers `record:chatter` and `record:discussion`. The
// app-shell test setup does not pull plugin-detail in, and relying on another
// file having imported it first would make this suite order-dependent.
import '@object-ui/plugin-detail';
import { BLOCK_TYPE_META, PALETTE_EXCLUSIONS } from '../block-types';

afterEach(cleanup);

const specNames: string[] = enumOptions(PageComponentType);

const meta = BLOCK_TYPE_META as Record<string, { label: string; category: string } | undefined>;

describe('page palette — the discussion/chatter pair points at the canonical name (#5495)', () => {
  // The duty `@object-ui/test-support`'s reader leaves with every caller: `[]`
  // is its "could not read", and the `not.toContain` probes below are satisfied
  // by an empty list. The `toContain` probes would red on one — but they say
  // "the spec dropped this member", which sends the next reader to the contract
  // instead of to the reader. This one names the real cause (objectui#6924).
  it('reads a non-empty enum from the spec', () => {
    expect(specNames, 'could not read PageComponentType.options from the spec').not.toEqual([]);
  });

  it('offers `record:discussion`, labelled for authors as "Discussion"', () => {
    expect(meta['record:discussion']).toBeDefined();
    expect(meta['record:discussion']!.label).toBe('Discussion');
    // Same drawer as the rest of the record blocks — a canonical rename that
    // moved the entry to another category would change what an author has to
    // scroll past to find it.
    expect(meta['record:discussion']!.category).toBe('record');
    expect(PALETTE_EXCLUSIONS['record:discussion']).toBeUndefined();
  });

  it('does NOT offer the `record:chatter` alias, and records the reason', () => {
    // POSITIVE half first: a palette that lost every entry would satisfy the
    // two negatives below without offering anything at all.
    expect(Object.keys(BLOCK_TYPE_META).length, 'palette is empty — the pins would be vacuous')
      .toBeGreaterThan(10);
    expect(meta['record:chatter']).toBeUndefined();
    expect(PALETTE_EXCLUSIONS['record:chatter']).toBeTruthy();
  });

  it('both spellings are real members of the pinned spec enum', () => {
    // `block-config.test.ts` checks that every EXCLUDED name is a real spec
    // type; the offered side has no such check, and the flip is only legitimate
    // because the pinned spec declares the canonical name (it did not, at the
    // pin the palette was written against — objectui#5328).
    expect(specNames).toContain('record:discussion');
    expect(specNames).toContain('record:chatter');
    // Counter-probes, so a mis-read enum cannot report membership for
    // everything: one known-present neighbour, one genuinely retired member,
    // one that never existed.
    expect(specNames).toContain('record:details');
    expect(specNames).not.toContain('element:filter');
    expect(specNames).not.toContain('zzNotARealPageComponentType');
  });
});

describe('the `record:chatter` alias stays RENDERABLE — not offered is not removed (#5495)', () => {
  const config = (type: string) =>
    ComponentRegistry.getConfig(type) as { component?: React.ComponentType<any> } | undefined;

  it('the registry resolves the alias to the very same renderer as the canonical name', () => {
    const alias = config('record:chatter');
    const canonical = config('record:discussion');
    expect(alias, '`record:chatter` no longer resolves — existing schemas would break').toBeDefined();
    expect(canonical).toBeDefined();
    // Identity, not merely "both defined": two renderers that drifted apart
    // would pass a defined/defined check while authors of the two spellings
    // silently got different blocks.
    expect(alias!.component).toBe(canonical!.component);
    // Non-vacuity for the lookup itself — a `getConfig` that returned a truthy
    // object for anything would make the assertions above meaningless.
    expect(config('record:zzNotARegisteredType')).toBeUndefined();
  });

  it('a `record:chatter` schema still renders the discussion panel', () => {
    const Alias = config('record:chatter')!.component!;
    const view = render(<Alias schema={{ type: 'record:chatter', position: 'bottom' }} />);
    // Standalone (no DiscussionContext host) the panel renders an empty feed —
    // that copy is the proof the renderer ran, not just that it was resolved.
    expect(screen.getByText('No comments yet')).toBeTruthy();
    const aliasHtml = view.container.innerHTML;
    expect(aliasHtml.length, 'alias rendered nothing').toBeGreaterThan(0);
    cleanup();

    const Canonical = config('record:discussion')!.component!;
    const canonicalView = render(
      <Canonical schema={{ type: 'record:discussion', position: 'bottom' }} />,
    );
    // Same markup from the same props: the pair is one block under two names,
    // and this is the assertion that fails the day that stops being true.
    expect(canonicalView.container.innerHTML).toBe(aliasHtml);
  });
});
