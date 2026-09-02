// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14491 — THE MEASUREMENT, and only the measurement.
//
// After #12892 step 2 the artifact door owns the METADATA SERVICE copy of
// `positions` / `permissions` / `capabilities` / `sharingRules`. It does not own
// the ObjectQL SchemaRegistry copy: `AppPlugin.init()` still calls
// `getService('manifest').register(bundle)` unconditionally (app-plugin.ts, the
// `servicePayload` line — `securityMetadataRegistrar` gates only the
// `registerInMemory` block further down), and `registerMetadataCollections`
// (objectql `engine.ts`, `METADATA_ARRAY_KEYS`) decomposes the RAW artifact
// bytes into the registry. So an artifact boot with an engine holds THREE
// copies, and the plugin-security / plugin-sharing seeders read the registry
// one FIRST:
//
//   bootstrap-declared-permissions.ts  readDeclared(ql, 'permission')     then metadataService.list
//   bootstrap-declared-capabilities.ts readDeclared(ql, 'capability')     then metadataService.list
//   bootstrap-declared-sharing-rules.ts readDeclared(engine,'sharing_rule') then metadataService.list
//
// Triage (14491#issuecomment-5507909226) ruled the card down to four questions
// and forbade every repair:
//
//   1. which copy each seeder actually consumes;
//   2. the runtime type of a sharing rule's `condition` at the seeder;
//   3. whether a `capability` arrives without its `scope` default;
//   4. which copy wins in the persisted `sys_*` row.
//
// ⛔ This file changes NO production behaviour and asserts no repair. It is a
// divergence pin in the style of PR #14398's
// `standalone-stack-security-registrar.test.ts`: one real boot, both copies
// read at the same moment, key by key, beside the row that survived.
//
// ## What is REAL here, and the one thing that is DECLARED
//
// REAL: `createStandaloneStack` and every plugin it composes (the artifact door
// `MetadataPlugin({ artifactSource })`, `ObjectQLPlugin` with its real
// SchemaRegistry, the real default datasource over `memory://`), the real
// `SecurityPlugin` and `SharingServicePlugin` — so the seeders under
// measurement are the production ones, running in their production `start()`,
// writing through the real engine into the real `sys_*` tables. No engine
// double, and therefore no row in `scripts/engine-double-contract.pinned.json`.
//
// DECLARED: one composition input — `tenancy: { posture: 'single' }`.
// `createStandaloneStack` composes no auth plugin, and `AuthPlugin` is the only
// registrar of the `tenancy` service; absent it, `SharingServicePlugin`'s
// `sharingPosture()` takes its fail-safe walled default, `resolveRuleSeedPasses`
// enumerates `sys_organization` (empty on a fresh boot) and runs ZERO seeding
// passes — measured: `[sharing-rule] hooks bound {"ruleCount":0}` and an empty
// `sys_sharing_rule`, which measures the tenancy default rather than the read
// under study. `single` is what the open runtime's own `createTenancyService`
// resolves to when no `org-scoping` service is installed (auth-plugin.ts
// `probeIsolation`), i.e. the self-hosted single-tenant posture — so this
// declares the deployment shape, it does not stand in for anything being
// measured.
//
// ## Why there is no engine-less CONTROL leg
//
// The natural control — "boot the same artifact with no engine and watch the
// `metadataService.list` fallback seed a DIFFERENT row" — cannot be built
// honestly here. `readDeclared` falls back only when the registry answers
// empty, so producing that state means handing the seeder an engine whose
// registry is empty: an engine double, which triage's ruling excludes and which
// would need the ledger PR #14528 holds. Instead the fallback's input is
// measured directly — the door's copy is read off the real booted metadata
// service at the same moment — and the pin asserts what that copy holds beside
// what actually landed. Two copies, both real, one row.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Runtime } from './runtime.js';
import { createStandaloneStack } from './standalone-stack.js';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD — `createStandaloneStack` reaches each through a dynamic
// `import()` inside the boot below, and vitest clocks those while collection is
// clocked against nothing. See `scripts/check-test-source-alias.mjs`.
import '@objectstack/metadata';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

