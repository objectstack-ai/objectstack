// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * End-to-end acceptance for #4498's CLI half: `os migrate meta --stored` still
 * covers `flow` rows after the command stopped threading `canonicalizeFlow`.
 *
 * #4454 wired flow coverage by resolving `automation` off the booted kernel in
 * the command body and handing `canonicalizeStoredFlow` to
 * `migrateStoredMetadata`. #4498 gave the protocol its own resolver — it is
 * constructed with an accessor for the kernel's service table, which is the
 * same table the inert engine registers into — so the command passes nothing
 * and the redundant second route is gone.
 *
 * That is exactly the kind of removal a unit test cannot defend: every flag test
 * still passes if the protocol silently fails to find the engine, and the only
 * symptom is flow rows quietly reporting `skipped` again. So this boots the
 * REAL stack the command boots (`bootSchemaStack` +
 * `buildDataMigrationPlugins({ automation: true })`), seeds a pre-17 flow row,
 * and asserts the rewrite lands in the database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import { bootSchemaStack } from '../../utils/schema-migrate.js';
import { buildDataMigrationPlugins } from '../../utils/data-migration-plugins.js';

/**
 * `SchemaStack.kernel` is untyped, so a type argument is a TS2347 — the slot's
 * contract is stated on the RESULT instead. Narrowing, not erasing: `: any`
 * here would switch off checking on every `ql.*` call below while looking
 * identical to code that has it (the `slot-lookup` rule's whole point).
 */
const engineOf = (stack: { kernel: any }): IObjectQLEngine =>
  stack.kernel.getService('objectql') as IObjectQLEngine;

/** Elevated so the seed write bypasses RLS on a system object. */
const SYSTEM = { context: { isSystem: true } };

const ARTIFACT = {
  // #8687: manifest fields under `manifest:` — the flat spelling is refused.
  manifest: { id: 'stored_flow_smoke', name: 'Stored Flow Smoke', version: '0.0.0', type: 'app' },
  objects: [{ name: 'sfs_lead', fields: { title: { type: 'text' } } }],
};

/**
 * A pre-17 flow: `delete_record` carrying `config.filters`, which the
 * `flow-node-crud-filter-alias` conversion (toMajor 11) renames to `filter`.
 * Written straight into `sys_metadata`, bypassing today's schema gate — exactly
 * like a row saved years ago under an older protocol.
 */
const LEGACY_FLOW = {
  name: 'sfs_purge',
  label: 'Purge Stale Leads',
  type: 'autolaunched',
  status: 'active',
  nodes: [
    { id: 'n0', type: 'start', label: 'Start' },
    {
      id: 'n1',
      type: 'delete_record',
      label: 'Purge',
      config: { objectName: 'sfs_lead', filters: { title: 'stale' } },
    },
  ],
  edges: [{ id: 'e1', source: 'n0', target: 'n1' }],
};

