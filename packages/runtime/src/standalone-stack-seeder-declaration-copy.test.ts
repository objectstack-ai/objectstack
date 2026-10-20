// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14491 — THE MEASUREMENT, and only the measurement.
//
// After #12892 step 2 the artifact door owns the METADATA SERVICE copy of
// `positions` / `permissions` / `capabilities` / `sharingRules`. It does not own
// the ObjectQL SchemaRegistry copy: `AppPlugin.init()` still calls
// `getService('manifest').register(...)` unconditionally (app-plugin.ts, the
// `servicePayload` line — `securityMetadataRegistrar` gates only the
// `registerInMemory` block further down), and `registerMetadataCollections`
// (objectql `engine.ts`, `METADATA_ARRAY_KEYS`) decomposes that payload into
// the registry, un-parsed. So an artifact boot with an engine holds THREE
// copies, and the plugin-security / plugin-sharing seeders read the registry
// one FIRST:
//
//   (bootstrap-declared-permissions.ts did the same for 'permission', and
//   bootstrap-declared-capabilities.ts for 'capability', until ADR-0131 D3
//   retired them: a declared permission set or capability now has no row at all)
//   plugin-sharing declared-sharing-rules.ts: engine.registry.listItems('sharing_rule')
//   then metadataService.list — read at ENFORCEMENT since ADR-0131 D2 retired the
//   sharing-rule seeder, so a declared sharing rule has no row either, and the
//   rule the sharing-rule service serves is where the copy it read shows
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
// divergence pin in the style of commit 317132495's
// `standalone-stack-security-registrar.test.ts`: one real boot, both copies
// read at the same moment, key by key, beside the row that survived.
//
// ## Two axes, and the one #22994 closed
//
// The two copies used to differ on two independent axes:
//
//   CONVERSION  the ADR-0087 forward conversion: the retired `allowRestore` /
//               `allowPurge` grant bits, the RLS `priority`, the legacy
//               `sharedWith.type: 'role'` and `accessLevel: 'full'`.
//   PARSE       the door's strict parse: schema defaults the registry copy has
//               never carried (`allowTransfer` / `viewAllRecords` /
//               `modifyAllRecords`, `isDefault`, a sharing rule's `active`, a
//               capability's `scope`) and the ADR-0122 `condition` transform.
//
// #22994 CLOSED THE CONVERSION AXIS. `AppPlugin` now hands the `manifest`
// service the result of the boot's one forward conversion
// (`AppPlugin.forwardConverted`), so the registry copy carries the door's
// conversion. The five pins on that axis had been measured against a RAW
// registry copy; they were REWRITTEN to the converged state, never skipped,
// relaxed or deleted (the #12892 step's move in
// app-plugin-artifact-forward-conversion.test.ts). One of them is an
// authorization outcome: the legacy `role` share is now seeded as a position
// share, where it used to be dropped. The PARSE axis is untouched and stays
// #14491's: every pin on it below is as it was.
//
// ## What is REAL here, and the one thing that is DECLARED
//
// REAL: `createStandaloneStack` and every plugin it composes (the artifact door
// `MetadataPlugin({ artifactSource })`, `ObjectQLPlugin` with its real
// SchemaRegistry, the real default datasource over SQLite `:memory:`), the real
// `SecurityPlugin` and `SharingServicePlugin` — so the seeders under
// measurement are the production ones, running in their production `start()`,
// writing through the real engine into the real `sys_*` tables. No engine
// double, and therefore no row in `scripts/engine-double-contract.pinned.json`.
//
// DECLARED: one composition input — `tenancy: { posture: 'single' }`.
// `createStandaloneStack` composes no auth plugin, and `AuthPlugin` is the only
// registrar of the `tenancy` service; absent it, `SharingServicePlugin`'s
// `sharingPosture()` takes its fail-safe walled default, `resolveDeclaredRuleScopes`
// enumerates `sys_organization` (empty on a fresh boot) and serves declared
// rules in ZERO scopes — the sharing-rule service then lists none, which
// measures the tenancy default rather than the read under study. `single` is what the open runtime's own `createTenancyService`
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
import { ObjectKernel } from '@objectstack/core';
import { Runtime } from './runtime.js';
import { createStandaloneStack } from './standalone-stack.js';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { AUDIENCE_ANCHOR_POSITIONS, BUILTIN_IDENTITY_NAMES } from '@objectstack/spec';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD — `createStandaloneStack` reaches each through a dynamic
// `import()` inside the boot below, and vitest clocks those while collection is
// clocked against nothing. See `scripts/check-test-source-alias.mjs`.
import '@objectstack/metadata';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

