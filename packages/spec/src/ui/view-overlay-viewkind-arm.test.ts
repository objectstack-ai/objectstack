// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20186 — a flattened `view` overlay is judged by the arm its `viewKind`
 * names, and by no other.
 *
 * ## The defect
 *
 * The two flattened overlay members of {@link ViewMetadataSchema} shared one
 * `viewKind: 'list' | 'form'` enum. The list member required `columns`, so it
 * refused a column-less `viewKind: 'list'` body; the union then tried the form
 * member, which requires no list key and `.strip()`s every one, and ACCEPTED
 * it. `diagnoseViewMetadata` named `formOverlay`, the parse output was
 * `type: 'simple'` (a form), and the body's `sort`, `searchableFields` and
 * `timeline` were never judged — the write door stored a retired `sort` string
 * and a `timeline.metaFields` the list schema refuses by name. The mirror held
 * too: the list member accepted a `viewKind: 'form'` body carrying list
 * `columns`.
 *
 * ## The ruled route (C-prime, seat answers 5855433719 / 5855548706 on #20186)
 *
 * - The form member admits `viewKind: 'form'` only; the list member `'list'`
 *   only.
 * - The flattened LIST member judges a column-less PATCH — the ruled storage
 *   shape of every console toolbar save (maintainer ruling on #7494,
 *   「`persistViewPatch` 只存 patch,不存 merged base」): `columns` is optional
 *   there, and only there. The authoring `ListViewSchema` keeps it required.
 * - A column-less list overlay that NAMES a `type` is a full inline config
 *   missing its columns, and stays refused — now at `columns`, with a
 *   prescription.
 *
 * ## What is declared, not discovered
 *
 * Two classes of column-less, type-less `viewKind: 'list'` bodies go from
 * refused to accepted (`Clause-②: yes (narrowing)`):
 *
 * - **W2** — a list-legal value under a key both arms declare with different
 *   schemas (`aria`, an i18n `description`, list-style `sharing`, a valid
 *   legacy `options` bag). The form arm
 *   used to judge those keys by FORM rules; the list arm now judges them by the
 *   list rules they belong to. Pinned ACCEPT below: it is the ruling working.
 * - **W1** — an invalid value under a form-only key (`layout: 'diagonal'`),
 *   which the list member drops unread, exactly as it already drops it on a
 *   list overlay WITH `columns`. ⛔ Deliberately NOT pinned here as desired
 *   behaviour: it is a named same-family residual (the PR's acceptance notes),
 *   not a contract.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  VIEW_METADATA_MEMBERS,
  ViewMetadataSchema,
  diagnoseViewMetadata,
} from './view.zod';

const ID = { name: 'crm_lead.all', object: 'crm_lead' } as const;
const LIST = { ...ID, viewKind: 'list' } as const;
const FORM = { ...ID, viewKind: 'form' } as const;

/** The refused body's union envelope AND its branch diagnosis. */
function refusal(body: unknown) {
  const parsed = ViewMetadataSchema.safeParse(body);
  expect(parsed.success, 'the union must refuse this body').toBe(false);
  const diagnosis = diagnoseViewMetadata(body);
  expect(diagnosis.success).toBe(false);
  if (parsed.success || diagnosis.success) throw new Error('unreachable');
  return {
    topCodes: [...new Set(parsed.error.issues.map((i) => i.code))],
    branch: diagnosis.branch,
    issues: diagnosis.issues,
  };
}

/** The accepted body's parse output AND the branch that accepted it. */
function acceptance(body: unknown) {
  const parsed = ViewMetadataSchema.safeParse(body);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  const diagnosis = diagnoseViewMetadata(body);
  expect(diagnosis.success).toBe(true);
  return { data: parsed.data as Record<string, unknown>, branch: diagnosis.branch };
}

describe('a column-less list PATCH is judged by the list member', () => {
  it('the headline `{ name, object, viewKind: list, sort }` is ACCEPTED on listOverlay and parses to a LIST', () => {
    const { data, branch } = acceptance({ ...LIST, sort: [{ field: 'name', order: 'asc' }] });
    expect(branch).toBe('listOverlay');
    // Not `type: 'simple'` — the form member's default, which is what a lean
    // list body parsed to while the form member was the one accepting it.
    expect(data.type).toBe('grid');
    expect(data.sort).toEqual([{ field: 'name', order: 'asc' }]);
  });

  // The objectui producer: `buildPersistedViewBody` stores `{ ...patch,
  // viewKind }`, and `updateViewConfig` stamps `object`, `name` and the overlay
  // marker. One body per toolbar path the console persists.
  it.each([
    ['sort', { sort: [{ field: 'name', order: 'desc' }] }],
    ['hiddenFields', { hiddenFields: ['email'] }],
    ['inlineEdit', { inlineEdit: true }],
    ['columnState', { columnState: { widths: { name: 120 } } }],
    ['rowHeight', { rowHeight: 'compact' }],
  ])('the console %s toggle (a patch-only write, as ruled) is ACCEPTED on listOverlay', (_label, patch) => {
    const { branch, data } = acceptance({ ...patch, viewKind: 'list', ...ID, _isOverride: true });
    expect(branch).toBe('listOverlay');
    expect(data.type).toBe('grid');
  });
});

