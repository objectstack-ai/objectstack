// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20051] A flattened list overlay's legacy `options` bag is JUDGED at the
 * view write door, by the same per-kind schemas the direct spelling is judged
 * by — the door half of ruling A on objectui#10380.
 *
 * ## What was measured before the change (`origin/main` @ `8d1f7ab`)
 *
 * The list overlay member is `ListViewShapeSchema.extend(…).strip()`, and
 * `.strip()` dropped a top-level `options` from the parse without looking
 * inside it:
 *
 * - `timeline.metaFields` on a flat overlay ⇒ refused, `unrecognized_keys`
 *   at `timeline`;
 * - the same key as `options.timeline.metaFields` ⇒ ACCEPTED, `options` absent
 *   from the output — and `saveMetaItem` stored the request body with the bag
 *   in it (measured through the real save; the save-door pins live in
 *   `metadata-protocol`'s `protocol.graft-folded-form-sections.test.ts`, whose
 *   engine double they ride, and the `PUT /api/v1/meta/view` pins in `rest`'s
 *   `meta-view-overlay-options-bag.test.ts`).
 *
 * ## What this file pins
 *
 * 1. An out-of-contract key gets the SAME refusal in both spellings — same
 *    code, same keys, same message — and only the path gains the `options`
 *    prefix; a value a key's own schema refuses is refused at that key too.
 *    Asserted for every kind the bag declares, so no kind is judged by
 *    anything but its own block. The underlay is judged KEY BY KEY: a partial
 *    bag (the per-key merge population objectui pins) parses.
 * 2. The bag is closed: `options.foo` is refused by name, not dropped.
 * 3. A legal `options.KIND` still parses and round-trips — including the
 *    legacy `options.map` bag objectui pins
 *    (`InterfaceListPage.mapConfig.test.tsx`, "CONTROL: the legacy
 *    `options.map` bag is still forwarded on its own path").
 * 4. The form overlay cannot accept the bag the list overlay refused (the
 *    column-less fall-through), and says why.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ViewMetadataSchema, VIEW_METADATA_MEMBERS, diagnoseViewMetadata } from './view.zod';

/** A bound flat list overlay — the shape a `PUT /api/v1/meta/view` carries. */
const overlay = (extra: Record<string, unknown> = {}) => ({
  name: 'crm_lead.board',
  object: 'crm_lead',
  viewKind: 'list',
  columns: ['name'],
  ...extra,
});

/** The kinds the bag declares, read off the published member's JSON Schema. */
function declaredBagKinds(): string[] {
  const json = z.toJSONSchema(VIEW_METADATA_MEMBERS.listOverlay as unknown as z.ZodTypeAny, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, { properties?: Record<string, unknown> }>;
  };
  return Object.keys(json.properties?.options?.properties ?? {}).sort();
}

type Issue = { code: string; path: PropertyKey[]; message: string; keys?: string[] };

/** The list overlay's own issues for a body (the branch the body claims). */
function listOverlayIssues(body: unknown): Issue[] {
  const d = diagnoseViewMetadata(body);
  expect(d.success, `expected a refusal for ${JSON.stringify(body)}`).toBe(false);
  if (d.success) return [];
  expect(d.branch).toBe('listOverlay');
  return d.issues as unknown as Issue[];
}

/** Issues under `prefix`, with the prefix removed — for comparing two spellings. */
function under(issues: Issue[], prefix: PropertyKey[]): Array<Omit<Issue, 'path'> & { path: string }> {
  return issues
    .filter((i) => prefix.every((p, n) => i.path[n] === p))
    .map((i) => ({ code: i.code, message: i.message, keys: i.keys, path: i.path.slice(prefix.length).join('.') }))
    .sort((a, b) => `${a.path}|${a.code}`.localeCompare(`${b.path}|${b.code}`));
}

describe('[#20051] the bag declares exactly the list kinds, derived from the shape', () => {
  it('declares one block per list-view kind that has a block — `grid` has none', () => {
    // A pin on the DERIVATION (`listViewKindBlocks`): the list is not
    // hand-maintained in the schema, so it is stated once here, where a new
    // kind shows up as a deliberate one-line edit.
    expect(declaredBagKinds()).toEqual(
      ['calendar', 'chart', 'gallery', 'gantt', 'kanban', 'map', 'timeline', 'tree'],
    );
  });
});