/**
 * The probe artifact. `engines.protocol`'s floor sits below the runtime spec
 * so the door's ADR-0087 forward-conversion window is open — the same lever
 * commit 317132495's probe uses, and the reason the two copies can differ at all.
 * It is a `>=` floor, not `^17.1.0`: this boot runs the ADR-0087 D1 handshake,
 * which refuses a caret on 17 from protocol 18, and only the floor opens the window.
 *
 * Each declaration isolates one axis of triage's question:
 *
 * - `permissions[0]`  — `allowRestore` / `allowPurge` are keys the current
 *   `PermissionSet` schema does not carry, and `rowLevelSecurity[].priority` is
 *   another; the forward conversion strips all three (on both copies since
 *   #22994), and the door's parse defaults three more grant bits in (on its
 *   copy only). So the first three read the CONVERSION axis and the defaults
 *   read the PARSE axis.
 * - `capabilities[0]` — no `scope`, so the door's schema default is observable
 *   (triage question 3).
 * - `sharingRules[0]` `share_legacy_deals` — BOTH legacy spellings at once
 *   (`sharedWith.type: 'role'`, `accessLevel: 'full'`), the commit 317132495 probe
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
    engines: { protocol: '>=17.1.0' },
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
  // [#22203] One declared position, so the registry-copy case below measures a
  // stack declaration rather than an empty collection.
  positions: [{ name: 'probe_lead', label: 'Probe Lead' }],
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

/**
 * A declared metadata item, as either copy hands it over — deliberately loose:
 * the whole point of this file is that the two copies carry DIFFERENT key sets,
 * so the shape cannot be stated once.
 */
type DeclaredItem = any;

/**
 * The two slot surfaces this measurement reads, named rather than erased to
 * `any` at the lookup (`pnpm check:slot-lookup`, #4251). `objectql` is read for
 * exactly two things: the SchemaRegistry both `readDeclared` spellings reach,
 * and the `find` the seeders' rows come back through.
 */
interface ObjectQlRegistrySlot {
  readonly registry: { listItems(type: string): DeclaredItem[] | undefined };
  /** The private field `plugin-sharing`'s `readDeclared` spells instead. */
  readonly _registry: unknown;
  find(object: string, query: Record<string, unknown>): Promise<DeclaredItem[]>;
  getObject?(object: string): unknown;
}

interface MetadataListSlot {
  list(type: string): DeclaredItem[] | Promise<DeclaredItem[]> | undefined;
}

/** One boot; every question below is a question about the SAME boot. */
let dir: string;
let kernel: ObjectKernel;
/** What `readDeclared(engine, KIND)` returns — the ObjectQL SchemaRegistry copy. */
let registryCopy: Record<string, any[]>;
/** What `metadataService.list(KIND)` would have returned at the same moment. */
let doorCopy: Record<string, any[]>;
/** The rows the seeders left behind. */
let rows: Record<string, any[]>;
/** [ADR-0131 D2] The sharing rules the sharing-rule service serves — read from the registry, no row. */
let served: any[];

