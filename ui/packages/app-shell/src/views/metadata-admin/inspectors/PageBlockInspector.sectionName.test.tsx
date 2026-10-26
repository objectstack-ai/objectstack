// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#3819 — the `record:details` block inspector must let an author write
 * a section's `name`, because `name` is the section heading's i18n ANCHOR.
 *
 * The renderer resolves the heading through
 * `objects.<object>._sections.<name>.label` (`plugin-detail`'s
 * `record-details.tsx`: `s.name && objectName ? sectionLabel(objectName, s.name,
 * rawTitle ?? s.name) : rawTitle`; key convention in
 * `i18n/useObjectLabel.ts`). While the inspector offered only
 * `label`/`columns`/`fields`, every section built in Studio fell into the
 * `: rawTitle` branch forever — one authored string in every locale — and
 * carried an upstream `translation-section-name-missing` diagnostic its author
 * had no control to clear.
 *
 * ## Why this is an interaction test and not only a config-face assertion
 *
 * `BLOCK_CONFIG` is data; what authors get is whatever `PageBlockInspector`'s
 * recursive `renderField` does with it. The array branch renders `itemFields`
 * against a per-item read/write pair, so "the entry exists in the table" and
 * "the box is on screen and its value lands in `properties.sections[i]`" are
 * different facts. These drive the real component and read the committed patch.
 *
 * ## NOT pinned here, deliberately: schema rejection
 *
 * Unlike #3229's `visibleWhen` (where the page schema is `.strict()` and the
 * old key made drafts unsavable), this surface is PERMISSIVE — verified against
 * the pinned `@objectstack/spec@17.0.0-rc.5`: `PageSchema.parse` does not
 * validate `properties` against `RecordDetailsProps` at all, and
 * `RecordDetailsProps` itself accepts an unknown key inside a `sections[]`
 * entry. So a nameless section always parsed; it just could never be
 * translated. Asserting "the committed draft parses" would therefore be a
 * green light that means nothing — the reachability of the KEY is the fact
 * under test.
 *
 * FIXTURE DISCIPLINE (#3216's method, as in the sibling visibleWhen suite): the
 * page is authored the way a user does and fed through `PageSchema.parse`, so
 * the fixture cannot drift from the spec.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PageSchema } from '@objectstack/spec/ui';

// objectui#4697 — see PageBlockInspector.i18n.test.tsx for the full mechanism;
// same stub, short-circuiting useObjectFields/useObjectOptions's mount-time
// fetch instead of letting it escape to the real network.
const state = vi.hoisted(() => ({
  metadataClient: { get: vi.fn(async () => undefined), list: vi.fn(async () => [] as unknown[]), withPreviewDrafts() { return this; } },
}));
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => state.metadataClient,
}));

import { PageBlockInspector } from './PageBlockInspector';

afterEach(cleanup);

/** Selection id for the single block in the fixture page. */
const BLOCK_PATH = 'regions[0].components[0]';

/** A record page carrying one `record:details` block with the given sections. */
function pageDraft(sections: Array<Record<string, unknown>>): Record<string, unknown> {
  return PageSchema.parse({
    name: 'contact_record',
    label: 'Contact',
    type: 'record',
    object: 'contact',
    template: 'default',
    regions: [
      {
        name: 'main',
        components: [{ type: 'record:details', id: 'b1', properties: { sections } }],
      },
    ],
  }) as unknown as Record<string, unknown>;
}

