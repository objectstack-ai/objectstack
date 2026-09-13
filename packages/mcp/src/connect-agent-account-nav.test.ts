// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #16746 — the Connect-an-Agent page must be reachable by the principal the
// page's own promise is about.
//
// `POST /api/v1/keys` mints a `sys_api_key` bound to the CALLER and the page
// says the key "acts as you". Reached only through Setup it could not keep that
// promise: `SETUP_APP` declares `requiredPermissions: ['setup.access']`, so
// every non-admin following the shipped two-step guide — and the runtime's own
// error text (`plugin.ts`, `README.md`: "mint a key in Setup → Connect an
// Agent") — stopped at step 1 while the endpoint behind the button accepted
// them all along. Maintainer ruling 2026-09-08, option A: open the key card to
// every signed-in user; backend, authorization and the published promise do
// not move.
//
// ---------------------------------------------------------------------------
// What this file pins, and what it deliberately does NOT claim
// ---------------------------------------------------------------------------
// ⚠️ The acceptance criterion is a WIRE fact about two apps — a permissionless
// principal sees `nav_connect_agent` in the `account` app's nav while
// `GET /api/v1/meta/apps/setup` keeps answering 403 PERMISSION_DENIED — and
// that fact cannot be measured from this package: `@objectstack/mcp` declares
// no dependency on `@objectstack/rest` (the RBAC-by-route harness), on
// `@objectstack/objectql` (`SchemaRegistry.applyNavContributions`, the fold) or
// on `@objectstack/platform-objects` (`SETUP_APP` / `ACCOUNT_APP`). ⛔ So this
// file does not reimplement any of them — a second copy of the fold is exactly
// the divergence `cli/src/utils/nav-contribution-groups.ts` refuses to write.
//
// What it pins instead is the half this package OWNS, stated as the two
// properties the wire fact rests on:
//
//   1. the contribution is aimed at the ungated app and group, and carries
//      nothing the server-side nav filter could strip for a permissionless
//      caller (`requiredPermissions` / `requiresService`);
//   2. this bundle cannot widen Setup — the accident that would make a
//      "the entry is visible" assertion pass for the wrong reason.
//
// The second is the load-bearing one. Ungating Setup was measured on the real
// composition and refused: the app-level `setup.access` gate fires BEFORE the
// group gate (so dropping `group_integrations`' gate alone changes nothing),
// and dropping both serves 14+ unrelated Setup surfaces to every signed-in
// user. Nothing in this bundle may reintroduce that, so the walk below asserts
// the bundle declares no permission key anywhere and no `apps` collection that
// could redeclare `SETUP_APP` without its gate.

import { describe, it, expect } from 'vitest';
import { NavigationContributionSchema } from '@objectstack/spec/ui';

import { CONNECT_AGENT_UI_BUNDLE } from './connect-ui.js';

type AnyRec = Record<string, unknown>;

const contributions = CONNECT_AGENT_UI_BUNDLE.navigationContributions as AnyRec[];
const byApp = (app: string): AnyRec[] => contributions.filter((c) => c.app === app);
const itemsOf = (c: AnyRec): AnyRec[] => (c.items ?? []) as AnyRec[];

/** Every key present anywhere in a value, depth-first — objects and arrays. */
function everyKey(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const entry of value) everyKey(entry, out);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      out.push(key);
      everyKey(child, out);
    }
  }
  return out;
}

