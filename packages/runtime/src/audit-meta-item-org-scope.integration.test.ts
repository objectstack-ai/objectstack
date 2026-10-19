// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Real-engine regression for #8747 — `protocol.auditMetaItem` returned EVERY
// organization's `sys_metadata_audit` rows for a `(type, name)`, disclosing
// another tenant's `actor` / `note` / `lock_state` through Studio's audit tab
// and the published `meta.getAudit` SDK surface.
//
// ## Why this test uses a real driver rather than a recording double
//
// The defect was an ABSENT predicate, and the fix is a `$or` the SQL layer has
// to execute. A double that records the `where` proves the shape was built; it
// cannot prove the shape SELECTS the right rows, and the two failure modes here
// are opposite and equally plausible:
//
//   - too wide  → the disclosure is still open (the bug as filed);
//   - too narrow → `organization_id = :org` alone hides the env-wide rows, and
//     the audit tab goes blank on every deployment that authors through REST.
//
// That second one is not hypothetical. The REST `PUT /meta/:type/:name` door
// passes NO `organizationId`, so every row it writes is the environment's
// (since ADR-0131 D7 no audit row carries an organization column at all). A
// fix that kept only the equality limb would look
// correct in a shape assertion and return nothing in production. So the
// env-wide row below is the DISCRIMINATING control, not a courtesy case: it is
// the assertion that separates "correctly scoped" from "hides everything".
//
// The query-shape half is pinned separately, next to the code that builds it,
// in `packages/metadata-protocol/src/protocol.audit-org-scope.test.ts`.
//
// Harness shape copied from `package-uninstall-org-scope.integration.test.ts`,
// the existing precedent for exactly this defect class (a strict
// `organization_id` equality dropping env-wide rows).

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysMetadataAuditObject,
} from '@objectstack/metadata-core';

const ORG_A = 'org_alpha';
const ORG_B = 'org_beta';
const NAME = 'shared_grid';

const ACTOR_A = 'alice@alpha.example';
const ACTOR_ENV = 'package-installer';

let cleanup: Array<() => void> = [];
afterEach(() => {
  for (const c of cleanup) c();
  cleanup = [];
});

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'os-8747-'));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: join(dir, 'data.sqlite') },
    useNullAsDefault: true,
  });
  const objects = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject] as any[];
  await driver.initObjects(objects);
  const engine = new ObjectQL();
  engine.registerDriver(driver as any, true);
  await engine.init();
  for (const o of objects) engine.registry.registerObject(o, '@objectstack/platform-objects');
  cleanup.push(() => { void engine.destroy(); });
  const protocol = new ObjectStackProtocolImplementation(
    engine as any,
    undefined,
    undefined,
    'package-author',
  );
  return { engine, protocol };
}

const viewBody = (name: string) => ({
  name,
  label: name,
  type: 'grid',
  object: 'anything',
  viewKind: 'list',
  data: { provider: 'object', object: 'anything' },
  columns: ['id'],
});

/**
 * Two audit-bearing saves on ONE view name, both through the production writer
 * (`saveMetaItem`): a package install and a later Studio edit.
 *
 * [ADR-0131 D6/D7] The protocol refuses every organization-scoped write, and
 * the audit table declares no organization column, so no organization's row
 * can exist to be hidden: the read under test is the environment's trail,
 * whatever organization a caller names. #8747's disclosure stays closed by
 * construction; what this file still pins against a real driver is that the
 * read SELECTS that trail — every save of the item, and no other item's.
 */
async function seedTwoSaves(protocol: any) {
  await protocol.saveMetaItem({
    type: 'view', name: NAME, item: viewBody(NAME),
    actor: ACTOR_ENV, source: 'package',
  });
  await protocol.saveMetaItem({
    type: 'view', name: NAME, item: { ...viewBody(NAME), label: 'Shared grid (edited)' },
    actor: ACTOR_A, source: 'studio',
  });
}

const actorsOf = (result: any) => (result.events as any[]).map((e) => e.actor).sort();

describe('#8747 auditMetaItem reads the environment\'s trail (real engine + real SqlDriver)', () => {
  it('seeds two saves onto one (type, name), and no audit row carries an organization column', async () => {
    const { engine, protocol } = await boot();
    await seedTwoSaves(protocol);

    const raw = ((await engine.find('sys_metadata_audit', { where: {} })) as any[]).filter((r) => r.name === NAME);
    // The write path records both. If this ever collapses, the read
    // assertions below would pass vacuously, so it is asserted first.
    expect(raw.map((r) => r.actor).sort()).toEqual([ACTOR_A, ACTOR_ENV].sort());
    for (const row of raw) expect(row).not.toHaveProperty('organization_id');
  });

  it('[ADR-0131 D6] every caller — an organization, another, none, an explicit null — reads the same trail', async () => {
    const { protocol } = await boot();
    await seedTwoSaves(protocol);

    for (const organizationId of [ORG_A, ORG_B, undefined, null]) {
      const actors = actorsOf(await (protocol as any).auditMetaItem({
        type: 'view', name: NAME, ...(organizationId === undefined ? {} : { organizationId }),
      }));
      expect(actors, String(organizationId)).toEqual([ACTOR_A, ACTOR_ENV].sort());
    }
  });

  it('the (type, name) key holds — a different item is excluded', async () => {
    const { protocol } = await boot();
    await seedTwoSaves(protocol);
    await protocol.saveMetaItem({
      type: 'view', name: 'other_grid', item: viewBody('other_grid'),
      actor: 'carol@alpha.example', source: 'studio',
    });

    const actors = actorsOf(await (protocol as any).auditMetaItem({ type: 'view', name: NAME }));

    expect(actors).not.toContain('carol@alpha.example');
    expect(actors).toEqual([ACTOR_A, ACTOR_ENV].sort());
  });
});