const byName = (items: readonly any[], name: string): any =>
  items.find((i: any) => i?.name === name);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'os-14491-'));
  const artifactPath = join(dir, 'objectstack.json');
  writeFileSync(artifactPath, JSON.stringify(ARTIFACT), 'utf-8');

  const stack = await createStandaloneStack({
    artifactPath,
    projectRoot: dir,
    databaseUrl: ':memory:',
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
  // No auth plugin here, so plugin-auth's identity objects come from its
  // preset: `SecurityPlugin` refuses a boot without the `sys_user` /
  // `sys_member` its authorization store reads.
  await kernel.use(createIdentityObjectsPlugin() as any);
  await kernel.use(new SecurityPlugin() as any);
  await kernel.use(new SharingServicePlugin() as any);
  await kernel.bootstrap();

  const ql = kernel.getService<ObjectQlRegistrySlot>('objectql');
  const metadata = kernel.getService<MetadataListSlot>('metadata');

  const KINDS = ['permission', 'capability', 'sharing_rule'] as const;
  registryCopy = {};
  doorCopy = {};
  for (const kind of KINDS) {
    // The exact expression BOTH seeders' `readDeclared` runs. plugin-security
    // spells the receiver `engine.registry` and plugin-sharing spells it
    // `engine._registry`; the pin below asserts those are one object.
    registryCopy[kind] = (ql.registry.listItems(kind) ?? []).filter(Boolean);
    // `await` covers both spellings the facade may answer with — a plain array
    // or a promise of one — without a `then` probe the checker cannot narrow.
    doorCopy[kind] = (await metadata.list(kind)) ?? [];
  }

  rows = {};
  for (const t of ['sys_permission_set', 'sys_capability', 'sys_sharing_rule']) {
    // The seeded rows as the platform reads them: the explicit system opt-in.
    // A context-less read is refused by the security middleware (ADR-0096 D5).
    // [C3 stage 8] A retired catalog row object has no table, and no rows.
    rows[t] = ql.getObject?.(t) ? await ql.find(t, { context: { isSystem: true } }) : [];
  }
  served = await kernel
    .getService<{ listRules(filter: object, context: object): Promise<any[]> }>('sharingRules')
    .listRules({}, { isSystem: true, positions: [], permissions: [] });
}, BOOT_TIMEOUT);

afterAll(async () => {
  try { await kernel?.shutdown(); } catch { /* noop */ }
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* noop */ }
});

