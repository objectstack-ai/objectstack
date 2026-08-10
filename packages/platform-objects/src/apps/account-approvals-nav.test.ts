// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The account app's Approvals entry points at the Approvals Inbox COMPONENT,
// not at the raw `sys_approval_request` grid (#7234, entry C of #7213).
//
// Why this needs a pin rather than a code comment: the two shapes are one
// keyword apart and both parse. `type: 'object'` renders a perfectly healthy
// list of the engine's own table — which is exactly the defect. Every one of
// `sys_approval_request`'s eight decision actions is gated on
// `record.viewer.can_act || record.viewer.can_override`, and the `viewer` block
// is attached ONLY by the approvals REST path (`approval-service.ts`,
// `attachViewers()`), never by the generic data API the object route uses. So
// the object destination is a read-only wall of rows an approver cannot act on,
// and it LOOKS fine. A regression back to it would show up in no other test.
//
// The gate half is verified where it is implemented, not re-implemented here:
// `packages/rest/src/meta-app-area-nav-gate.test.ts` pins that `filterNav`
// strips a `type: 'component'` item whose `requiresService` names an absent
// service — variant-agnostic, which is what makes `requiresService` usable on a
// component item at all.
import { describe, it, expect } from 'vitest';
import { AppSchema } from '@objectstack/spec/ui';

import { ACCOUNT_APP } from './account.app.js';

type NavItem = {
  id?: string;
  type?: string;
  label?: string;
  objectName?: string;
  viewName?: string;
  componentRef?: string;
  requiresObject?: string;
  requiresService?: string;
  children?: NavItem[];
};

/** Every nav item in the account app, depth-first. */
const allNavItems = (): NavItem[] => {
  const out: NavItem[] = [];
  const walk = (items: NavItem[] = []) => {
    for (const item of items) {
      if (!item) continue;
      out.push(item);
      if (Array.isArray(item.children)) walk(item.children);
    }
  };
  walk((ACCOUNT_APP.navigation ?? []) as NavItem[]);
  return out;
};

const approvalsEntry = (): NavItem => {
  const item = allNavItems().find((i) => i.id === 'nav_account_approvals');
  expect(item, 'the account app lost its nav_account_approvals entry').toBeDefined();
  return item as NavItem;
};

describe("the account app's Approvals entry targets the inbox component (#7234)", () => {
  it('routes to the `approvals:inbox` registry key', () => {
    expect(approvalsEntry()).toMatchObject({
      type: 'component',
      componentRef: 'approvals:inbox',
    });
  });

  it('addresses a registry KEY, never a console path', () => {
    // objectui#2763's boundary: nav metadata names a component-registry key and
    // the console owns the URL it resolves to (`approvals:inbox` →
    // `/apps/{app}/component/approvals/inbox`, objectui#4071). A `/`-shaped ref
    // here would be this package reaching across that line and would silently
    // survive every schema check — `componentRef` is a free string, and
    // `validate-nav-target-refs` deliberately does not resolve component refs
    // (an unregistered ref is a NON-rule there: the registry is not visible to
    // the linter).
    const ref = approvalsEntry().componentRef ?? '';
    expect(ref).toMatch(/^[a-z0-9_-]+:[a-z0-9_-]+$/);
    expect(ref).not.toContain('/');
  });

  it('no longer routes to the raw sys_approval_request table', () => {
    const entry = approvalsEntry();
    expect(entry.objectName).toBeUndefined();
    expect(entry.viewName).toBeUndefined();
    // `requiresObject` is the object-route gate; a component item has no object
    // route to gate, so leaving it behind would be a dead key that reads as one.
    expect(entry.requiresObject).toBeUndefined();
  });

  it('gates on the approvals SERVICE, which is what backs the inbox', () => {
    // `plugin-approvals` does `ctx.registerService('approvals', …)` in start().
    // Without a gate the entry would render a dead component route on any
    // deployment that does not install the plugin — the "dead-quiet entry"
    // failure. `requiresService` is stripped server-side by `filterAppForUser`
    // (ADR-0057 D10), so a gated-off entry never reaches the browser.
    expect(approvalsEntry().requiresService).toBe('approvals');
  });

  it('keeps its label and icon — the entry point does not move', () => {
    // Only the DESTINATION changes. The label is load-bearing beyond this file:
    // `plugin-approvals`' approval-status-vocabulary.test.ts ties the
    // `my_pending` view label to this entry's per-locale label (#7232/#7271), so
    // rewording it here turns that cross-package parity case red.
    expect(approvalsEntry()).toMatchObject({ label: 'Approvals', icon: 'check-circle' });
  });

  it('surfaces sys_approval_request raw NOWHERE in the account app', () => {
    // The acceptance criterion in its own words: the engine-owned table is an
    // admin/diagnostic surface reachable only under Setup, behind
    // `group_approvals`' `manage_platform_settings` gate. The account app
    // deliberately declares no `requiredPermissions` (every authenticated user
    // needs it for sessions / API keys), so anything it lists is listed for
    // everyone — which is why this is asserted over the whole tree and not just
    // over the one entry above.
    const raw = allNavItems().filter((i) => i.objectName === 'sys_approval_request');
    expect(raw.map((i) => i.id)).toEqual([]);
  });

  it('the whole app still satisfies AppSchema with the component item', () => {
    expect(() => AppSchema.parse(ACCOUNT_APP)).not.toThrow();
  });
});