describe('os migrate meta --stored — the protocol resolves the engine itself (#4498)', () => {
  let dir: string;
  let dbFile: string;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-stored-flow-'));
    mkdirSync(join(dir, 'dist'), { recursive: true });
    mkdirSync(join(dir, 'data'), { recursive: true });
    dbFile = join(dir, 'data', 'app.db');
    writeFileSync(join(dir, 'dist', 'objectstack.json'), JSON.stringify(ARTIFACT));

    savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    process.env.OS_ARTIFACT_PATH = savedEnv.OS_ARTIFACT_PATH;
    process.env.NODE_ENV = savedEnv.NODE_ENV;
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('rewrites a pre-17 flow row with NO canonicalizeFlow passed by the command', async () => {
    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${dbFile}`,
      projectRoot: dir,
      extraPlugins: await buildDataMigrationPlugins({ automation: true }),
    });
    try {
      const ql = engineOf(stack);
      await ql.insert('sys_metadata', {
        type: 'flow',
        name: 'sfs_purge',
        state: 'active',
        metadata: JSON.stringify(LEGACY_FLOW),
      }, SYSTEM);

      const protocol: any = stack.kernel.getService('protocol');

      // The command's exact call since #4498 — no `canonicalizeFlow`.
      const report = await protocol.migrateStoredMetadata({
        apply: true,
        types: ['flow'],
        actor: 'os migrate meta --stored',
      });

      // Before the resolver this row came back `skipped` with "no automation
      // service is reachable". Asserted as the REASON rather than as a bare
      // count, so a regression here says what went wrong instead of just
      // "expected 1 to be 0".
      expect(
        report.rows
          .filter((r: any) => r.outcome === 'skipped' || r.outcome === 'failed')
          .map((r: any) => `${r.outcome}: ${r.reason}`),
      ).toEqual([]);
      expect(report.skipped).toBe(0);
      expect(report.failed).toBe(0);
      expect(report.rewritten).toBe(1);

      // …and the bytes on disk actually moved.
      const [row] = await ql.find('sys_metadata', {
        where: { type: 'flow', name: 'sfs_purge', state: 'active' },
      }, SYSTEM);
      const stored = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      const node = stored.nodes.find((n: any) => n.id === 'n1');
      expect(node.config).toEqual({ objectName: 'sfs_lead', filter: { title: 'stale' } });
      expect(node.config).not.toHaveProperty('filters');

      // The write-back must NOT carry the schema's defaults (#4454): persisting
      // a `version` / `runAs` the author never wrote would pin this row to
      // today's value while untouched rows follow tomorrow's.
      expect(stored).not.toHaveProperty('runAs');
      expect(stored.edges[0]).not.toHaveProperty('isDefault');

      // A second pass has nothing left to do — the finish line the whole
      // feature exists to provide.
      const rerun = await protocol.migrateStoredMetadata({ types: ['flow'] });
      expect(rerun.scanned).toBe(1);
      expect(rerun.canonical).toBe(1);
      expect(rerun.pending).toBe(0);
    } finally {
      await stack.shutdown();
    }
  }, 120_000);

  it('a Studio edit heals the row — save persists the canonical dialect (#4542)', async () => {
    // The other half of the acceptance: the migration is no longer the ONLY
    // path that retires a legacy flow row. An author's ordinary round-trip —
    // GET (served the legacy dialect, per the ADR-0078 read skip) → edit a
    // label → PUT the body back — used to re-persist `config.filters`
    // verbatim and leave the row `pending` forever; `saveMetaItem` now
    // canonicalizes flow bodies before its schema gate.
    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${dbFile}`,
      projectRoot: dir,
      extraPlugins: await buildDataMigrationPlugins({ automation: true }),
    });
    try {
      const ql = engineOf(stack);
      await ql.insert('sys_metadata', {
        type: 'flow',
        name: 'sfs_purge',
        state: 'active',
        metadata: JSON.stringify(LEGACY_FLOW),
      }, SYSTEM);

      const protocol: any = stack.kernel.getService('protocol');

      // The read serves the stored (legacy) dialect — that skip is deliberate
      // and unchanged; the heal happens on the way back in.
      const served = await protocol.getMetaItem({ type: 'flow', name: 'sfs_purge' });
      const item = served?.item ?? served;
      expect(item.nodes.find((n: any) => n.id === 'n1').config).toHaveProperty('filters');

      // Edit only the label — exactly the probe from #4542. Explicit
      // `parentVersion: null`: a raw-seeded row has `checksum: null`, so the
      // derived parent would disagree with the column and 409 (probe-only
      // artifact; governed rows always carry a checksum).
      await protocol.saveMetaItem({
        type: 'flow',
        name: 'sfs_purge',
        item: { ...item, label: 'Purge Stale Leads (edited)' },
        parentVersion: null,
        actor: 'studio-roundtrip-probe',
      });

      const [row] = await ql.find('sys_metadata', {
        where: { type: 'flow', name: 'sfs_purge', state: 'active' },
      }, SYSTEM);
      const stored = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
      expect(stored.label).toBe('Purge Stale Leads (edited)');
      const node = stored.nodes.find((n: any) => n.id === 'n1');
      expect(node.config).toEqual({ objectName: 'sfs_lead', filter: { title: 'stale' } });
      expect(node.config).not.toHaveProperty('filters');
      // Still no schema defaults — the save persists `storable`, not `parsed`.
      expect(stored).not.toHaveProperty('runAs');

      // The row the edit healed is retired from the stored report: the
      // `--stored` preview that stayed `pending` "no matter how many times an
      // author edits it" now comes back canonical.
      const preview = await protocol.migrateStoredMetadata({ types: ['flow'] });
      expect(preview.scanned).toBe(1);
      expect(preview.canonical).toBe(1);
      expect(preview.pending).toBe(0);
    } finally {
      await stack.shutdown();
    }
  }, 120_000);

  it('without the automation plugin the row is skipped with the reason, never counted done', async () => {
    // The honest negative: the coverage comes from the engine being present,
    // not from the report defaulting to optimistic.
    const stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${dbFile}`,
      projectRoot: dir,
      extraPlugins: await buildDataMigrationPlugins(),
    });
    try {
      const ql = engineOf(stack);
      await ql.insert('sys_metadata', {
        type: 'flow',
        name: 'sfs_purge',
        state: 'active',
        metadata: JSON.stringify(LEGACY_FLOW),
      }, SYSTEM);

      const protocol: any = stack.kernel.getService('protocol');
      const report = await protocol.migrateStoredMetadata({ apply: true, types: ['flow'] });

      expect(report.rewritten).toBe(0);
      expect(report.skipped).toBe(1);
      expect(report.rows[0].reason).toMatch(/no automation service is reachable/);
    } finally {
      await stack.shutdown();
    }
  }, 120_000);
});