describe('#14491 — the third copy exists, and both seeder spellings read it', () => {
  it('`engine.registry` and `engine._registry` are ONE SchemaRegistry, so the two `readDeclared` spellings cannot diverge', () => {
    const ql = kernel.getService<ObjectQlRegistrySlot>('objectql');
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

  it('[#22203] a stack-declared `position` has a registry copy under the artifact\'s package, beside the six built-ins', async () => {
    // Re-measured after `positions` joined METADATA_ARRAY_KEYS. It used to be
    // absent, so this read held the six built-ins and none of the stack's —
    // and the metadata save door decides "a code package ships this" from
    // this registry, so a save over a package's position was accepted.
    // `roles:` is not in `PLURAL_TO_SINGULAR`, so nothing lands under `roles`
    // from either spelling.
    const ql = kernel.getService<ObjectQlRegistrySlot>('objectql');
    const positions = (ql.registry.listItems('position') ?? []).filter(Boolean);
    // [ADR-0131 D2] The six built-ins `SecurityPlugin` declares under its own
    // package id, plus the stack's one under the artifact's.
    expect(positions.map((i: any) => i.name).sort())
      .toEqual([...BUILTIN_IDENTITY_NAMES, ...AUDIENCE_ANCHOR_POSITIONS, 'probe_lead'].sort());
    expect(byName(positions, 'probe_lead')).toMatchObject({
      _packageId: ARTIFACT.manifest.id,
      _provenance: 'package',
    });
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

  it('ABSORBED: `compileCelToFilter` accepts `string | { source }`, so the served `criteria` is the same either way', () => {
    // `celToFilterOutcome` → `compileCelToFilter(cel as string | { source?: string })`,
    // whose `toSource` reads both shapes. The divergence is real at the seam
    // and has no consequence in the rule enforcement reads.
    expect(byName(served, 'share_modern_deals').criteria).toEqual({ stage: 'won' });
    expect(byName(served, 'share_legacy_level').criteria).toEqual({ tier: 'gold' });
  });
});

describe('#14491 Q3 — whether a `capability` arrives without its `scope` default', () => {
  it('YES: the registry copy carries no `scope`; the door copy carries `scope: platform`', () => {
    const reg = byName(registryCopy.capability, 'probe.export');
    const door = byName(doorCopy.capability, 'probe.export');
    expect(reg).not.toHaveProperty('scope');
    // The registry stamps the package's version as the door does (#22689), so
    // the two copies no longer differ by `_packageVersion`.
    expect(reg).toMatchObject({
      name: 'probe.export', label: 'Export probe data',
      _packageId: 'com.test.issue-14491', _packageVersion: '3.0.0', _provenance: 'package',
    });
    expect(door).toMatchObject({
      name: 'probe.export', scope: 'platform',
      _packageId: 'com.test.issue-14491', _packageVersion: '3.0.0', _provenance: 'package',
    });
  });

  it('no row: a declared capability is served by the registry and no `sys_capability` row is written for it (ADR-0131 D3)', () => {
    expect(rows.sys_capability.filter((r: any) => r.name === 'probe.export')).toEqual([]);
  });

});

describe('#14491 Q1 + Q4 — which copy the seeders consume, and which copy wins in the persisted row', () => {
  it('`permission`: the registry copy carries the door\'s conversion, and diverges from it only on the door\'s four parse defaults', () => {
    const reg = byName(registryCopy.permission, 'probe_agent');
    const door = byName(doorCopy.permission, 'probe_agent');

    // [#22994] CONVERGED on the conversion axis. The forward conversion strips
    // the retired grant bits and the RLS `priority` from BOTH copies now, so the
    // registry's grant map is the authored map less those two keys, and its RLS
    // entry is the door's, whole. (Measured raw before #22994:
    // `allowRestore: true, allowPurge: false` and `priority: 10` on the registry
    // copy only.)
    expect(reg.objects.crm_ticket).toEqual({
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
    });
    expect(reg.objects.crm_ticket).not.toHaveProperty('allowRestore');
    expect(reg.objects.crm_ticket).not.toHaveProperty('allowPurge');
    expect(door.objects.crm_ticket).not.toHaveProperty('allowRestore');
    expect(door.objects.crm_ticket).not.toHaveProperty('allowPurge');
    expect(reg.rowLevelSecurity).toEqual([
      { name: 'own_tasks', object: 'crm_task', operation: 'select', using: 'assignee == current_user.email', enabled: true },
    ]);
    expect(reg.rowLevelSecurity).toEqual(door.rowLevelSecurity);
    expect(reg.rowLevelSecurity[0]).not.toHaveProperty('priority');
    expect(door.rowLevelSecurity[0]).not.toHaveProperty('priority');

    // Keys the door DEFAULTS IN and the registry copy has never had (the parse
    // axis, #14491's, unchanged).
    expect(door.objects.crm_ticket).toMatchObject({
      allowTransfer: false, viewAllRecords: false, modifyAllRecords: false,
    });
    for (const k of ['allowTransfer', 'viewAllRecords', 'modifyAllRecords']) {
      expect(reg.objects.crm_ticket, k).not.toHaveProperty(k);
    }
    expect(reg).not.toHaveProperty('isDefault');
    expect(door).toMatchObject({ isDefault: false, _packageVersion: '3.0.0' });
  });

  it('no row: a declared permission set is served by the registry and no `sys_permission_set` row is written for it (ADR-0131 D3)', () => {
    expect(rows.sys_permission_set.filter((r: any) => r.name === 'probe_agent')).toEqual([]);
  });

  it('`sharing_rule`: the registry copy carries the forward-converted `sharedWith.type` and `accessLevel` the door carries', () => {
    const regLegacy = byName(registryCopy.sharing_rule, 'share_legacy_deals');
    const doorLegacy = byName(doorCopy.sharing_rule, 'share_legacy_deals');
    // [#22994] CONVERGED: both copies carry the conversion of the legacy
    // `role` / `full` spellings. (Measured raw before #22994: the registry copy
    // kept `{ type: 'role' }` and `'full'`.)
    expect(regLegacy.sharedWith).toEqual({ type: 'position', value: 'sales_mgr' });
    expect(doorLegacy.sharedWith).toEqual({ type: 'position', value: 'sales_mgr' });
    expect(regLegacy.sharedWith).toEqual(doorLegacy.sharedWith);
    expect(regLegacy.accessLevel).toBe('edit');
    expect(doorLegacy.accessLevel).toBe('edit');

    // `active` is defaulted by the door and absent from the registry copy (the
    // parse axis, #14491's, unchanged).
    expect(regLegacy).not.toHaveProperty('active');
    expect(doorLegacy).toMatchObject({ active: true, _packageVersion: '3.0.0' });
  });

  it('a legacy `accessLevel` alone arrives at the reader already converted, on both copies, and is served `edit`', () => {
    // `share_legacy_level` declares `full` over a recipient type the seeder
    // accepts, so the level axis is not masked by the recipient axis.
    // [#22994] CONVERGED: the forward conversion maps the retired spelling on
    // the registry copy too, so the seeder is handed `edit` and
    // `normalizeAccessLevel`'s own mapping of `full` is no longer what lands it.
    // (Measured raw before #22994: `'full'` on the registry copy, absorbed by
    // `defineRule` → `normalizeAccessLevel(input.accessLevel, 'read')`.)
    expect(byName(registryCopy.sharing_rule, 'share_legacy_level').accessLevel).toBe('edit');
    expect(byName(doorCopy.sharing_rule, 'share_legacy_level').accessLevel).toBe('edit');
    expect(byName(served, 'share_legacy_level')).toMatchObject({
      access_level: 'edit',
      recipient_type: 'position',
      recipient_id: 'sales_lead',
      active: true,
      managed_by: 'package',
    });
  });

  it('the rule whose recipient the door converts is SERVED, as a position share, exactly once — and no row is written', () => {
    // AN AUTHORIZATION OUTCOME. `mapRecipientType` still refuses `'role'`, and
    // used to: before #22994 the registry copy kept the legacy recipient, the
    // seeder took its `skipped (unmappable recipient)` branch, and this rule had
    // NO row (three declared, two seeded). [#22994] The registry copy now
    // carries the forward conversion, so the seeder is handed the recipient the
    // door's copy says, `position`, which `mapRecipientType` accepts.
    expect(byName(doorCopy.sharing_rule, 'share_legacy_deals').sharedWith.type).toBe('position');
    expect(byName(registryCopy.sharing_rule, 'share_legacy_deals').sharedWith.type).toBe('position');
    expect(byName(served, 'share_legacy_deals')).toMatchObject({
      id: 'share_legacy_deals',
      name: 'share_legacy_deals',
      object_name: 'crm_deal',
      recipient_type: 'position',
      recipient_id: 'sales_mgr',
      access_level: 'edit',
      active: true,
      managed_by: 'package',
      customized: false,
      // [ADR-0131 D2/D8] The typed deployment-wide marker, never a NULL organization.
      deploymentWide: true,
    });
    expect(byName(served, 'share_legacy_deals').criteria).toEqual({ status: 'open' });
    expect(byName(served, 'share_legacy_deals')).not.toHaveProperty('organization_id');

    // Three declared rules in, three served, each exactly once: the legacy
    // rule is served ONE time, not a second time beside a modern spelling.
    expect(served.filter((r: any) => r.name === 'share_legacy_deals')).toHaveLength(1);
    expect(served.map((r: any) => r.name).sort())
      .toEqual(['share_legacy_deals', 'share_legacy_level', 'share_modern_deals']);
    // [ADR-0131 D2] Read, not written: the boot leaves `sys_sharing_rule` empty.
    expect(rows.sys_sharing_rule).toEqual([]);
  });

  it('the rules served carry the reader-derived shape, deployment-wide under the `single` posture', () => {
    const modern = byName(served, 'share_modern_deals');
    expect(modern).toMatchObject({
      name: 'share_modern_deals',
      object_name: 'crm_deal',
      recipient_type: 'position',
      recipient_id: 'sales_rep',
      access_level: 'edit',
      active: true,
      managed_by: 'package',
      customized: false,
      // [ADR-0131 D2/D8] The typed deployment-wide marker, never a NULL organization.
      deploymentWide: true,
    });
    expect(modern.criteria).toEqual({ stage: 'won' });
    expect(modern).not.toHaveProperty('organization_id');
  });
});