describe('[#20051] a direct and an `options`-wrapped out-of-contract key get the same refusal', () => {
  it('the card\'s headline: `options.timeline.metaFields` is refused by name, as `timeline.metaFields` is', () => {
    const timeline = { startDateField: 'created_at', titleField: 'name', metaFields: ['region'] };
    const direct = listOverlayIssues(overlay({ type: 'timeline', timeline }));
    const wrapped = listOverlayIssues(overlay({ type: 'timeline', options: { timeline } }));

    const directHit = direct.find((i) => i.code === 'unrecognized_keys');
    const wrappedHit = wrapped.find((i) => i.code === 'unrecognized_keys');
    expect(directHit?.path).toEqual(['timeline']);
    expect(wrappedHit?.path).toEqual(['options', 'timeline']);
    expect(wrappedHit?.keys).toEqual(['metaFields']);
    expect(wrappedHit?.keys).toEqual(directHit?.keys);
    // The refusal names the key the author wrote, on the same surface text.
    expect(wrappedHit?.message).toBe(directHit?.message);
    expect(wrappedHit?.message).toContain('`metaFields`');
  });

  it.each(['calendar', 'chart', 'gallery', 'gantt', 'kanban', 'map', 'timeline', 'tree'])(
    '`options.%s` refuses an out-of-contract key with its own block\'s refusal — same code, keys and message',
    (kind) => {
      const block = { zz_not_a_key: 1 };
      const unknownKey = (issues: ReturnType<typeof under>) => issues.filter((i) => i.code === 'unrecognized_keys');
      const direct = unknownKey(under(listOverlayIssues(overlay({ [kind]: block })), [kind]));
      const wrapped = under(listOverlayIssues(overlay({ options: { [kind]: block } })), ['options', kind]);
      expect(direct).toHaveLength(1);
      // The ONLY complaint about the wrapped block is the unknown key — the
      // underlay is judged key by key, so the block's required keys are not
      // asked of it (see the per-key case below).
      expect(wrapped).toEqual(direct);
      expect(wrapped[0]!.keys).toEqual(['zz_not_a_key']);
    },
  );

  it('a value the key\'s own schema refuses is refused at the same key under `options`', () => {
    // `map.zoom` is `min(1).max(20)`: the key-level schema travels with the key.
    const direct = under(listOverlayIssues(overlay({ map: { zoom: 99 } })), ['map']);
    const wrapped = under(listOverlayIssues(overlay({ options: { map: { zoom: 99 } } })), ['options', 'map']);
    expect(wrapped).toEqual(direct);
    expect(wrapped.map((i) => i.path)).toEqual(['zoom']);
  });

  it('the union refuses both spellings — the verdict, not only the diagnosis', () => {
    const timeline = { startDateField: 'created_at', titleField: 'name', metaFields: ['region'] };
    expect(ViewMetadataSchema.safeParse(overlay({ type: 'timeline', timeline })).success).toBe(false);
    expect(ViewMetadataSchema.safeParse(overlay({ type: 'timeline', options: { timeline } })).success).toBe(false);
  });
});

describe('[#20051] the bag itself is closed', () => {
  it('`options.foo` is refused by name at `options`, not dropped', () => {
    const issues = listOverlayIssues(overlay({ options: { foo: 1 } }));
    const hit = issues.find((i) => i.code === 'unrecognized_keys');
    expect(hit?.path).toEqual(['options']);
    expect(hit?.keys).toEqual(['foo']);
    expect(hit?.message).toContain('legacy `options` bag');
  });

  it('`options.grid` is answered with the prescription, not a typo guess', () => {
    const hit = listOverlayIssues(overlay({ options: { grid: {} } })).find((i) => i.code === 'unrecognized_keys');
    expect(hit?.keys).toEqual(['grid']);
    expect(hit?.message).toContain('top-level keys of the view itself');
  });

  it('a non-object bag is refused, not dropped', () => {
    const hit = listOverlayIssues(overlay({ options: 'map' })).find((i) => i.path[0] === 'options');
    expect(hit?.code).toBe('invalid_type');
  });
});

describe('[#20051] a legal `options.KIND` still parses and round-trips', () => {
  it('CONTROL: the legacy `options.map` bag objectui pins is accepted and kept in the parse output', () => {
    // objectui `packages/app-shell/src/views/InterfaceListPage.mapConfig.test.tsx`
    // — "CONTROL: the legacy `options.map` bag is still forwarded on its own
    // path" — at the `.objectui-sha` pin `f8a9d0fb0`.
    const options = { map: { locationField: 'location', titleField: 'legacy_title' } };
    const body = overlay({ name: 'showcase_task.work_map', object: 'showcase_task', type: 'map', columns: ['title', 'location'], options });
    const parsed = ViewMetadataSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(!parsed.success && parsed.error.issues)).toBe(true);
    expect((parsed as { data: { options?: unknown } }).data.options).toEqual(options);
  });

  it('a legal legacy `options.kanban` / `options.calendar` pair round-trips byte-for-byte', () => {
    const options = { kanban: { groupByField: 'status', columns: ['name'] }, calendar: { startDateField: 'created_at' } };
    const parsed = ViewMetadataSchema.safeParse(overlay({ type: 'kanban', options }));
    expect(parsed.success, JSON.stringify(!parsed.success && parsed.error.issues)).toBe(true);
    const out = (parsed as { data: { options?: Record<string, unknown> } }).data.options;
    expect(out).toEqual(options);
    // …and re-parsing the parse output is a fixed point.
    expect(ViewMetadataSchema.safeParse((parsed as { data: unknown }).data)).toMatchObject({ success: true });
  });

  it('a PARTIAL underlay parses — the per-key merge population objectui pins', () => {
    // objectui `ObjectView.namedViewProtocolKeys-8980.test.tsx`: "a key the
    // canonical block does NOT restate survives from the legacy nesting — the
    // merge is per-key, not wholesale". `kanban.groupByField` and
    // `kanban.columns` are REQUIRED on the top-level block; the underlay here
    // carries only the key the top-level block leaves to it.
    const body = overlay({
      type: 'kanban',
      kanban: { groupByField: 'status', columns: ['name'] },
      options: { kanban: { titleField: 'subject' } },
    });
    const parsed = ViewMetadataSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(!parsed.success && parsed.error.issues)).toBe(true);
    // …while the SAME partial block written directly is still refused for the
    // required keys it omits: the top-level block is the one the renderer
    // completes, the underlay is not.
    expect(ViewMetadataSchema.safeParse(overlay({ type: 'kanban', kanban: { titleField: 'subject' } })).success).toBe(false);
  });

  it('CONTROL: an overlay with no `options` parses exactly as before, with no `options` key', () => {
    const parsed = ViewMetadataSchema.safeParse(overlay({ type: 'grid' }));
    expect(parsed.success).toBe(true);
    expect('options' in (parsed as { data: Record<string, unknown> }).data).toBe(false);
  });
});

