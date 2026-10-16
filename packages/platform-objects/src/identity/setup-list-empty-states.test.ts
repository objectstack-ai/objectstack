// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup's Invitations, API Keys and OAuth Applications lists draw their OWN
 * empty state, and API Keys offers the key-creation entry its empty state names.
 *
 * ## What the console drew before
 *
 * The console renders a list view's authored `emptyState` first and falls back
 * only when the view declares none (objectui `ObjectView`: the view's
 * `emptyState`, else the `managedBy` fallback). These three objects are
 * `managedBy: 'better-auth'`, so with no declaration every list read "No
 * identity records — these records are created by the authentication provider
 * … not added by hand here", which is false for all three: invitations are sent
 * from Invite User, keys are created by hand, applications are registered.
 *
 * ## What is pinned, and at which layer
 *
 * Metadata only. That objectui draws a declared `emptyState` is objectui's to
 * pin; what this package owns is that every list view of the three objects
 * declares one, that each filtered view's copy is its own (a filtered view that
 * says "No invitations yet" reads as "nobody was ever invited" while there are
 * accepted ones), and that the copy reaches every locale bundle this package
 * ships. The population is each object's declared views, so a view added later
 * is held to the same rule with no edit here.
 *
 * API Keys' `create_api_key` is pinned for the facts that decide whether it
 * works: it is offered on the list toolbar, it calls the one mint route
 * (`POST /api/v1/keys`, whose raw key is revealed by the `resultDialog` that
 * `two-factor-one-shot-reveal.test.ts` requires of every action on that
 * route), its param names a real field, and it reopens no data-API door.
 */

import { describe, expect, it } from 'vitest';
import type { Action } from '@objectstack/spec/ui';
import { SysApiKey, SysInvitation, SysOauthApplication } from './index.js';
import { enObjects } from '../apps/translations/en.objects.generated.js';
import { zhCNObjects } from '../apps/translations/zh-CN.objects.generated.js';
import { jaJPObjects } from '../apps/translations/ja-JP.objects.generated.js';
import { esESObjects } from '../apps/translations/es-ES.objects.generated.js';

interface ViewLike {
  label?: unknown;
  filter?: unknown;
  emptyState?: { title?: unknown; message?: unknown };
}

interface ObjectLike {
  name: string;
  listViews?: Record<string, ViewLike>;
  fields: Record<string, unknown>;
  actions?: Action[];
  enable?: { apiMethods?: string[] };
}

const OBJECTS = [SysInvitation, SysApiKey, SysOauthApplication] as unknown as ObjectLike[];

const TRANSLATED_BUNDLES = { 'zh-CN': zhCNObjects, 'ja-JP': jaJPObjects, 'es-ES': esESObjects } as const;

