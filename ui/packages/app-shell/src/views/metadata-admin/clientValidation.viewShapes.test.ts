// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `view` draft validation across the type's TWO spec-declared shapes
 * (objectui#3312, surfaced by the `@objectstack/spec` 17.0.0-rc.2 uptake).
 *
 * `@objectstack/spec/ui` exports both `ViewItemSchema` (the first-class
 * per-view record this admin authors — `{ name, object, viewKind, config }`,
 * ADR-0017) and `ViewSchema` (the aggregated container — `{ list, form,
 * listViews, formViews }`), and the backend serves both.
 *
 * The validator used to name only the container. That looked fine because the
 * container was non-strict: a ViewItem's `viewKind` / `config` were silently
 * stripped and the draft "passed" without one of its own keys ever being
 * checked — a vacuous pass, for every view this admin has ever created. Spec
 * 17.0.0 made the container strict and turned it into a loud rejection.
 *
 * These pins state the property that matters and that a single-schema mapping
 * cannot have: BOTH shapes validate, each against its OWN schema, and neither
 * is waved through. The last two are the load-bearing ones — they fail if the
 * dispatch ever degrades into "try one, shrug on failure".
 */

import { describe, it, expect } from 'vitest';
import { validateMetadataDraft } from './clientValidation';

/** What `anchors.ts`'s `createBuildBody` emits for a default list view. */
const VIEW_ITEM: Record<string, unknown> = {
  name: 'crm_lead.all_leads',
  object: 'crm_lead',
  viewKind: 'list',
  label: 'All Leads',
  config: {
    type: 'grid',
    columns: [],
    data: { provider: 'object', object: 'crm_lead' },
  },
};

/** A record that was never expanded into ViewItems. */
const CONTAINER = {
  name: 'crm_lead',
  label: 'Lead views',
  object: 'crm_lead',
  list: { type: 'grid', columns: ['name'] },
};

describe('validateMetadataDraft("view") — both spec shapes (objectui#3312)', () => {
  it('accepts the ViewItem this admin authors', async () => {
    const res = await validateMetadataDraft('view', VIEW_ITEM);
    expect(res.issues, JSON.stringify(res.issues)).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('accepts the aggregated container the backend still serves', async () => {
    const res = await validateMetadataDraft('view', CONTAINER);
    expect(res.issues, JSON.stringify(res.issues)).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('still REJECTS a ViewItem whose own body is wrong', async () => {
    // The whole point of dispatching: a ViewItem is now checked against
    // `ViewItemSchema`, so a bad `config` is caught instead of stripped. Under
    // the old container-only mapping this passed vacuously.
    const res = await validateMetadataDraft('view', {
      ...VIEW_ITEM,
      config: { type: 'not_a_real_layout', columns: [] },
    });
    expect(res.ok).toBe(false);
    expect(res.issues.length).toBeGreaterThan(0);
  });

  it('still REJECTS a container that carries an unknown key', async () => {
    const res = await validateMetadataDraft('view', {
      ...CONTAINER,
      notAContainerKey: true,
    });
    expect(res.ok).toBe(false);
    expect(res.issues.length).toBeGreaterThan(0);
  });
});

/**
 * Editing a STORED view body — the wire gate (objectstack#5316).
 *
 * The four pins above all describe the AUTHORING surface: what
 * `createBuildBody` may emit. Editing is a different door. The editor opens a
 * body that came back OUT of `sys_metadata`, and a stored body carries keys the
 * platform itself wrote there:
 *
 *   - `isPinned`   — `ObjectView.tsx:882`, the view-switcher's pin action, via
 *                    `dataSource.updateView(object, vid, { isPinned: true })`.
 *   - `sortOrder`  — `ObjectView.tsx:931`, the reorder write.
 *   - nested `id`  — the console filter/sort builder's stable React key
 *                    (`VIEW_CONSOLE_ROW_DECORATIONS`), on `config.filter[]` rows.
 *
 * `updateView` GETs the stored item and PUTs `{ ...current, ...partial }`, and
 * `saveMetaItem` persists the accepted body verbatim (ADR-0005 §Validation) — so
 * these keys are in the stored body by design, not by accident.
 *
 * Before #5074 `ViewItemSchema` was strip and they were silently dropped. #5074
 * tightened it into a real authoring gate, which is correct for CREATE and wrong
 * for EDIT: the SERVER validates the very same body against `ViewMetadataSchema`
 * and accepts it. The client was strictly stricter than the server — direction
 * inverted. These pins fix the direction: create keeps the authoring gate, edit
 * is judged by the same wire schema the server runs.
 */
describe('validateMetadataDraft("view") — stored bodies on the EDIT path (objectstack#5316)', () => {
  /** A stored ViewItem that has been pinned via the view switcher. */
  const PINNED = { ...VIEW_ITEM, isPinned: true };
  /** A stored ViewItem that has been dragged into a new position. */
  const REORDERED = { ...VIEW_ITEM, sortOrder: 3 };
  /** Both round-trip keys, plus the console builder's nested row decoration. */
  const PINNED_WITH_BUILDER_ROWS = {
    ...VIEW_ITEM,
    isPinned: true,
    sortOrder: 3,
    config: {
      type: 'grid',
      columns: [],
      data: { provider: 'object', object: 'crm_lead' },
      filter: [{ field: 'status', operator: 'equals', value: 'open', id: 'row-1' }],
    },
  };

  it('accepts a stored view that was PINNED', async () => {
    const res = await validateMetadataDraft('view', PINNED, undefined, { mode: 'edit' });
    expect(res.issues, JSON.stringify(res.issues)).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('accepts a stored view that was REORDERED', async () => {
    const res = await validateMetadataDraft('view', REORDERED, undefined, { mode: 'edit' });
    expect(res.issues, JSON.stringify(res.issues)).toEqual([]);
    expect(res.ok).toBe(true);
  });

  /**
   * The nested case is why the gate must be `ViewMetadataSchema` and not the
   * bare `ViewItemWireSchema`: the wire member declares `isPinned`/`sortOrder`
   * at the TOP level, but only `ViewMetadataSchema`'s
   * `z.preprocess(stripViewConsoleDecorations, …)` reaches `config.filter[].id`.
   * A member-level `.strip()` cannot — the spec says so at the union's
   * definition, and it is measurable: `ViewItemWireSchema` rejects this body
   * with `config.filter.0: unrecognized_keys`.
   */
  it('accepts a stored view carrying nested console builder row ids', async () => {
    const res = await validateMetadataDraft('view', PINNED_WITH_BUILDER_ROWS, undefined, {
      mode: 'edit',
    });
    expect(res.issues, JSON.stringify(res.issues)).toEqual([]);
    expect(res.ok).toBe(true);
  });

  it('accepts the aggregated container on the edit path too', async () => {
    const res = await validateMetadataDraft('view', CONTAINER, undefined, { mode: 'edit' });
    expect(res.issues, JSON.stringify(res.issues)).toEqual([]);
    expect(res.ok).toBe(true);
  });

  // ── The edit gate still has teeth ────────────────────────────────────────
  // Widening the door for keys the platform WRITES must not widen it for a
  // body that is actually wrong.

  it('still REJECTS a stored view whose config is wrong', async () => {
    const res = await validateMetadataDraft(
      'view',
      { ...PINNED, config: { type: 'not_a_real_layout', columns: [] } },
      undefined,
      { mode: 'edit' },
    );
    expect(res.ok).toBe(false);
    expect(res.issues.length).toBeGreaterThan(0);
  });

  it('still REJECTS a container carrying an unknown key on the edit path', async () => {
    const res = await validateMetadataDraft(
      'view',
      { ...CONTAINER, notAContainerKey: true },
      undefined,
      { mode: 'edit' },
    );
    expect(res.ok).toBe(false);
    expect(res.issues.length).toBeGreaterThan(0);
  });

  // ── The CREATE path is untouched ─────────────────────────────────────────

  it('keeps REJECTING the same stored keys on the CREATE path', async () => {
    // `createBuildBody` has no business emitting `isPinned`: on the authoring
    // surface these are still unrecognized, exactly as #5074 made them.
    for (const body of [PINNED, REORDERED]) {
      const res = await validateMetadataDraft('view', body, undefined, { mode: 'create' });
      expect(res.ok, JSON.stringify(res.issues)).toBe(false);
      expect(res.issues.length).toBeGreaterThan(0);
    }
  });

  it('defaults to the CREATE gate when no mode is given', async () => {
    // Default-strict: a call site that forgets `mode` gets the authoring gate,
    // so an omission can only ever over-report — never silently widen the door.
    const withMode = await validateMetadataDraft('view', PINNED, undefined, { mode: 'create' });
    const withoutMode = await validateMetadataDraft('view', PINNED);
    expect(withoutMode.ok).toBe(false);
    expect(withoutMode.issues).toEqual(withMode.issues);
  });
});
