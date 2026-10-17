// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// sys_organization's record-header invite (ruling 6228318638, letter B′ on
// #24034, items 1 and 2).
//
// A `page:header`'s `actions` are ids resolved against the page object's OWN
// actions only, so an organization record page could not offer 邀请成员 while
// the invite lived on sys_user / sys_invitation / sys_member alone. The
// endpoint, gates and inputs the four mirrors share are pinned in
// `invite-entry-toolbar.test.ts`, the copy in `invite-user-action-copy.test.ts`;
// this file pins what only this copy has — where it sits in the header.
//
// How the console places record-header actions, measured on objectui `9753811`
// (`packages/components/src/renderers/layout/containers.tsx`, page:header):
// a STABLE sort by `order` (unset = 0), the first non-destructive
// `variant: 'primary'` action promoted to the one filled button, the first
// `maxVisible` (default 3) authored actions inline, the rest folded into the
// `⋯`, destructive ones in its last band. So "invite first, leave in the
// overflow" is decided by the two declared `order` values: with `leave` left
// at 0 it kept the third inline slot by registration order.
import { describe, expect, it } from 'vitest';
import { SysOrganization } from './sys-organization.object.js';

interface HeaderAction {
  name?: string;
  variant?: string;
  order?: number;
  type?: string;
  target?: string;
  recordIdParam?: string;
  locations?: string[];
}

const actions = (): HeaderAction[] =>
  ((SysOrganization as { actions?: HeaderAction[] }).actions) ?? [];

function action(name: string): HeaderAction {
  const found = actions().find((a) => a.name === name);
  expect(found, `${name} is declared`).toBeDefined();
  return found as HeaderAction;
}

/** The object's `record_header` actions, in the order the stable `order` sort gives them. */
function headerOrder(): string[] {
  return actions()
    .filter((a) => (a.locations ?? []).includes('record_header'))
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.order ?? 0) - (y.a.order ?? 0) || x.i - y.i)
    .map(({ a }) => a.name as string);
}

/** objectui page:header's default desktop inline budget. */
const MAX_VISIBLE = 3;

describe('sys_organization.invite_user — the record header (#24016)', () => {
  it('is a record_header api action on the invite endpoint, bound to THIS organization', () => {
    const invite = action('invite_user');
    expect(invite.locations).toContain('record_header');
    expect(invite.type).toBe('api');
    expect(invite.target).toBe('/api/v1/auth/organization/invite-member');
    // The row id rides as `organizationId`: without it better-auth falls back
    // to the caller's ACTIVE org, so an admin on another org's page would
    // invite into the wrong organization.
    expect(invite.recordIdParam).toBe('organizationId');
  });

  it('is the one primary action in the header', () => {
    const primaries = actions()
      .filter((a) => (a.locations ?? []).includes('record_header'))
      .filter((a) => a.variant === 'primary')
      .map((a) => a.name);
    expect(primaries).toEqual(['invite_user']);
  });

  it('sorts first by its declared order', () => {
    expect(action('invite_user').order).toBeLessThan(0);
    expect(headerOrder()[0]).toBe('invite_user');
  });
});

describe('sys_organization.leave_organization — out of the primary slot (#24016)', () => {
  it('stays destructive', () => {
    expect(action('leave_organization').variant).toBe('danger');
  });

  it('sorts last, past the inline budget once the invite leads', () => {
    const order = headerOrder();
    expect(order.length).toBeGreaterThan(MAX_VISIBLE);
    expect(order[order.length - 1]).toBe('leave_organization');
    expect(order.indexOf('leave_organization')).toBeGreaterThanOrEqual(MAX_VISIBLE);
  });
});