/**
 * The probe artifact. `engines.protocol` sits one minor below the runtime spec
 * so the door's ADR-0087 forward-conversion window is open — the same lever PR
 * #14398's probe uses, and the reason the two copies can differ at all.
 *
 * Each declaration isolates one axis of triage's question:
 *
 * - `permissions[0]`  — `allowRestore` / `allowPurge` are keys the current
 *   `PermissionSet` schema does not carry, and `rowLevelSecurity[].priority` is
 *   another; the door drops all three and defaults three more in. Nothing
 *   converts them, so they are the cleanest "which copy landed" discriminator.
 * - `capabilities[0]` — no `scope`, so the door's schema default is observable
 *   (triage question 3).
 * - `sharingRules[0]` `share_legacy_deals` — BOTH legacy spellings at once
 *   (`sharedWith.type: 'role'`, `accessLevel: 'full'`), the PR #14398 probe
 *   bytes.
 * - `sharingRules[1]` `share_legacy_level` — the legacy `accessLevel` ALONE,
 *   over a recipient type the seeder accepts, so the `accessLevel` axis is not
 *   masked by the recipient axis.
 * - `sharingRules[2]` `share_modern_deals` — canonical everywhere EXCEPT the
 *   bare-string `condition`, isolating triage question 2 from the rest.
 *
 * Every rule authors `condition` as a bare string, which is what triage asked
 * for and what an author actually writes.
 */
const ARTIFACT = {
  manifest: {
    id: 'com.test.issue-14491',
    name: 'Seeder Declaration Copy Probe',
    type: 'app',
    version: '3.0.0',
    engines: { protocol: '^17.1.0' },
  },
  permissions: [
    {
      name: 'probe_agent',
      label: 'Probe Agent',
      objects: {
        crm_ticket: {
          allowRead: true, allowCreate: true, allowEdit: true,
          allowDelete: true, allowRestore: true, allowPurge: false,
        },
      },
      rowLevelSecurity: [
        {
          name: 'own_tasks', object: 'crm_task', operation: 'select',
          using: 'assignee == current_user.email', enabled: true, priority: 10,
        },
      ],
    },
  ],
  capabilities: [{ name: 'probe.export', label: 'Export probe data' }],
  sharingRules: [
    {
      name: 'share_legacy_deals',
      type: 'criteria',
      object: 'crm_deal',
      accessLevel: 'full',
      condition: 'record.status == "open"',
      sharedWith: { type: 'role', value: 'sales_mgr' },
    },
    {
      name: 'share_legacy_level',
      type: 'criteria',
      object: 'crm_deal',
      accessLevel: 'full',
      condition: 'record.tier == "gold"',
      sharedWith: { type: 'position', value: 'sales_lead' },
    },
    {
      name: 'share_modern_deals',
      type: 'criteria',
      object: 'crm_deal',
      accessLevel: 'edit',
      condition: 'record.stage == "won"',
      sharedWith: { type: 'position', value: 'sales_rep' },
    },
  ],
};

const BOOT_TIMEOUT = 180_000;

/** One boot; every question below is a question about the SAME boot. */
let dir: string;
let kernel: any;
/** What `readDeclared(engine, KIND)` returns — the ObjectQL SchemaRegistry copy. */
let registryCopy: Record<string, any[]>;
/** What `metadataService.list(KIND)` would have returned at the same moment. */
let doorCopy: Record<string, any[]>;
/** The rows the seeders left behind. */
let rows: Record<string, any[]>;

