// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { IndexSchema, resolveInjectedSystemColumns } from '@objectstack/spec/data';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { SysJob } from './sys-job.object.js';

/**
 * #8578 — `sys_job`'s declared uniqueness is installation-wide, and the reading
 * that makes it so is pinned here.
 *
 * ## The fork this card was filed on, and how it was decided
 *
 * The card deliberately asserted no defect. A DECLARED index's bare
 * `unique: true` is the positional spelling of `'global'` (the listed columns
 * verbatim), so `(name)` materialized as an installation-wide unique index on
 * an object that carries a kernel-injected `organization_id` — the shape of the
 * #8323 cross-tenant-oracle class. But `sys_job` is `managedBy: 'engine-owned'`
 * and calls itself a "Catalogue of registered background jobs", so the card
 * left the direction open and named the reading that settles it:
 *
 *   > does anything write `sys_job` rows **per organization**?
 *
 * Nothing does. Five independent lines of evidence, all measured on `main`:
 *
 *  1. **The sole writer has no organization dimension.** `DbJobAdapter`
 *     (`services/service-job`) is the only thing that writes this table —
 *     `upsertJobRow` on `schedule()`, `setActive` on `cancel()`, `bumpJob`
 *     after every run. All three write under
 *     `SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] }` and all
 *     three locate their row with `find('sys_job', { where: { name }, limit: 1 })`
 *     — keyed on `name` ALONE. The adapter therefore already assumes the global
 *     key; a per-organization constraint would make that lookup ambiguous
 *     (an arbitrary org's row would win) rather than fix anything.
 *  2. **The `job` metadata type is closed to tenants on all three flags** —
 *     `allowOrgOverride: false`, `allowRuntimeCreate: false`,
 *     `supportsOverlay: false`. The registry comment says the deciding half in
 *     words: *"no per-org job fork"*.
 *  3. **No generic write path exists at all.** `enable.apiMethods` is
 *     `['get', 'list']` (ADR-0103 engine-owned): reads stay open for the Setup
 *     grid, every write verb is absent, for every caller — tenant or not.
 *  4. **Every `schedule()` call site is registration-time and
 *     installation-scoped**: `AppPlugin` on `kernel:ready` from the app
 *     bundle's declared jobs, `JobServicePlugin` replaying those registrations,
 *     the schedule / time-relative flow triggers (keyed `<prefix>:${flowName}`,
 *     and `flow` is itself `allowOrgOverride: false`), the approvals and
 *     reports plugins' fixed names, and wait-node timers keyed
 *     `flow-wait:${runId}:${nodeId}` on a server-minted run id.
 *  5. **ADR-0120 names this exact key.** Its S5 row — "engine idempotency keys
 *     written by sudo (org NULL)" — lists `sys_job.name` first among the nine,
 *     with the After spelling `'global'` and "zero drift".
 *     `types/src/unique-scope-install-gate.ts` names it twice more as
 *     platform-wide by construction.
 *
 * So the card's first branch wins: the object is tenant-scoped only
 * incidentally (`organization_id` is kernel-injected, never authored), the
 * installation-wide constraint is correct, and the remedy is to state it —
 * plus correct the field `description`, which published the bare claim.
 *
 * ## What this file pins, and why that is the point
 *
 * The card's verification bar asks for a test that fails **if the opposite
 * becomes true**. The spelling assertions alone cannot do that: they would stay
 * green on the day someone opens a per-organization write path, and the
 * constraint would silently become wrong. So the four assertions under
 * "the reading" below pin the *premises*, not the conclusion — each one is a
 * door that is currently shut, and each goes red the moment it opens. A future
 * author who legitimately opens one is then told, by a failing test naming this
 * card, that the uniqueness scope has to be re-decided with it.
 */
