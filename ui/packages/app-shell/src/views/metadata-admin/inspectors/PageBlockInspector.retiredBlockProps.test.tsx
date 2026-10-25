// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7772 — the `object-kanban` panel on screen: the lane picker now
 * writes `groupBy`, `limit` is authorable, and a stored `groupField` is gone
 * from both the panel and the next save.
 *
 * The sibling `previews/__tests__/block-config.test.ts` pins the TABLE and the
 * strip function. That is a fact about data. This file pins the fact about the
 * screen, and they are different for the reason
 * `PageBlockInspector.sectionName.test.tsx` states: `BLOCK_CONFIG` is data, and
 * what an author gets is whatever `renderField` and the generic "Advanced"
 * section do with it. Two of the three facts below are only reachable here:
 *
 *   - a retired key that is no longer a curated field falls into ADVANCED,
 *     whose editor can set a value but has no delete — so "not offered as a
 *     curated control" and "not on screen at all" are different claims, and
 *     only the second one is the fix;
 *   - `blockProps` is the single value every property write spreads from, so
 *     whether the retired key rides back out is decided by a real commit, not
 *     by reading the strip in isolation.
 *
 * ## NOT pinned here, deliberately: page-schema rejection
 *
 * Measured against the pinned `@objectstack/spec`: `PageSchema.safeParse` does
 * not look inside a block's `properties` at all — a page carrying
 * `properties: { zzzTotallyBogusKey: 1 }` parses green, so a poisoned kanban
 * block was never blocked at the designer's save gate. The refusal is on the
 * NODE face (`ObjectKanbanSchema`, `@object-ui/types/zod`), which is where the
 * sibling suite asserts it. Pinning "the committed draft parses" here would be
 * a green light that means nothing.
 *
 * FIXTURE DISCIPLINE (#3216's method, as in the sibling suites): the page is
 * authored the way a user does and fed through `PageSchema.parse`, so the
 * fixture cannot drift from the spec.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PageSchema } from '@objectstack/spec/ui';

// objectui#4697 — see PageBlockInspector.i18n.test.tsx for the full mechanism;
// same STABLE stub, short-circuiting useObjectFields/useObjectOptions's
// mount-time fetch instead of letting it escape to the real network. No
// assertion here reads the fetched object list or its fields.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { PageBlockInspector } from './PageBlockInspector';

afterEach(cleanup);

const BLOCK_PATH = 'regions[0].components[0]';

/** A record page carrying one `object-kanban` block with the given properties. */
function pageDraft(properties: Record<string, unknown>): Record<string, unknown> {
  return PageSchema.parse({
    name: 'opportunity_record',
    label: 'Opportunity',
    type: 'record',
    object: 'opportunity',
    template: 'default',
    regions: [
      { name: 'main', components: [{ type: 'object-kanban', id: 'b1', properties }] },
    ],
  }) as unknown as Record<string, unknown>;
}

function renderInspector(draft: Record<string, unknown>, onPatch = vi.fn()) {
  render(
    <PageBlockInspector
      type="page"
      name="opportunity_record"
      draft={draft}
      selection={{ kind: 'block', id: BLOCK_PATH }}
      onPatch={onPatch}
      onClearSelection={() => {}}
      readOnly={false}
      locale={'en-US' as never}
    />,
  );
  return onPatch;
}

/** The block's `properties` as the inspector last committed them. */
function committedProps(onPatch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const patch = onPatch.mock.calls.at(-1)![0] as any;
  return patch.regions[0].components[0].properties as Record<string, unknown>;
}

/* ─────────────────── the controls the schema actually declares ───────────── */

describe('object-kanban inspector · the declared controls are on screen (objectui#7772)', () => {
  it('offers the lane picker and the row cap', () => {
    renderInspector(pageDraft({ objectName: 'opportunity' }));
    // The lane picker kept its wording and changed the key underneath it, so
    // the label is the same string it always was — the rename is invisible to
    // an author, which is the intended cost of it.
    expect(screen.getByLabelText('Group by field')).toBeTruthy();
    expect(screen.getByLabelText('Limit')).toBeTruthy();
  });

  it('the fetch batch box states DEFAULT_KANBAN_FETCH_BATCH_SIZE while it is empty, and commits a number', () => {
    const onPatch = renderInspector(pageDraft({ objectName: 'opportunity' }));
    const box = screen.getByLabelText('Limit') as HTMLInputElement;
    // Empty box, and the placeholder says what applies anyway.
    expect(box.value).toBe('');
    expect(box.placeholder).toBe('100');

    fireEvent.change(box, { target: { value: '250' } });
    expect(committedProps(onPatch)).toEqual({ objectName: 'opportunity', limit: 250 });
  });
});

/* ────────────────────── the stored retired key, on screen ────────────────── */

describe('object-kanban inspector · a stored `groupField` (objectui#7772)', () => {
  /** A block saved by a released build: the lane value under the retired key. */
  const poisoned = () =>
    pageDraft({
      objectName: 'opportunity',
      groupField: 'stage',
      titleField: 'name',
      // A key the designer does not curate and never retired. It is the
      // NON-VACUITY control for every "not on screen" assertion below: the
      // Advanced section must still be rendering, or their zeroes would be a
      // reading about the section rather than about the key.
      somePluginKey: 'kept',
    });

  it('renders no box for it — not curated, and not in Advanced either', () => {
    renderInspector(poisoned());
    // Advanced IS rendering: the control key has a box, labelled by its raw name.
    expect(screen.getByLabelText('somePluginKey')).toBeTruthy();
    // The retired key has none, under either spelling it could appear as.
    expect(screen.queryByLabelText('groupField')).toBeNull();
    expect(screen.queryByDisplayValue('stage')).toBeNull();
  });

  it('does not ride back out on the next save', () => {
    const onPatch = renderInspector(poisoned());
    // Any property edit rewrites `properties` from the read door's value.
    fireEvent.change(screen.getByLabelText('somePluginKey'), { target: { value: 'edited' } });

    const committed = committedProps(onPatch);
    expect('groupField' in committed).toBe(false);
    // Everything else survives — this is a tombstone-keyed strip, not a
    // blanket unknown-key purge (AGENTS.md #0.1).
    expect(committed).toEqual({
      objectName: 'opportunity',
      titleField: 'name',
      somePluginKey: 'edited',
    });
  });

  it('leaves the lane picker empty rather than reading the retired value into it', () => {
    // Deliberate, and the opposite of the `formula` -> `expression` carry-over
    // (objectui#6526 option B): reading `groupField` into the `groupBy` box
    // would be a second de-facto spelling for the key, and it would invent an
    // intent the board never acted on — `ObjectKanban.tsx` reads `groupBy` at
    // thirteen sites and `groupField` at none, so no card was ever placed by
    // this value. Nothing on screen changes when it goes.
    renderInspector(poisoned());
    const picker = screen.getByLabelText('Group by field') as HTMLElement;
    expect(picker.textContent ?? '').not.toContain('stage');
  });

  it('an untouched block with only live keys is committed verbatim', () => {
    // Non-vacuity for the strip itself: it must not be quietly rewriting
    // properties on every read.
    const onPatch = renderInspector(
      pageDraft({ objectName: 'opportunity', groupBy: 'stage', somePluginKey: 'kept' }),
    );
    fireEvent.change(screen.getByLabelText('somePluginKey'), { target: { value: 'edited' } });
    expect(committedProps(onPatch)).toEqual({
      objectName: 'opportunity',
      groupBy: 'stage',
      somePluginKey: 'edited',
    });
  });
});
