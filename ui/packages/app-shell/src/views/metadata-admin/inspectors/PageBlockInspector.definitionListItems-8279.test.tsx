// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8279 — the `element:definition-list` panel on screen: the two item
 * boxes commit the keys the renderer reads, and what an author types comes out
 * the other end.
 *
 * The sibling `previews/__tests__/definition-list-item-keys-8279.test.tsx` pins
 * the TABLE against the renderer by ASSEMBLING an item the way the inspector
 * assembles it. That is a fact about data, and it inherits this file's premise
 * rather than proving it. This file drives the real panel: `fireEvent.change`
 * on the real boxes, `onPatch` read back, and the committed properties handed
 * to the real renderer. Two things are only reachable here:
 *
 *   - that `renderField`'s array branch commits the item key VERBATIM, which is
 *     the mechanism the whole defect rests on and which the sibling file can
 *     only imitate;
 *   - the ROUND TRIP — inspector out, renderer in — with no hand-written item
 *     literal anywhere between them.
 *
 * ## The stored-document row pins a DECISION, not an accident
 *
 * A list saved by a released build carries `items: [{ label, value }]` (the
 * controls were named `label` / `value` until this card). Those two keys are
 * NOT stripped on read and NOT migrated into the new boxes, and the last
 * describe pins both halves so the choice is visible to the next reader rather
 * than looking like an oversight.
 *
 * Why no strip: objectui#7772's `stripRetiredBlockProps` admits a key only when
 * the block's node schema refuses it BY NAME, so the strip cannot lose anything
 * a consumer would have honoured — and `element:definition-list` has no
 * runtime-judgeable schema on either face (objectui#8216 carries it as an
 * explicit exemption; objectui#8281 owns that absence). Nothing refuses these
 * keys, and they hold text an author typed. `RETIRED_FIELD_KEYS`' membership
 * criterion states the consequence for the sibling ledger in as many words: a
 * key the schema ACCEPTS must never be added, because stripping an accepted key
 * deletes authored metadata.
 *
 * Why no migration either: that is objectui#6526 option B's shape (`expression
 * ?? formula`, seeded at the read door), and it is a second de-facto spelling
 * with no retirement path here — nothing will ever remove the old keys from a
 * stored document, so the alias could never be withdrawn. That is a standing
 * commitment worth deciding on its own card rather than as a rider on this one.
 * The authored strings are not lost meanwhile: they stay in the document and
 * stay readable and editable in the resource editor's JSON source tab, the
 * surface whose own comment names "nested arrays" as its reason to exist.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PageSchema } from '@objectstack/spec/ui';
import { ComponentRegistry } from '@object-ui/core';
// Module scope, not a hook: the barrel registers the renderers as a side
// effect and the cost belongs to the import phase (AGENTS.md §测试纪律).
import '@object-ui/components';

// objectui#4697 — the same STABLE stub the sibling inspector suites use,
// short-circuiting the mount-time metadata fetch. Nothing here reads it.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { PageBlockInspector } from './PageBlockInspector';

afterEach(cleanup);

const BLOCK_PATH = 'regions[0].components[0]';

/**
 * A record page carrying one `element:definition-list` block.
 *
 * FIXTURE DISCIPLINE (#3216's method, as in the sibling suites): authored the
 * way a user does and fed through `PageSchema.parse`, so the fixture cannot
 * drift from the spec.
 */
function pageDraft(properties: Record<string, unknown>): Record<string, unknown> {
  return PageSchema.parse({
    name: 'opportunity_record',
    label: 'Opportunity',
    type: 'record',
    object: 'opportunity',
    template: 'default',
    regions: [
      { name: 'main', components: [{ type: 'element:definition-list', id: 'b1', properties }] },
    ],
  }) as unknown as Record<string, unknown>;
}

/**
 * Render the panel under a host that APPLIES each patch, the way the editor
 * does. A `vi.fn()` that only records is not good enough here and the failure
 * is silent in the dangerous direction: every property write spreads from
 * `blockProps`, which is derived from the `draft` PROP, so against a host that
 * never re-renders the second field's commit spreads from the stale draft and
 * DROPS the first one. The panel looks like it overwrites its own items.
 * Measured, on the first draft of this file: typing Term then Description
 * committed `{ description }` alone.
 */
function renderInspector(initial: Record<string, unknown>) {
  const patches: Array<Record<string, unknown>> = [];
  function Host() {
    const [draft, setDraft] = React.useState(initial);
    return (
      <PageBlockInspector
        type="page"
        name="opportunity_record"
        draft={draft}
        selection={{ kind: 'block', id: BLOCK_PATH }}
        onPatch={(next: Record<string, unknown>) => {
          patches.push(next);
          setDraft(next);
        }}
        onClearSelection={() => {}}
        readOnly={false}
        locale={'en-US' as never}
      />
    );
  }
  render(<Host />);
  return patches;
}

/** The block's `properties` as the inspector last committed them. */
function committedProps(patches: Array<Record<string, unknown>>): Record<string, unknown> {
  const patch = patches.at(-1) as any;
  return patch.regions[0].components[0].properties as Record<string, unknown>;
}

/** Render a definition-list block from `properties` the inspector produced. */
function renderBlock(properties: Record<string, unknown>) {
  const Component = ComponentRegistry.get('element:definition-list');
  if (!Component) throw new Error('element:definition-list is not registered');
  return render(<Component schema={{ type: 'element:definition-list', properties }} />);
}

describe('element:definition-list inspector · the item boxes on screen (objectui#8279)', () => {
  it('labels the two item controls Term and Description', () => {
    renderInspector(pageDraft({ items: [{}] }));
    expect(screen.getByLabelText('Term')).toBeTruthy();
    expect(screen.getByLabelText('Description')).toBeTruthy();
    // The retired wording is gone from the panel, including the `inline`
    // field's own prose, which spelled the pair it describes.
    expect(screen.queryByLabelText('Label')).toBeNull();
    expect(screen.queryByLabelText('Value')).toBeNull();
    expect(screen.queryByLabelText('Inline (label · value)')).toBeNull();
    expect(screen.getByLabelText('Inline (term · description)')).toBeTruthy();
  });

  it('commits what the author typed under `term` / `description`', () => {
    const patches = renderInspector(pageDraft({ items: [{}] }));
    fireEvent.change(screen.getByLabelText('Term'), { target: { value: 'Status' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Active' } });
    expect(committedProps(patches)).toEqual({ items: [{ term: 'Status', description: 'Active' }] });
  });

  it('ROUND TRIP — the committed properties render as the author typed them', () => {
    // The assertion the whole card is about, with no hand-written item between
    // the two faces: what the panel committed is what the renderer is given.
    const patches = renderInspector(pageDraft({ items: [{}] }));
    fireEvent.change(screen.getByLabelText('Term'), { target: { value: 'Status' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Active' } });
    const committed = committedProps(patches);
    cleanup();

    const { queryByText, getByTestId } = renderBlock(committed);
    expect(getByTestId('definition-list')).toBeTruthy();
    expect(queryByText('Status')).toBeTruthy();
    expect(queryByText('Active')).toBeTruthy();
    // The defect's visible signature, absent: an author-filled description no
    // longer falls through `toText`'s null branch.
    expect(queryByText('—')).toBeNull();
  });
});

describe('element:definition-list inspector · a document saved by a released build', () => {
  /** A list authored before this card: the two strings under the retired keys. */
  const stored = () => pageDraft({ items: [{ label: 'Status', value: 'Active' }] });

  it('shows the new boxes EMPTY — the old keys are not read into them', () => {
    renderInspector(stored());
    expect((screen.getByLabelText('Term') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Description') as HTMLInputElement).value).toBe('');
  });

  it('keeps the authored strings in the document — they are not stripped', () => {
    // The half a strip would take. `blockProps` is the single value every
    // property write spreads from, so an unrelated commit is what decides
    // whether the old keys ride back out.
    const patches = renderInspector(stored());
    fireEvent.change(screen.getByLabelText('Term'), { target: { value: 'Stage' } });
    expect(committedProps(patches)).toEqual({
      items: [{ label: 'Status', value: 'Active', term: 'Stage' }],
    });
  });

  it('renders exactly as it did before this card — nothing regressed', () => {
    // A stored list rendered a blank term and a literal em-dash before the
    // rename, and does so after it: the renderer was not touched. This row is
    // what makes "left alone" a measured claim rather than an assumption.
    const { container, queryByText } = renderBlock({ items: [{ label: 'Status', value: 'Active' }] });
    expect(container.querySelector('dt')!.textContent).toBe('');
    expect(queryByText('—')).toBeTruthy();
    // And the empty state still never fires to explain it — `items.length` is
    // non-zero, which is why the defect was silent for its whole life.
    expect(queryByText(/No details/i)).toBeNull();
  });
});