describe('[#20051] the form overlay cannot take the bag the list overlay refused', () => {
  it('a column-less, type-less body with a bad `options` bag is refused, not accepted as a form', () => {
    // Without the form overlay's `options` pin this body is ACCEPTED: the list
    // member refuses it (no `columns`, and the bag), the form member — which
    // `.strip()`s and requires no list key — takes it, and the bag is stored
    // unjudged after all.
    const body = {
      name: 'crm_lead.all',
      object: 'crm_lead',
      viewKind: 'list',
      sort: [{ field: 'name', order: 'asc' }],
      options: { timeline: { metaFields: ['region'] } },
    };
    expect(ViewMetadataSchema.safeParse(body).success).toBe(false);
    const form = VIEW_METADATA_MEMBERS.formOverlay.safeParse(body);
    expect(form.success).toBe(false);
  });

  it('a flat form overlay carrying `options` is refused with the list-view prescription', () => {
    const body = {
      name: 'lead.contact_us',
      object: 'lead',
      viewKind: 'form',
      type: 'simple',
      options: { kanban: { groupByField: 'status' } },
    };
    const d = diagnoseViewMetadata(body);
    expect(d.success).toBe(false);
    if (d.success) return;
    expect(d.branch).toBe('formOverlay');
    const hit = (d.issues as unknown as Issue[]).find((i) => i.path[0] === 'options');
    expect(hit?.message).toContain('A form view carries no `options` bag');
  });

  it('CONTROL: a flat form overlay without `options` still parses', () => {
    const body = { name: 'lead.contact_us', object: 'lead', viewKind: 'form', type: 'simple' };
    expect(ViewMetadataSchema.safeParse(body).success).toBe(true);
  });
});

/**
 * [#20051] Stage (iv), Q3: the same legacy bag on a ViewItem RECORD
 * (`{ name, object, viewKind, config }`) is refused by name, on both arms, with
 * the prescription to write `config.KIND`. The record member's top-level
 * `.strip()` used to drop it unread; with the save storing the parsed body it
 * would have vanished on a `200` instead.
 */
describe('[#20051] a ViewItem record carries no top-level `options` bag', () => {
  const record = (extra: Record<string, unknown> = {}) => ({
    name: 'crm_lead.board',
    object: 'crm_lead',
    viewKind: 'list',
    config: {
      type: 'kanban',
      data: { provider: 'object', object: 'crm_lead' },
      columns: ['name'],
      kanban: { groupByField: 'stage', columns: ['name'] },
    },
    ...extra,
  });

  function recordIssueAtOptions(body: unknown): Issue {
    const d = diagnoseViewMetadata(body);
    expect(d.success, `expected a refusal for ${JSON.stringify(body)}`).toBe(false);
    if (d.success) throw new Error('unreachable');
    expect(d.branch).toBe('viewItem');
    const hit = (d.issues as unknown as Issue[]).find((i) => i.path.length === 1 && i.path[0] === 'options');
    expect(hit, JSON.stringify(d.issues)).toBeDefined();
    return hit!;
  }

  it('on the list arm: refused at `options`, prescribing `config.KIND`', () => {
    const hit = recordIssueAtOptions(record({ options: { kanban: { groupByField: 'stage' } } }));
    expect(hit.message).toMatch(/^A view item record carries no top-level `options` bag/);
    expect(hit.message).toContain('Move each `options.KIND` block to `config.KIND`');
    expect(VIEW_METADATA_MEMBERS.viewItem.safeParse(record({ options: {} })).success).toBe(false);
  });

  it('on the form arm too', () => {
    const hit = recordIssueAtOptions({
      name: 'lead.contact_us',
      object: 'lead',
      viewKind: 'form',
      config: { type: 'simple', data: { provider: 'object', object: 'lead' } },
      options: { timeline: { titleField: 'name' } },
    });
    expect(hit.message).toMatch(/^A view item record carries no top-level `options` bag/);
  });

  it('CONTROL: the record without the bag parses, and `config.kanban` is where the block lives', () => {
    const parsed = ViewMetadataSchema.safeParse(record());
    expect(parsed.success).toBe(true);
  });
});
