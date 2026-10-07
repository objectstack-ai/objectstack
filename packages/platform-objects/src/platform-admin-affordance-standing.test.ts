// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every first-party action whose door runs the platform-admin gate is OFFERED
 * only to the standing that door admits — the enumeration pin for the
 * "affordance offered that its door refuses" family.
 *
 * ## The rule
 *
 * An action whose target endpoint runs the ADR-0068 platform-admin gate answers
 * every other caller — org owners, org admins, delegated admins, members — 403
 * `PERMISSION_DENIED`. Offering that action to them is a button that can only
 * fail. So its served `visible` must carry `current_user.isPlatformAdmin ==
 * true`: the ADR-0095 D3 PLATFORM_ADMIN posture rung that the session payload
 * emits and the gate judges (ADR-0068 D4). ⛔ Never `'platform_admin' in
 * current_user.positions`: `EvalUserSchema` rules that standing is read from
 * the key, never from the array, and a tenant can write a position by that name.
 *
 * ## The population is derived, not listed
 *
 * Every `*.object.ts` under `packages/` is imported and every action on every
 * exported object is judged, so an action added anywhere tomorrow is held to the
 * rule with no edit here — it fails until its `visible` carries the standing.
 * The walk, its scaffolding-template exclusion and its cross-package
 * declaration are the ones `managed-api-method-affordance-sweep.test.ts` already
 * uses for the same population.
 *
 * ## The oracle: which doors are platform-admin gated
 *
 * plugin-auth exposes no structural marker for it — no exported mount table, no
 * gate field on its route ledger rows (their notes say it in prose) — and this
 * package may not depend on plugin-auth. So the oracle is the narrowest honest
 * form, read off the mounts in `auth-plugin.ts`:
 *
 *  - the `/api/v1/auth/admin/` namespace: every ObjectStack mount in it runs
 *    `gateAdmin` / `judgePlatformAdmin` first, and `/admin/impersonate-user` is
 *    re-authorized on the same standing inside better-auth;
 *  - minus the two routes in that namespace that do NOT refuse below platform
 *    admin, named below with the reason each one admits someone else;
 *  - plus `/api/v1/auth/organization/add-member`, the one gated mount outside
 *    the namespace.
 *
 * What it misses, stated rather than discovered later: a platform-admin-gated
 * mount added OUTSIDE the namespace (it must be named here); a door gated on a
 * CAPABILITY rather than the rung (datasource admin routes ask for
 * `manage_platform_settings` and are deliberately not this family); routes
 * served by another repository (`/api/v1/cloud/**`); and actions that are not
 * declared on an object file (metadata-type actions registered at runtime).
 * The better-auth-native routes in the namespace still judge the legacy `role`
 * scalar and refuse a platform admin too; the standing is the floor of who can
 * be offered such an action, not a promise the vendor admits them.
 *
 * ## How it evaluates
 *
 * Both halves, for every member: the served predicate is evaluated with
 * `@objectstack/formula`'s `celEngine` with `current_user` bound the way the
 * console binds it — the whole scope handed to the engine as `extra`, one
 * subject under `current_user` / `user` / `ctx.user` / `os.user`, `features`
 * beside it — and ⛔ not through `user:`, under which the engine re-derives
 * `isPlatformAdmin` from `positions`. No principal without the rung is offered
 * the action on any row; the principal with it is offered it on some row.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { celEngine } from '@objectstack/formula';

/** The standing, spelled as the ruling fixed it. */
const STANDING = 'current_user.isPlatformAdmin == true';

/** Seeded from `__dirname` for the reasons the managed-api-method sweep records. */
const HERE = __dirname;
/** …/packages/platform-objects/src → repo root */
const REPO_ROOT = resolve(HERE, '../../..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');

/** Object files that are templates for a generated project, not definitions this repo boots. */
const SCAFFOLDING_TEMPLATES: readonly string[] = [
  'packages/create-objectstack/src/templates/blank/src/objects/note.object.ts',
];

const ADMIN_NAMESPACE = '/api/v1/auth/admin/';

/** Routes inside the namespace whose door does NOT refuse below platform admin. */
const NAMESPACE_ROUTES_ADMITTING_OTHERS: Readonly<Record<string, string>> = {
  '/api/v1/auth/admin/has-permission':
    'a permission QUERY: every signed-in caller gets an answer, a plain member its own negative',
  '/api/v1/auth/admin/stop-impersonating':
    'admits the IMPERSONATED session, which by construction is not a platform admin',
};