describe('…and its list keys are JUDGED, not stripped', () => {
  it('a retired bare-string `sort` is REFUSED at `sort`, with the 17.5.0 retirement prescription', () => {
    const r = refusal({ ...LIST, sort: 'name desc' });
    expect(r.topCodes).toEqual(['invalid_union']);
    expect(r.branch).toBe('listOverlay');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: 'invalid_type', path: ['sort'] });
    expect(r.issues[0]!.message).toContain('The bare string `sort` clause was removed from `view.sort` in @objectstack/spec 17.5.0');
  });

  it('the `timeline.metaFields` twin is REFUSED at `timeline`, naming the key', () => {
    const r = refusal({ ...LIST, timeline: { startDateField: 'created', titleField: 'name', metaFields: ['region'] } });
    expect(r.topCodes).toEqual(['invalid_union']);
    expect(r.branch).toBe('listOverlay');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: 'unrecognized_keys', path: ['timeline'], keys: ['metaFields'] });
    expect(r.issues[0]!.message).toContain('Unrecognized key(s) on this timeline configuration: `metaFields`.');
  });

  it('a non-array `searchableFields` is REFUSED at `searchableFields`', () => {
    const r = refusal({ ...LIST, searchableFields: 'name' });
    expect(r.topCodes).toEqual(['invalid_union']);
    expect(r.branch).toBe('listOverlay');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: 'invalid_type', path: ['searchableFields'], expected: 'array' });
  });

  it('a form-style `sharing` on a list body is REFUSED at `sharing` — list sharing is judged by list rules now', () => {
    const r = refusal({ ...LIST, sharing: { enabled: true } });
    expect(r.topCodes).toEqual(['invalid_union']);
    expect(r.branch).toBe('listOverlay');
    expect(r.issues[0]).toMatchObject({ code: 'unrecognized_keys', path: ['sharing'] });
  });
});

describe('a column-less list overlay that NAMES a `type` stays refused — at `columns`', () => {
  // `overlay.list.identity` in `view-union-diagnostics.test.ts`: refused before,
  // refused now, and still wrapped as `invalid_union` (the refusal is an
  // ABORTING issue, so the list member is not the union's lone survivor).
  it.each([
    ['a kanban config with no columns', { name: 'x', object: 'crm_lead', viewKind: 'list', type: 'kanban', groupByField: 'stage' }],
    ['a grid config with no columns', { ...LIST, type: 'grid', sort: [{ field: 'name', order: 'asc' }] }],
  ])('%s', (_label, body) => {
    const r = refusal(body);
    expect(r.topCodes).toEqual(['invalid_union']);
    expect(r.branch).toBe('listOverlay');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: 'custom', path: ['columns'] });
    expect(r.issues[0]!.message).toMatch(/^This list view overlay sets `type` but lists no `columns`\./);
    // Pasteable: it names both ways out.
    expect(r.issues[0]!.message).toContain('add `columns: ["field_a", "field_b"]`');
    expect(r.issues[0]!.message).toContain('remove `type` to save this body as a patch');
  });
});

describe('the mirror: a `viewKind: form` body is judged by the form member', () => {
  it('list `columns` on a form overlay is REFUSED under formOverlay, at `columns`, with the count prescription', () => {
    const r = refusal({ ...FORM, columns: ['name'] });
    expect(r.topCodes).toEqual(['invalid_union']);
    expect(r.branch).toBe('formOverlay');
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0]).toMatchObject({ code: 'invalid_type', path: ['columns'] });
    expect(r.issues[0]!.message).toMatch(/^On a form view `columns` is the NUMBER of body columns/);
    expect(r.issues[0]!.message).toContain('set `viewKind: "list"`');
  });

  it('…while a form body-column COUNT is still accepted (the form schema\'s own constraints, unchanged)', () => {
    expect(acceptance({ ...FORM, columns: 2 }).branch).toBe('formOverlay');
    const r = refusal({ ...FORM, columns: 0 });
    expect(r.issues[0]).toMatchObject({ code: 'too_small', path: ['columns'] });
  });
});

