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
// passes NO `organizationId`, so every row it writes is stamped
// `organization_id: null`. A fix that kept only the equality limb would look
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
const ORG_C = 'org_gamma';
const NAME = 'shared_grid';

const ACTOR_A = 'alice@alpha.example';
const ACTOR_B = 'bob@beta.example';
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
 * Three saves of ONE view name through the real `saveMetaItem` write path —
 * two tenant overlays and one env-wide package write. Rows are seeded by the
 * production writer, not hand-inserted, so the stamps under test are the
 * stamps production produces.
 */
async function seedThreeOrgs(protocol: any) {
  await protocol.saveMetaItem({
    type: 'view', name: NAME, item: viewBody(NAME),
    organizationId: ORG_A, actor: ACTOR_A, source: 'studio',
  });
  await protocol.saveMetaItem({
    type: 'view', name: NAME, item: viewBody(NAME),
    organizationId: ORG_B, actor: ACTOR_B, source: 'studio',
  });
  await protocol.saveMetaItem({
    type: 'view', name: NAME, item: viewBody(NAME),
    actor: ACTOR_ENV, source: 'package',
  });
}

const actorsOf = (result: any) => (result.events as any[]).map((e) => e.actor).sort();

describe('#8747 auditMetaItem organization scope (real engine + real SqlDriver)', () => {
  it('seeds three organizations onto one (type, name) — the precondition the scope is judged against', async () => {
    const { engine, protocol } = await boot();
    await seedThreeOrgs(protocol);

    const raw = (await engine.find('sys_metadata_audit', { where: {} })) as any[];
    const stamps = raw
      .filter((r) => r.name === NAME)
      .map((r) => `${r.actor}:${r.organization_id ?? 'ENV'}`)
      .sort();

    // The write path stamps all three distinctly. If this ever collapses, the
    // scope assertions below would pass vacuously, so it is asserted first.
    expect(stamps).toEqual([
      `${ACTOR_A}:${ORG_A}`,
      `${ACTOR_B}:${ORG_B}`,
      `${ACTOR_ENV}:ENV`,
    ]);
  });

  it('BOTH DIRECTIONS: an org-scoped read sees its own rows AND env-wide rows, and NOT a third org', async () => {
    const { protocol } = await boot();
    await seedThreeOrgs(protocol);

    const result = await (protocol as any).auditMetaItem({
      type: 'view', name: NAME, organizationId: ORG_A,
    });
    const actors = actorsOf(result);

    // (1) own-org rows visible — without this the filter is "hides everything".
    expect(actors).toContain(ACTOR_A);
    // (2) env-wide rows visible — THE discriminating control. Package-level
    //     and REST-authored writes are env-wide and must stay in the tab.
    expect(actors).toContain(ACTOR_ENV);
    // (3) the third org is gone — the disclosure this card exists to close.
    expect(actors).not.toContain(ACTOR_B);

    expect(actors).toEqual([ACTOR_A, ACTOR_ENV].sort());
  });

  it('is symmetric — org_beta sees its own rows plus env-wide, never org_alpha', async () => {
    const { protocol } = await boot();
    await seedThreeOrgs(protocol);

    const actors = actorsOf(await (protocol as any).auditMetaItem({
      type: 'view', name: NAME, organizationId: ORG_B,
    }));

    expect(actors).toEqual([ACTOR_B, ACTOR_ENV].sort());
    expect(actors).not.toContain(ACTOR_A);
  });

  it('an organization with no rows of its own still sees the env-wide rows, and only those', async () => {
    const { protocol } = await boot();
    await seedThreeOrgs(protocol);

    // A tenant that has never overlaid this item must still see the package
    // install that put it there — and nobody else's overlays.
    const actors = actorsOf(await (protocol as any).auditMetaItem({
      type: 'view', name: NAME, organizationId: ORG_C,
    }));

    expect(actors).toEqual([ACTOR_ENV]);
  });

  it('an org-less read is fail-closed: env-wide rows only, never every tenant\'s', async () => {
    const { protocol } = await boot();
    await seedThreeOrgs(protocol);

    // This is the exact call shape that leaked before the fix — the production
    // route omitted `organizationId` entirely. It must no longer be a skeleton
    // key. `?? null` folds it onto the env-wide read, symmetric with what an
    // org-less write produces.
    const actors = actorsOf(await (protocol as any).auditMetaItem({
      type: 'view', name: NAME,
    }));

    expect(actors).toEqual([ACTOR_ENV]);
    expect(actors).not.toContain(ACTOR_A);
    expect(actors).not.toContain(ACTOR_B);
  });

  it('an explicit organizationId: null reads env-wide rows, same as omitting it', async () => {
    const { protocol } = await boot();
    await seedThreeOrgs(protocol);

    const actors = actorsOf(await (protocol as any).auditMetaItem({
      type: 'view', name: NAME, organizationId: null,
    }));

    expect(actors).toEqual([ACTOR_ENV]);
  });

  it('scoping does not disturb the (type, name) key — a different item is still excluded', async () => {
    const { protocol } = await boot();
    await seedThreeOrgs(protocol);
    await (protocol as any).saveMetaItem({
      type: 'view', name: 'other_grid', item: viewBody('other_grid'),
      organizationId: ORG_A, actor: 'carol@alpha.example', source: 'studio',
    });

    const actors = actorsOf(await (protocol as any).auditMetaItem({
      type: 'view', name: NAME, organizationId: ORG_A,
    }));

    expect(actors).not.toContain('carol@alpha.example');
    expect(actors).toEqual([ACTOR_A, ACTOR_ENV].sort());
  });
});