/** Platform-admin-gated mounts outside the namespace, each named. */
const GATED_OUTSIDE_NAMESPACE: readonly string[] = ['/api/v1/auth/organization/add-member'];

function isPlatformAdminGatedDoor(target: string): boolean {
  if (GATED_OUTSIDE_NAMESPACE.includes(target)) return true;
  return target.startsWith(ADMIN_NAMESPACE) && !Object.hasOwn(NAMESPACE_ROUTES_ADMITTING_OTHERS, target);
}

/** Every `*.object.ts` under `packages/`, skipping build output, deps and tests. */
function walkObjectFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) walkObjectFiles(full, out);
    else if (entry.endsWith('.object.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

interface FirstPartyAction {
  /** `<object name>.<action name>` */
  site: string;
  file: string;
  target: string;
  /** The served (parsed) predicate's CEL source, or undefined when none is declared. */
  source: string | undefined;
}

function sourceOf(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof (raw as { source?: unknown }).source === 'string') {
    return (raw as { source: string }).source;
  }
  return undefined;
}

async function loadActions(): Promise<{ files: number; actions: FirstPartyAction[] }> {
  const files = walkObjectFiles(PACKAGES_DIR).filter(
    (f) => !SCAFFOLDING_TEMPLATES.includes(relative(REPO_ROOT, f)),
  );
  const actions: FirstPartyAction[] = [];
  for (const file of files) {
    const mod: Record<string, unknown> = await import(file);
    for (const value of Object.values(mod)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const def = value as { name?: unknown; actions?: unknown };
      if (typeof def.name !== 'string' || !Array.isArray(def.actions)) continue;
      for (const action of def.actions as Array<Record<string, unknown>>) {
        if (typeof action.target !== 'string') continue;
        actions.push({
          site: `${def.name}.${String(action.name)}`,
          file: relative(REPO_ROOT, file),
          target: action.target,
          source: sourceOf(action.visible),
        });
      }
    }
  }
  return { files: files.length, actions };
}

/** Every capability flag on, so no feature term hides the standing's verdict. */
const FEATURES = {
  organization: true, multiOrgEnabled: true, twoFactor: true,
  oidcProvider: true, admin: true, phoneNumber: true, apiKey: true, sso: true,
};

type Subject = { id: string; email: string; isPlatformAdmin: boolean; positions: string[] };

/** The one principal the gate admits — holding the rung, and no position that names it. */
const PLATFORM_ADMIN: Subject = { id: 'u_pa', email: 'pa@example.com', isPlatformAdmin: true, positions: [] };

/** Every principal the gate refuses, the grades first, then the position the rung must never be read from. */
const REFUSED: ReadonlyArray<[string, Subject]> = [
  ['org owner', { id: 'u_owner', email: 'owner@example.com', isPlatformAdmin: false, positions: ['org_owner'] }],
  ['org admin', { id: 'u_admin', email: 'admin@example.com', isPlatformAdmin: false, positions: ['org_admin'] }],
  ['delegated admin', { id: 'u_del', email: 'del@example.com', isPlatformAdmin: false, positions: ['delegated_admin'] }],
  ['plain member', { id: 'u_member', email: 'member@example.com', isPlatformAdmin: false, positions: ['member'] }],
  [
    "a tenant-written 'platform_admin' position without the rung",
    { id: 'u_pos', email: 'pos@example.com', isPlatformAdmin: false, positions: ['platform_admin', 'org_owner'] },
  ],
];

/** The console's binding: the whole scope as `extra`, one subject under every alias. */
function offered(source: string, subject: Subject, record: Record<string, unknown>): boolean {
  const r = celEngine.evaluate(
    { dialect: 'cel', source },
    {
      record,
      extra: { current_user: subject, user: subject, ctx: { user: subject }, os: { user: subject }, features: FEATURES },
    },
  );
  return r.ok && r.value === true;
}

/**
 * Rows to evaluate on: the empty row, plus every combination of the values a
 * record term could ask for — true, false, an arbitrary string, and each string
 * literal the predicate itself compares against.
 */
function candidateRows(source: string): Array<Record<string, unknown>> {
  const paths = [...new Set([...source.matchAll(/record\.([a-z_][a-z0-9_]*)/gi)].map((m) => m[1]))];
  const literals = [...source.matchAll(/'([^']*)'|"([^"]*)"/g)].map((m) => m[1] ?? m[2]);
  const values: unknown[] = [true, false, 'x', ...new Set(literals)];
  let rows: Array<Record<string, unknown>> = [{}];
  for (const path of paths) {
    rows = rows.flatMap((row) => values.map((v) => ({ ...row, [path]: v })));
  }
  return [{}, ...rows];
}

describe('platform-admin-gated doors: every first-party action offers itself to the standing the door admits', () => {
  let files = 0;
  let all: FirstPartyAction[] = [];
  let family: FirstPartyAction[] = [];

  beforeAll(async () => {
    ({ files, actions: all } = await loadActions());
    family = all.filter((a) => isPlatformAdminGatedDoor(a.target));
  }, 120_000);

  it('the instrument is live: the walk loads objects, and the family holds every member known today', () => {
    // Positive control FIRST. A walk that found nothing, or an oracle that
    // matched nothing, would leave every assertion below vacuously green.
    expect(files).toBeGreaterThan(50);
    expect(all.length).toBeGreaterThan(50);
    // A floor, not the set: an action added later joins the family by its
    // target and is judged below, with no edit here.
    expect(family.map((a) => a.site)).toEqual(
      expect.arrayContaining([
        'sys_member.add_member',
        'sys_user.ban_user',
        'sys_user.unban_user',
        'sys_user.unlock_user',
        'sys_user.create_user',
        'sys_user.set_user_password',
        'sys_user.impersonate_user',
        'sys_user.set_user_manager',
        'sys_oauth_application.disable_oauth_application',
        'sys_oauth_application.enable_oauth_application',
        'sys_sso_provider.register_sso_provider',
        'sys_sso_provider.register_saml_provider',
        'sys_sso_provider.request_domain_verification',
        'sys_sso_provider.verify_domain',
      ]),
    );
  });

  it('the oracle does not sweep in doors that admit someone other than a platform admin', () => {
    // Negative control: each of these is a first-party target today whose door
    // authorizes another principal — the session itself, the application's or
    // provider's owner. Gating them on the standing would hide a working button.
    for (const target of [
      '/api/v1/auth/sys-oauth-application/register',
      '/api/v1/auth/oauth2/client/rotate-secret',
      '/api/v1/auth/oauth2/delete-client',
      '/api/v1/auth/sso/delete-provider',
      ...Object.keys(NAMESPACE_ROUTES_ADMITTING_OTHERS),
    ]) {
      expect(isPlatformAdminGatedDoor(target), target).toBe(false);
    }
    for (const site of [
      'sys_oauth_application.create_oauth_application',
      'sys_oauth_application.rotate_client_secret',
      'sys_oauth_application.delete_oauth_application',
      'sys_sso_provider.delete_sso_provider',
    ]) {
      expect(all.some((a) => a.site === site), `${site} is still a first-party action`).toBe(true);
      expect(family.some((a) => a.site === site), `${site} is not in the family`).toBe(false);
    }
  });

  it('each member serves a visible that carries the standing term', () => {
    const missing = family
      .filter((a) => !a.source?.includes(STANDING))
      .map((a) => `${a.site} → ${a.target} (${a.file}) serves ${a.source === undefined ? 'no visible' : `\`${a.source}\``}`);
    expect(missing, `add \`visible: '${STANDING}'\` (AND-composed with any existing term)`).toEqual([]);
  });

  it('no principal the gate refuses is offered a member, on any row — current_user bound as the console binds it', () => {
    const leaks: string[] = [];
    for (const a of family) {
      if (a.source === undefined) {
        leaks.push(`${a.site}: no visible, so every principal is offered it`);
        continue;
      }
      for (const [who, subject] of REFUSED) {
        const row = candidateRows(a.source).find((r) => offered(a.source!, subject, r));
        if (row) leaks.push(`${a.site} is offered to ${who} on ${JSON.stringify(row)}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it('the platform admin is still offered every member — the standing is a gate, not an always-false wrapper', () => {
    const hidden = family
      .filter((a) => a.source !== undefined)
      .filter((a) => !candidateRows(a.source!).some((r) => offered(a.source!, PLATFORM_ADMIN, r)))
      .map((a) => `${a.site}: \`${a.source}\``);
    expect(hidden).toEqual([]);
  });
});