describe('W2 — a list-legal value under a key both arms declare differently is ACCEPTED', () => {
  // Refused before: the form member judged these keys by FORM rules (a retired
  // `aria` tombstone, a string-only `description`, a public-link `sharing`).
  // Declared as a widening: `Clause-②: yes (narrowing)`.
  it.each([
    ['`aria` (the list view ARIA block; the form arm carries a retirement tombstone)', { aria: { ariaLabel: 'Leads' } }],
    ['an i18n `description` (the form arm takes a plain string only)', { description: { en: 'All leads' } }],
    ['list-style `sharing` (the form arm\'s is the public-link block)', { sharing: { type: 'personal' } }],
    ['a valid legacy `options` bag (the form arm pins `options` absent)', { options: { map: { locationField: 'address' } } }],
  ])('%s', (_label, extra) => {
    expect(acceptance({ ...LIST, ...extra }).branch).toBe('listOverlay');
  });
});

describe('controls — byte-identical parse output (measured on origin/main ce70876e)', () => {
  it('a real form overlay', () => {
    const { data, branch } = acceptance({
      name: 'acct.f', object: 'account', viewKind: 'form', type: 'simple', sections: [{ label: 'Main', fields: ['name'] }],
    });
    expect(branch).toBe('formOverlay');
    expect(JSON.stringify(data)).toBe(
      '{"type":"simple","sections":[{"label":"Main","collapsible":false,"collapsed":false,"columns":1,"fields":["name"]}],'
      + '"name":"acct.f","object":"account","viewKind":"form"}',
    );
  });

  it('a list overlay WITH `columns` (and no `type` — the default still lands in its own key position)', () => {
    const { data, branch } = acceptance({
      name: 'acct.c', object: 'account', viewKind: 'list', columns: ['name'], sort: [{ field: 'name', order: 'asc' }],
    });
    expect(branch).toBe('listOverlay');
    expect(JSON.stringify(data)).toBe(
      '{"name":"acct.c","type":"grid","columns":["name"],"sort":[{"field":"name","order":"asc"}],"object":"account","viewKind":"list"}',
    );
  });
});

describe('each member judges ONE viewKind — read off the members themselves', () => {
  it('a direct parse of the form member names where a list body is judged', () => {
    const r = VIEW_METADATA_MEMBERS.formOverlay.safeParse({ ...LIST, sort: [{ field: 'name', order: 'asc' }] });
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path[0] === 'viewKind');
    expect(issue?.message).toMatch(/^This is the flattened FORM overlay member, which judges `viewKind: "form"` only\./);
    expect(issue?.message).toContain('`VIEW_METADATA_MEMBERS.listOverlay`');
  });

  it('…and the list member refuses a form body the same way', () => {
    const r = VIEW_METADATA_MEMBERS.listOverlay.safeParse({ ...FORM, columns: ['name'] });
    expect(r.success).toBe(false);
    const issue = r.error!.issues.find((i) => i.path[0] === 'viewKind');
    expect(issue?.message).toMatch(/^This is the flattened LIST overlay member, which judges `viewKind: "list"` only\./);
  });

  it('an ABSENT viewKind keeps the binding prescription, on both members', () => {
    for (const member of [VIEW_METADATA_MEMBERS.listOverlay, VIEW_METADATA_MEMBERS.formOverlay]) {
      const r = member.safeParse({ object: 'crm_lead', hidden: true });
      const issue = r.error!.issues.find((i) => i.path[0] === 'viewKind');
      expect(issue?.message).toContain('This inline view config names no `viewKind`');
    }
  });
});

describe('the premise: no pipe, and the served JSON Schema moves only by the contract', () => {
  it('both overlay members are still plain object schemas', () => {
    // A pipe serves its INPUT side to `/api/v1/meta/types/view`, and for a
    // transform that is `{}` (the `assertViewIdentity` docblock). The input-side
    // refusal and the default are both CHECKS on the object instead.
    expect((VIEW_METADATA_MEMBERS.listOverlay as unknown as { _zod: { def: { type: string } } })._zod.def.type).toBe('object');
    expect((VIEW_METADATA_MEMBERS.formOverlay as unknown as { _zod: { def: { type: string } } })._zod.def.type).toBe('object');
  });

  it.each(['input', 'output'] as const)('the %s JSON Schema: four members, one viewKind per overlay arm, list `type` default kept', (io) => {
    const json = z.toJSONSchema(ViewMetadataSchema, { unrepresentable: 'any', io }) as {
      anyOf: Array<{ properties: Record<string, { enum?: unknown[]; default?: unknown }>; required?: string[] }>;
    };
    expect(json.anyOf).toHaveLength(4);
    const [, , list, form] = json.anyOf;
    expect(list!.properties.viewKind!.enum).toEqual(['list']);
    expect(form!.properties.viewKind!.enum).toEqual(['form']);
    expect(list!.properties.type!.default).toBe('grid');
    expect(list!.required).not.toContain('columns');
    expect(list!.required).toEqual(expect.arrayContaining(['object', 'viewKind']));
  });
});
