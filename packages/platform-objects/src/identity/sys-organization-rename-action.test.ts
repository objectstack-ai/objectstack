// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// sys_organization's rename door: a name/logo-only action a record page can
// offer.
//
// `update_organization` renames too, but it is declared at `list_item` only (a
// record page's header never offers it) and it bundles `slug`. So the record
// page needs its own door for `name` and `logo`, one that sends no slug.
//
// What this file pins, from source:
//  - the new action's declaration: its params are exactly `name` and `logo`,
//    it sits at `record_header` and `list_item`, it targets better-auth's
//    `organization/update` exactly as `update_organization` does, and it is
//    gated like it: on `multiOrgEnabled` and on the grades that reach
//    `organization/update` (owner, admin);
//  - one door per field on the record header: no `record_header` action that
//    targets `organization/update` carries a `slug` param;
//  - the header order: the rename takes an inline slot and leave sorts last
//    (the ordering model is described in
//    `sys-organization-invite-action.test.ts`);
//  - control: `update_organization` is unchanged, and stays the slug door;
//    the object declares no other (no `change_slug`: its door is the cloud
//    orchestrator's, so the composition that serves it declares it).
//
// The runtime half, a rename through better-auth that reads the slug back
// unchanged, is `organization-rename-door.dogfood.test.ts` in
// `packages/qa/dogfood`.
import { describe, expect, it } from 'vitest';
import { featureGatePredicate } from '@objectstack/spec/kernel';
import { membershipReachPredicate } from '@objectstack/spec/identity';
import { SysOrganization } from './sys-organization.object.js';

interface DeclaredParam {
  field?: string;
  name?: string;
  required?: boolean;
  defaultFromRow?: boolean;
}

interface DeclaredAction {
  name?: string;
  type?: string;
  target?: string;
  method?: string;
  recordIdParam?: string;
  bodyShape?: unknown;
  order?: number;
  locations?: string[];
  visible?: { source?: string };
  params?: DeclaredParam[];
}

const UPDATE_TARGET = '/api/v1/auth/organization/update';

/** objectui page:header's default desktop inline budget. */
const MAX_VISIBLE = 3;

const actions = (): DeclaredAction[] =>
  ((SysOrganization as { actions?: DeclaredAction[] }).actions) ?? [];

function action(name: string): DeclaredAction {
  const found = actions().find((a) => a.name === name);
  expect(found, `${name} is declared`).toBeDefined();
  return found as DeclaredAction;
}

const paramKeys = (a: DeclaredAction): string[] => (a.params ?? []).map((p) => (p.field ?? p.name) as string);

/** The object's `record_header` actions, in the order the stable `order` sort gives them. */
function headerOrder(): string[] {
  return actions()
    .filter((a) => (a.locations ?? []).includes('record_header'))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.order ?? 0) - (y.a.order ?? 0) || x.i - y.i)
    .map(({ a }) => a.name as string);
}

describe('sys_organization.rename_organization: the declaration', () => {
  it('collects exactly `name` (required) and `logo`, both pre-filled from the row, and no `slug`', () => {
    const rename = action('rename_organization');
    expect(paramKeys(rename)).toEqual(['name', 'logo']);
    const [name, logo] = rename.params ?? [];
    expect(name).toMatchObject({ field: 'name', required: true, defaultFromRow: true });
    expect(logo).toMatchObject({ field: 'logo', defaultFromRow: true });
    expect(logo?.required).not.toBe(true);
  });

  it('is offered at the record header and on the list row', () => {
    expect(action('rename_organization').locations).toEqual(['record_header', 'list_item']);
  });

  it("targets better-auth's organization/update exactly as update_organization does", () => {
    const rename = action('rename_organization');
    const update = action('update_organization');
    expect(rename.type).toBe('api');
    expect(rename.target).toBe(UPDATE_TARGET);
    expect(rename.recordIdParam).toBe('organizationId');
    expect(rename.bodyShape).toEqual({ wrap: 'data' });
    expect({ type: rename.type, target: rename.target, method: rename.method, recordIdParam: rename.recordIdParam, bodyShape: rename.bodyShape })
      .toEqual({ type: update.type, target: update.target, method: update.method, recordIdParam: update.recordIdParam, bodyShape: update.bodyShape });
  });

  it('is gated on the update reach and multiOrgEnabled, the same lowered predicate as update_organization', () => {
    const gate = `(${membershipReachPredicate('update_organization')}) && ${featureGatePredicate('multiOrgEnabled')}`;
    expect(action('rename_organization').visible?.source).toBe(gate);
    expect(action('update_organization').visible?.source).toBe(gate);
  });
});

describe('sys_organization: one door per field on the record header', () => {
  it('no record_header action that writes through organization/update collects a slug', () => {
    const headerWriters = actions()
      .filter((a) => (a.locations ?? []).includes('record_header'))
      .filter((a) => a.target === UPDATE_TARGET);
    expect(headerWriters.map((a) => a.name)).toEqual(['rename_organization']);
    for (const a of headerWriters) {
      expect(paramKeys(a), `${a.name} sends a slug to better-auth`).not.toContain('slug');
    }
  });

  it('the rename takes an inline header slot and leave sorts last, into the overflow', () => {
    const order = headerOrder();
    expect(order.indexOf('rename_organization')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('rename_organization')).toBeLessThan(MAX_VISIBLE);
    expect(order.indexOf('leave_organization')).toBeGreaterThanOrEqual(MAX_VISIBLE);
    expect(order[order.length - 1]).toBe('leave_organization');
  });
});

describe('sys_organization: the slug door is unchanged (control)', () => {
  it('update_organization keeps name / slug / logo, its target and list_item alone', () => {
    const update = action('update_organization');
    expect(update.locations).toEqual(['list_item']);
    expect(update.target).toBe(UPDATE_TARGET);
    expect(paramKeys(update)).toEqual(['name', 'slug', 'logo']);
  });

  it('update_organization is the one action that changes an existing slug', () => {
    // `create_organization` collects the new organization's first slug.
    expect(actions().filter((a) => paramKeys(a).includes('slug')).map((a) => a.name))
      .toEqual(['create_organization', 'update_organization']);
  });
});