function renderInspector(draft: Record<string, unknown>, onPatch = vi.fn()) {
  render(
    <PageBlockInspector
      type="page"
      name="contact_record"
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

/** The sections array as the inspector last committed it. */
function committedSections(onPatch: ReturnType<typeof vi.fn>): Array<Record<string, unknown>> {
  const patch = onPatch.mock.calls.at(-1)![0] as any;
  return patch.regions[0].components[0].properties.sections as Array<Record<string, unknown>>;
}

/**
 * The section-name boxes, in section order. Located by their LABEL — the same
 * `for`→id chain assistive tech walks, so the locator is now the accessible
 * name and not a proxy for it.
 *
 * This used to locate by placeholder, because `InspectorTextField` rendered its
 * `<Label>` unassociated with the `<input>` (no `htmlFor`/`id`) and
 * `getByLabelText` could not reach it at all — the workaround was the mechanical
 * symptom of objectui#3994, and it is gone with the association. The
 * `snake_case` hint is still asserted below (`the placeholder keeps stating the
 * snake_case convention`): it is the only convention affordance this field has,
 * so it keeps its own case instead of riding along inside a locator.
 */
const nameBoxes = () => screen.getAllByLabelText('Name (i18n key)') as HTMLInputElement[];
/** The label box of section #1 — "Contact info" in these fixtures. */
const labelBox = () => screen.getByDisplayValue('Contact info') as HTMLInputElement;

/* ───────────────────────── the box exists and commits ───────────────────── */

describe('PageBlockInspector — record:details sections expose the i18n anchor (#3819)', () => {
  it('renders one name box per section', () => {
    renderInspector(
      pageDraft([
        { label: 'Contact info', fields: ['first_name'] },
        { label: 'Address', fields: ['city'] },
      ]),
    );
    expect(nameBoxes()).toHaveLength(2);
    // Two sections repeat the SAME label, so this doubles as the consumer-side
    // check that per-instance ids do not collide (objectui#3994): a shared id
    // would resolve both labels to the first box and this would return one.
    const [a, b] = nameBoxes();
    expect(a).not.toBe(b);
  });

  it('the placeholder keeps stating the snake_case convention', () => {
    // `BlockPropField` has no pattern/validate affordance (objectui#3912), so
    // the placeholder is where the naming convention is stated. It used to be
    // asserted implicitly by the locator above; assert it on its own now.
    renderInspector(pageDraft([{ label: 'Contact info', fields: ['first_name'] }]));
    expect(nameBoxes()[0].placeholder).toMatch(/snake_case/i);
  });

  it('typing a name commits it to `properties.sections[i].name`', () => {
    const onPatch = renderInspector(pageDraft([{ label: 'Contact info', columns: 2, fields: ['first_name'] }]));

    fireEvent.change(nameBoxes()[0], { target: { value: 'contact_info' } });

    const [section] = committedSections(onPatch);
    expect(section.name).toBe('contact_info');
    // The write must be a merge, not a replacement: the array branch commits
    // `{ ...itemObj, [n]: v }`, and a section that lost its `fields` to gain a
    // name would render nothing at all.
    expect(section).toMatchObject({ label: 'Contact info', columns: 2, fields: ['first_name'] });
  });

  it('names the right section when several exist', () => {
    const onPatch = renderInspector(
      pageDraft([
        { label: 'Contact info', fields: ['first_name'] },
        { label: 'Address', fields: ['city'] },
      ]),
    );

    fireEvent.change(nameBoxes()[1], { target: { value: 'address' } });

    const sections = committedSections(onPatch);
    expect(sections[1].name).toBe('address');
    expect(sections[0]).not.toHaveProperty('name');
  });

  it('the committed name satisfies the renderer guard that reaches the i18n lookup', () => {
    // `record-details.tsx` gates the translated read on `s.name && objectName`.
    // Before this field existed the guard could never be satisfied from Studio;
    // this asserts the authored value is what makes it truthy, and spells out
    // the key the convention then resolves.
    const onPatch = renderInspector(pageDraft([{ label: 'Contact info', fields: ['first_name'] }]));
    fireEvent.change(nameBoxes()[0], { target: { value: 'contact_info' } });

    const [section] = committedSections(onPatch);
    expect(typeof section.name === 'string' && section.name.length > 0).toBe(true);
    expect(`objects.contact._sections.${section.name}.label`).toBe(
      'objects.contact._sections.contact_info.label',
    );
  });

  it('a freshly added section offers an empty name box', () => {
    // Start from a page that already has one section so the new entry is
    // rendered by the same pass — `onPatch` is a spy, not a state setter, so the
    // pushed item is not fed back into this render.
    const onPatch = renderInspector(pageDraft([{ label: 'Contact info', fields: ['first_name'] }]));

    fireEvent.click(screen.getByText('Add section'));

    // The array branch pushes a bare `{}`, so the new entry carries no keys —
    // in particular no `name` derived from anything.
    expect(committedSections(onPatch)).toEqual([
      { label: 'Contact info', fields: ['first_name'] },
      {},
    ]);
    // And the box the author needs is really on screen for the existing entry.
    // Asserted here too so this case fails — rather than passing vacuously —
    // if the itemField is ever dropped again.
    expect(nameBoxes()[0].value).toBe('');
  });
});

/* ─────────── sub-question ②: no backfill onto pre-existing sections ─────── */

/**
 * A section authored before this field existed has a `label` and no `name`.
 * Opening it must leave the anchor EMPTY rather than seeding it from the label.
 *
 * Backfilling would be actively harmful, and silently so: `label` may already
 * be a localized string (or an inline `{ en, 'zh-CN' }` map — `record-details`
 * runs it through `pickLocalized`). Deriving an anchor from it freezes one
 * locale's prose into the key that is supposed to be locale-INDEPENDENT, and
 * because the renderer falls back to the authored label when a translation
 * misses, the damage renders identically to the bug — invisible until someone
 * adds a second locale.
 */
describe('PageBlockInspector — an existing label-only section is not backfilled (#3819)', () => {
  const legacy = () => pageDraft([{ label: 'Contact info', columns: 2, fields: ['first_name'] }]);

  it('opens the name box empty and leaves the label alone', () => {
    renderInspector(legacy());

    expect(nameBoxes()[0].value).toBe('');
    expect(labelBox().value).toBe('Contact info');
  });

  it('rendering the inspector writes nothing by itself', () => {
    // The inspector is read-through: `renderField` only writes from a commit
    // handler. A backfill would have to patch during render — which would also
    // mark an untouched page dirty just for being opened.
    const onPatch = renderInspector(legacy());
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('keeps the section nameless until the author types one', () => {
    const onPatch = renderInspector(legacy());

    // Touch a neighbouring field: any commit re-writes the whole item object,
    // which is exactly where an accidental derived `name` would appear.
    fireEvent.change(labelBox(), { target: { value: 'Contact details' } });

    const [section] = committedSections(onPatch);
    expect(section.label).toBe('Contact details');
    expect(section).not.toHaveProperty('name');
  });
});