describe('sys_job — declared uniqueness is installation-wide (#8578)', () => {
  const uniqueIndexes = (SysJob.indexes ?? []).filter((i: any) => i.unique);

  describe('the spelling', () => {
    it('declares exactly one unique index, on (name)', () => {
      expect(uniqueIndexes).toHaveLength(1);
      expect((uniqueIndexes[0] as any).fields).toEqual(['name']);
    });

    it("spells the scope 'global' — NOT bare `true`", () => {
      // ⛔ Asserted by EQUALITY, never by truthiness. Bare `true` is the exact
      // value this card removed, and it is truthy — a `toBeTruthy()` here would
      // pass on the defect itself.
      expect((uniqueIndexes[0] as any).unique).toBe('global');
      expect((uniqueIndexes[0] as any).unique).not.toBe(true);
    });

    it('is not left as a positional default in EITHER direction (ADR-0120 D1)', () => {
      // The card's closing condition: whichever branch the reading landed on,
      // the end state must STATE its scope. Written so it would also have held
      // had the reading gone the other way.
      expect(['global', 'organization']).toContain((uniqueIndexes[0] as any).unique);
    });

    it('is a valid IndexSchema — the spec accepts the explicit vocabulary', () => {
      expect(IndexSchema.parse(uniqueIndexes[0])).toMatchObject({
        fields: ['name'],
        unique: 'global',
      });
    });

    it('keeps the physical shape byte-identical (ADR-0120 D2 — zero drift)', () => {
      // `'global'` IS today's verbatim semantics, so this respelling is
      // semantic bookkeeping and NOT a migration: the materialized index is
      // still `(name)` over exactly the listed columns, with no tenant key part
      // prepended. Asserted on the BUILT value — `ObjectSchema.create`
      // normalizes an authored `{ fields }` into `{ fields, unique: false }`.
      expect(SysJob.indexes).toEqual([
        { fields: ['name'], unique: 'global' },
        { fields: ['active'], unique: false },
      ]);
    });
  });

  describe('the reading — these are the doors that must stay shut', () => {
    // Each assertion below is a premise of the `'global'` verdict. If one goes
    // red, a per-organization population became possible and the uniqueness
    // scope must be re-decided (the #8323 arm) — not merely re-spelled.

    it('is engine-owned, and advertises NO generic write verb (ADR-0103)', () => {
      expect((SysJob as any).managedBy).toBe('engine-owned');
      const apiMethods: string[] = (SysJob as any).enable?.apiMethods ?? [];
      expect(apiMethods).toEqual(['get', 'list']);
      // Spelled out as an exclusion too, so widening the array fails here
      // rather than only in the equality above.
      for (const verb of ['create', 'update', 'delete', 'upsert']) {
        expect(apiMethods).not.toContain(verb);
      }
    });

    it('the `job` metadata type is closed to tenants on all three flags', () => {
      // The deciding fact, quoted from the registry: "no per-org job fork".
      // Opening `allowOrgOverride` or `allowRuntimeCreate` is exactly the
      // "a tenant can register or shadow a job" branch the card named.
      const job = DEFAULT_METADATA_TYPE_REGISTRY.find((t: any) => t.type === 'job');
      expect(job).toBeDefined();
      expect((job as any).allowOrgOverride).toBe(false);
      expect((job as any).allowRuntimeCreate).toBe(false);
      expect((job as any).supportsOverlay).toBe(false);
    });

    it('the `flow` type is closed too — flow-derived job names cannot fork per org', () => {
      // The schedule / time-relative triggers key their job names on the flow
      // name (`<prefix>:${flowName}`). Those names are installation-wide
      // identities only for as long as a flow cannot be org-forked; if it can,
      // two organizations produce the same job name and this constraint turns
      // into the cross-tenant oracle after all.
      const flow = DEFAULT_METADATA_TYPE_REGISTRY.find((t: any) => t.type === 'flow');
      expect(flow).toBeDefined();
      expect((flow as any).allowOrgOverride).toBe(false);
    });

    it('carries an injected organization_id — so the scope is a real choice, not a default', () => {
      // `sys_job` IS tenant-scoped structurally (this is why the sweep flagged
      // it at all). The column exists; the verdict is that no writer ever
      // populates it per organization. Pinning this keeps the `'global'`
      // spelling an argued decision rather than an artifact of the column
      // being absent — and if the injection is ever switched off, the reading
      // above needs re-checking from a different direction (ADR-0120 S11).
      const plan = resolveInjectedSystemColumns(SysJob);
      expect((SysJob as any).tenancy).toBeUndefined();
      expect(plan.tenant).toBe(true);
      expect(plan.names.has('organization_id')).toBe(true);
    });
  });

  describe('the record correction', () => {
    it('the `name` field no longer publishes a bare "unique" claim', () => {
      // The half that was never in question (#8468 ruling): the description
      // used to say only "Unique job identifier (snake_case)", which asserts a
      // boundary-free uniqueness to every admin and AI author reading the
      // generated reference. It must now name the boundary it actually has.
      const help = String((SysJob.fields as any).name.description ?? '');
      expect(help).toMatch(/across the whole installation/);
      expect(help).not.toBe('Unique job identifier (snake_case)');
    });
  });
});