describe('#16746 — Connect an Agent reaches the per-user Account app', () => {
  it('contributes into the `account` app, into the group that already ships API Keys', () => {
    const account = byApp('account');
    expect(account).toHaveLength(1);
    // `ACCOUNT_APP` declares no `requiredPermissions` (deliberately: every
    // authenticated user must reach their own security surface, RLS scopes the
    // rows), and `grp_account_developer` is the group already carrying
    // `nav_account_api_keys`. Both are read by NAME here — this card edits
    // nothing in `@objectstack/platform-objects`.
    expect(account[0]).toMatchObject({ app: 'account', group: 'grp_account_developer' });
  });

  it('aims one `page` item at `connect_agent`, the page this same bundle registers', () => {
    const items = itemsOf(byApp('account')[0]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'nav_connect_agent',
      type: 'page',
      pageName: 'connect_agent',
    });
    // The destination must be a page this bundle actually ships, or the entry
    // is a 404-when-clicked shown to every signed-in user — the precise defect
    // that ruled out gating an `account.app.ts` entry on `requiresService:
    // 'mcp'` (the service registers unconditionally in `init()`; this bundle
    // registers behind `isMcpServerEnabled()`).
    const pageNames = (CONNECT_AGENT_UI_BUNDLE.pages ?? []).map((p) => p.name);
    expect(pageNames).toContain(items[0].pageName);
  });

  it('carries nothing the per-user caller could be filtered on', () => {
    // THE criterion, stated at the layer this package owns. The server-side
    // nav filter strips an item for a caller missing its `requiredPermissions`
    // and for an absent `requiresService` capability. An entry carrying either
    // would be invisible to exactly the principal this card is about — a
    // permissionless one — while every assertion above still passed.
    const item = itemsOf(byApp('account')[0])[0];
    expect(item).not.toHaveProperty('requiredPermissions');
    expect(item).not.toHaveProperty('requiresService');
    expect(item).not.toHaveProperty('visible');
  });

  it('leaves the Setup entry exactly as it was — admins keep the page where the guide points', () => {
    const setup = byApp('setup');
    expect(setup).toHaveLength(1);
    expect(setup[0]).toMatchObject({ app: 'setup', group: 'group_integrations', priority: 110 });
    expect(itemsOf(setup[0])).toEqual([
      { id: 'nav_connect_agent', type: 'page', pageName: 'connect_agent', label: 'Connect an Agent', icon: 'bot' },
    ]);
  });

  it('⛔ cannot widen Setup — no permission key and no app redeclaration anywhere in the bundle', () => {
    // The risk the green has to prove, not merely pass. A test asserting only
    // "the account entry exists" would go green just as happily on a diff that
    // reached the card by ungating Setup instead — measured to serve 14+
    // unrelated Setup surfaces (Users, Organization, Branding, Feature Flags,
    // …) to every signed-in user. This bundle is the one file that changed, so
    // it is where that accident would have to be written.
    const keys = new Set(everyKey(JSON.parse(JSON.stringify(CONNECT_AGENT_UI_BUNDLE))));
    expect([...keys].filter((k) => k === 'requiredPermissions')).toEqual([]);
    // An `apps: [...]` collection here could redeclare `SETUP_APP` — last
    // registration wins — and drop its `setup.access` gate without touching
    // `platform-objects` at all.
    expect(CONNECT_AGENT_UI_BUNDLE).not.toHaveProperty('apps');
    // Every contribution aims at a named group. A contribution with no `group`
    // appends at the app's TOP level, which for Setup would put the entry
    // outside `group_integrations`' gate.
    for (const c of contributions) expect(typeof c.group).toBe('string');
  });

  it('shares the item id across the two apps, and the fold says that is scoped per app', () => {
    // Answered from the fold rather than from taste, because a wrong answer
    // here is a silent one. `SchemaRegistry` keys contributions by TARGET APP
    // (`appNavContributions: Map<string, …>`) and `applyNavContributions(app)`
    // consults only `get(app.name)`, so a nav item id is unique within ONE
    // app's navigation tree; nothing indexes it across apps (no id-keyed
    // registry, no de-duplication by id), and the translation bundles are
    // keyed `apps.<app>.navigation.<id>`, which makes one shared id two
    // distinct keys. One destination therefore keeps one identity.
    const targets = contributions.map((c) => c.app);
    expect(new Set(targets).size).toBe(targets.length);
    expect(contributions.flatMap((c) => itemsOf(c).map((i) => i.id))).toEqual([
      'nav_connect_agent',
      'nav_connect_agent',
    ]);
    // ⛔ …and they are two literals, not one shared const. The fold
    // `structuredClone`s the APP but pushes `...c.items` BY REFERENCE, so one
    // shared object would sit in two apps' navigation trees at once and any
    // in-place consumer edit would leak from one app into the other.
    expect(itemsOf(byApp('setup')[0])[0]).not.toBe(itemsOf(byApp('account')[0])[0]);
  });

  it('both contributions parse against the real spec contract', () => {
    // The shared id is not merely unenforced — it is accepted by the schema
    // that governs the surface, checked against the spec rather than asserted
    // about it.
    for (const c of contributions) {
      const parsed = NavigationContributionSchema.safeParse(c);
      expect(parsed.error?.issues ?? []).toEqual([]);
      expect(parsed.success).toBe(true);
    }
  });
});