const byName = (items: readonly any[], name: string): any =>
  items.find((i: any) => i?.name === name);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-14491-'));
  const artifactPath = join(dir, 'objectstack.json');
  writeFileSync(artifactPath, JSON.stringify(ARTIFACT), 'utf-8');

  const stack = await createStandaloneStack({
    artifactPath,
    projectRoot: dir,
    databaseUrl: 'memory://issue-14491-measure',
    skipSeedData: true,
    runPlatformMigrations: false,
  });

  const runtime = new Runtime({ cluster: false });
  kernel = runtime.getKernel();
  for (const p of stack.plugins) await kernel.use(p as any);
  // See the header: the posture the open runtime resolves to with no
  // `org-scoping` installed. Without it the sharing seeder runs zero passes and
  // this file would measure the tenancy default instead of the seeder's read.
  kernel.registerService('tenancy', { posture: 'single' } as any);
  await kernel.use(new SecurityPlugin() as any);
  await kernel.use(new SharingServicePlugin() as any);
  await kernel.bootstrap();

  const ql: any = kernel.getService('objectql');
  const metadata: any = kernel.getService('metadata');

  const KINDS = ['permission', 'capability', 'sharing_rule'] as const;
  registryCopy = {};
  doorCopy = {};
  for (const kind of KINDS) {
    // The exact expression BOTH seeders' `readDeclared` runs. plugin-security
    // spells the receiver `engine.registry` and plugin-sharing spells it
    // `engine._registry`; the pin below asserts those are one object.
    registryCopy[kind] = (ql.registry.listItems(kind) ?? []).filter(Boolean);
    const listed = metadata.list(kind);
    doorCopy[kind] = (typeof listed?.then === 'function' ? await listed : listed) ?? [];
  }

  rows = {};
  for (const t of ['sys_permission_set', 'sys_capability', 'sys_sharing_rule']) {
    rows[t] = await ql.find(t, {});
  }
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await kernel?.shutdown(); } catch { /* noop */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('#14491 — the third copy exists, and both seeder spellings read it', () => {
  it('`engine.registry` and `engine._registry` are ONE SchemaRegistry, so the two `readDeclared` spellings cannot diverge', () => {
    const ql: any = kernel.getService('objectql');
    expect(ql.registry).toBe(ql._registry);
  });

  it('a boot WITH an engine holds a non-empty registry copy of all three kinds — so no seeder ever reaches its `metadataService.list` fallback', () => {
    // This is the whole mechanism: each fallback is guarded by
    // `if (<kind>.length === 0)`, and none of these is 0.
    // ⚠️ `permission` is not only the artifact's: `SecurityPlugin` registers
    // its own bootstrap sets through the same manifest service, so the registry
    // holds those too. Membership, not length, is what the guard turns on.
    expect(registryCopy.permission.length).toBeGreaterThan(0);
    expect(registryCopy.permission.map((i) => i.name)).toContain('probe_agent');
    expect(registryCopy.capability.map((i) => i.name)).toContain('probe.export');
    expect(registryCopy.sharing_rule.map((i) => i.name))
      .toEqual(['share_legacy_deals', 'share_legacy_level', 'share_modern_deals']);
    // …and the door's copy is populated at the same moment, so this is a choice
    // between two live copies, not a fallback to nothing.
    expect(doorCopy.permission.map((i: any) => i.name)).toContain('probe_agent');
    expect(doorCopy.capability.map((i: any) => i.name)).toContain('probe.export');
    expect(doorCopy.sharing_rule).toHaveLength(3);
  });

  it('`positions` is absent from METADATA_ARRAY_KEYS, so `position` has no registry copy and always comes from the door', async () => {
    // The card's asymmetry, re-measured. `roles:` is not in
    // `PLURAL_TO_SINGULAR` either, so nothing lands under `roles` in the
    // registry: both reads are empty from both spellings.
    const ql: any = kernel.getService('objectql');
    expect((ql.registry.listItems('position') ?? []).filter(Boolean)).toEqual([]);
    expect((ql.registry.listItems('roles') ?? []).filter(Boolean)).toEqual([]);
  });
});

describe('#14491 Q2 — the runtime type of a sharing rule `condition` at the seeder', () => {
  it('registry copy: a bare STRING; door copy: the `{ dialect, source }` envelope', () => {
    for (const name of ['share_legacy_deals', 'share_legacy_level', 'share_modern_deals']) {
      const reg = byName(registryCopy.sharing_rule, name);
      const door = byName(doorCopy.sharing_rule, name);
      expect(typeof reg.condition, `${name} registry`).toBe('string');
      expect(typeof door.condition, `${name} door`).toBe('object');
      expect(door.condition, `${name} door`).toEqual({
        dialect: 'cel',
        source: reg.condition,
      });
    }
  });

  it('ABSORBED: `compileCelToFilter` accepts `string | { source }`, so the persisted `criteria_json` is the same either way', () => {
    // `celToFilterOutcome` → `compileCelToFilter(cel as string | { source?: string })`,
    // whose `toSource` reads both shapes. The divergence is real at the seam
    // and has no consequence in the row.
    const modern = byName(rows.sys_sharing_rule, 'share_modern_deals');
    expect(JSON.parse(modern.criteria_json)).toEqual({ stage: 'won' });
    const legacyLevel = byName(rows.sys_sharing_rule, 'share_legacy_level');
    expect(JSON.parse(legacyLevel.criteria_json)).toEqual({ tier: 'gold' });
  });
});

describe('#14491 Q3 — whether a `capability` arrives without its `scope` default', () => {
  it('YES: the registry copy carries no `scope` (and no `_packageVersion`); the door copy carries `scope: platform`', () => {
    const reg = byName(registryCopy.capability, 'probe.export');
    const door = byName(doorCopy.capability, 'probe.export');
    expect(reg).not.toHaveProperty('scope');
    expect(reg).not.toHaveProperty('_packageVersion');
    expect(reg).toMatchObject({
      name: 'probe.export', label: 'Export probe data',
      _packageId: 'com.test.issue-14491', _provenance: 'package',
    });
    expect(door).toMatchObject({
      name: 'probe.export', scope: 'platform',
      _packageId: 'com.test.issue-14491', _packageVersion: '3.0.0', _provenance: 'package',
    });
  });

  it('ABSORBED: `capabilityRowFields` supplies its OWN `platform` default, so the row is indistinguishable from the door-fed one', () => {
    // `scope: cap.scope === 'org' ? 'org' : 'platform'` — the seeder never
    // reads the door's value, it re-derives an equal one. The equality is a
    // coincidence of two independent defaults, not a normalisation of the
    // door's copy; this row records that it currently holds.
    const row = byName(rows.sys_capability, 'probe.export');
    expect(row).toMatchObject({
      name: 'probe.export',
      label: 'Export probe data',
      description: 'Capability probe.export.',   // also the seeder's own default
      scope: 'platform',
      managed_by: 'package',
      package_id: 'com.test.issue-14491',
      active: true,
    });
  });
});

describe('#14491 Q1 + Q4 — which copy the seeders consume, and which copy wins in the persisted row', () => {
  it('`permission`: the registry copy diverges from the door copy on six keys', () => {
    const reg = byName(registryCopy.permission, 'probe_agent');
    const door = byName(doorCopy.permission, 'probe_agent');

    // Keys the raw copy carries and the door's strict parse DROPS.
    expect(reg.objects.crm_ticket).toMatchObject({ allowRestore: true, allowPurge: false });
    expect(door.objects.crm_ticket).not.toHaveProperty('allowRestore');
    expect(door.objects.crm_ticket).not.toHaveProperty('allowPurge');
    expect(reg.rowLevelSecurity[0]).toMatchObject({ priority: 10 });
    expect(door.rowLevelSecurity[0]).not.toHaveProperty('priority');

    // Keys the door DEFAULTS IN and the raw copy has never had.
    expect(door.objects.crm_ticket).toMatchObject({
      allowTransfer: false, viewAllRecords: false, modifyAllRecords: false,
    });
    for (const k of ['allowTransfer', 'viewAllRecords', 'modifyAllRecords']) {
      expect(reg.objects.crm_ticket, k).not.toHaveProperty(k);
    }
    expect(reg).not.toHaveProperty('isDefault');
    expect(door).toMatchObject({ isDefault: false, _packageVersion: '3.0.0' });
  });

  it('⚠️ NOT ABSORBED — `sys_permission_set` persists the UN-PARSED registry copy, byte for byte', () => {
    const reg = byName(registryCopy.permission, 'probe_agent');
    const door = byName(doorCopy.permission, 'probe_agent');
    const row = byName(rows.sys_permission_set, 'probe_agent');

    // The decisive read: the stored authorization map is deep-equal to the
    // registry copy's and NOT to the door's. Nothing between `readDeclared` and
    // `tryInsert` re-parses it — `permissionSetRowFields` serialises what it
    // was handed.
    const storedObjects = JSON.parse(row.object_permissions);
    expect(storedObjects).toEqual(reg.objects);
    expect(storedObjects).not.toEqual(door.objects);

    const storedRls = JSON.parse(row.row_level_security);
    expect(storedRls).toEqual(reg.rowLevelSecurity);
    expect(storedRls).not.toEqual(door.rowLevelSecurity);

    // Spelled out key by key, so a future change to either side names itself.
    expect(storedObjects.crm_ticket).toMatchObject({ allowRestore: true, allowPurge: false });
    expect(storedObjects.crm_ticket).not.toHaveProperty('allowTransfer');
    expect(storedObjects.crm_ticket).not.toHaveProperty('viewAllRecords');
    expect(storedObjects.crm_ticket).not.toHaveProperty('modifyAllRecords');
    expect(storedRls[0]).toMatchObject({ priority: 10 });

    expect(row).toMatchObject({
      managed_by: 'package', package_id: 'com.test.issue-14491', active: true, customized: false,
    });
  });

  it('`sharing_rule`: the registry copy keeps the legacy `sharedWith.type` and `accessLevel` the door forward-converts', () => {
    const regLegacy = byName(registryCopy.sharing_rule, 'share_legacy_deals');
    const doorLegacy = byName(doorCopy.sharing_rule, 'share_legacy_deals');
    expect(regLegacy.sharedWith).toEqual({ type: 'role', value: 'sales_mgr' });
    expect(doorLegacy.sharedWith).toEqual({ type: 'position', value: 'sales_mgr' });
    expect(regLegacy.accessLevel).toBe('full');
    expect(doorLegacy.accessLevel).toBe('edit');

    // `active` is defaulted by the door and absent from the raw copy.
    expect(regLegacy).not.toHaveProperty('active');
    expect(doorLegacy).toMatchObject({ active: true, _packageVersion: '3.0.0' });
  });

  it('ABSORBED: a legacy `accessLevel` alone survives — `defineRule` runs it through `normalizeAccessLevel`', () => {
    // `share_legacy_level` declares `full` over a recipient type the seeder
    // accepts, so the level axis is not masked by the recipient axis.
    // `normalizeAccessLevel(input.accessLevel, 'read')` maps the retired
    // spelling, landing the same value the door's copy carries.
    expect(byName(registryCopy.sharing_rule, 'share_legacy_level').accessLevel).toBe('full');
    expect(byName(doorCopy.sharing_rule, 'share_legacy_level').accessLevel).toBe('edit');
    expect(byName(rows.sys_sharing_rule, 'share_legacy_level')).toMatchObject({
      access_level: 'edit',
      recipient_type: 'position',
      recipient_id: 'sales_lead',
      active: true,
      managed_by: 'package',
    });
  });

  it('⚠️ NOT ABSORBED — the rule whose recipient the door converts is DROPPED, and no `sys_sharing_rule` row exists for it', () => {
    // `mapRecipientType` REFUSES `'role'` (it converts nothing; the ADR-0087
    // conversion lives at the door, which this read bypasses), so the seeder
    // takes its `skipped (unmappable recipient)` branch. The door's copy of the
    // very same declaration says `position`, which `mapRecipientType` accepts —
    // so the copy chosen decides whether this rule exists at all.
    expect(byName(doorCopy.sharing_rule, 'share_legacy_deals').sharedWith.type).toBe('position');
    expect(byName(rows.sys_sharing_rule, 'share_legacy_deals')).toBeUndefined();

    // Three declared rules in, two rows out — and the missing one is exactly
    // the one the two copies disagree about.
    expect(rows.sys_sharing_rule.map((r: any) => r.name).sort())
      .toEqual(['share_legacy_level', 'share_modern_deals']);
  });

  it('the rows that DID land carry the seeder-derived shape, organization-less under the `single` posture', () => {
    const modern = byName(rows.sys_sharing_rule, 'share_modern_deals');
    expect(modern).toMatchObject({
      name: 'share_modern_deals',
      object_name: 'crm_deal',
      recipient_type: 'position',
      recipient_id: 'sales_rep',
      access_level: 'edit',
      active: true,
      managed_by: 'package',
      customized: false,
      organization_id: null,
    });
    expect(JSON.parse(modern.criteria_json)).toEqual({ stage: 'won' });
  });
});