function views(def: ObjectLike): Array<[string, ViewLike]> {
  return Object.entries(def.listViews ?? {});
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

describe('Setup identity lists declare their own empty state', () => {
  it('the population is live: each object ships list views', () => {
    for (const def of OBJECTS) {
      expect(views(def).length, `${def.name} declares no list views`).toBeGreaterThan(0);
    }
  });

  it.each(OBJECTS.map((def) => [def.name, def] as const))(
    '%s: every list view declares an empty-state title and message',
    (_name, def) => {
      for (const [viewName, view] of views(def)) {
        const where = `${def.name}.listViews.${viewName}`;
        expect(nonEmptyString(view.emptyState?.title), `${where} declares no emptyState.title`).toBe(true);
        expect(nonEmptyString(view.emptyState?.message), `${where} declares no emptyState.message`).toBe(true);
      }
    },
  );

  it.each(OBJECTS.map((def) => [def.name, def] as const))(
    '%s: no two views share an empty-state title (a filtered view names itself)',
    (_name, def) => {
      const titles = views(def).map(([, view]) => view.emptyState?.title);
      expect(new Set(titles).size, `${def.name} repeats an empty-state title across views`).toBe(titles.length);
    },
  );

  it("Invitations' Pending view — the one Setup opens first — says there are no pending invitations", () => {
    // The card's acceptance names this exact text, so it is pinned here.
    expect(SysInvitation.listViews?.pending?.emptyState?.title).toBe('No pending invitations');
  });

  it.each(OBJECTS.map((def) => [def.name, def] as const))(
    '%s: the en bundle carries each view\'s empty-state copy as declared',
    (name, def) => {
      const bundleViews = (enObjects as Record<string, { _views?: Record<string, ViewLike> }>)[name]?._views ?? {};
      for (const [viewName, view] of views(def)) {
        expect(bundleViews[viewName]?.emptyState, `en: ${name}._views.${viewName}.emptyState`).toEqual({
          title: view.emptyState?.title,
          message: view.emptyState?.message,
        });
      }
    },
  );

  it.each(Object.keys(TRANSLATED_BUNDLES))('the %s bundle carries every view\'s empty-state copy', (locale) => {
    const bundle = TRANSLATED_BUNDLES[locale as keyof typeof TRANSLATED_BUNDLES] as Record<
      string,
      { _views?: Record<string, ViewLike> }
    >;
    for (const def of OBJECTS) {
      for (const [viewName] of views(def)) {
        const leaf = bundle[def.name]?._views?.[viewName]?.emptyState;
        const where = `${locale}: ${def.name}._views.${viewName}.emptyState`;
        expect(nonEmptyString(leaf?.title), `${where}.title`).toBe(true);
        expect(nonEmptyString(leaf?.message), `${where}.message`).toBe(true);
      }
    }
  });
});

describe('API Keys: Create Key through the existing mint route', () => {
  const actions = (SysApiKey.actions ?? []) as Action[];
  const create = actions.find((a) => a.name === 'create_api_key');

  it('is declared as a primary list-toolbar action', () => {
    expect(create, 'sys_api_key declares no create_api_key action').toBeDefined();
    expect(create?.locations).toEqual(['list_toolbar']);
    expect(create?.variant).toBe('primary');
    expect(nonEmptyString(create?.label)).toBe(true);
  });

  it('calls POST /api/v1/keys, the one route that mints a key and answers its secret', () => {
    expect(create?.type).toBe('api');
    expect(create?.method ?? 'POST').toBe('POST');
    expect(create?.target).toBe('/api/v1/keys');
  });

  it('reveals the raw key in a result dialog, masked', () => {
    // The route answers `{ success, data: { key, … } }`; the console unwraps
    // `data` before resolving these paths, so the path is `key`, not `data.key`.
    expect(create?.resultDialog?.fields).toEqual([
      expect.objectContaining({ path: 'key', format: 'secret' }),
    ]);
  });

  it('collects only what the route reads, from a field the object really has', () => {
    // The route whitelists `name` and an optional `expires_at`; anything else
    // in the body is ignored, so a param outside that pair would be a control
    // that silently does nothing.
    const params = create?.params ?? [];
    for (const param of params) {
      const key = param.name ?? param.field;
      expect(['name', 'expires_at'], `param '${key}' is not read by POST /api/v1/keys`).toContain(key);
      if (param.field) {
        expect(SysApiKey.fields, `param field '${param.field}' is not a sys_api_key field`).toHaveProperty(param.field);
      }
    }
    expect(params.map((p) => p.name ?? p.field)).toContain('name');
  });

  it('reopens no data-API create door: minting stays on the mint route', () => {
    expect(SysApiKey.enable?.apiMethods).not.toContain('create');
  });

  it('the empty states that point at Create Key name the action by its label', () => {
    // A rename of the action that left these messages behind would point an
    // empty list at a button that no longer exists.
    for (const viewName of ['all_keys', 'mine'] as const) {
      const message = SysApiKey.listViews?.[viewName]?.emptyState?.message;
      expect(String(message), `sys_api_key.listViews.${viewName}`).toContain(String(create?.label));
    }
  });
});
