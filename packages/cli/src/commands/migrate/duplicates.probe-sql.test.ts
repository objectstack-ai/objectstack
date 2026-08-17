// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8928 — the SHAPE of the probes `os migrate duplicates` issues.
 *
 * These are statement-level assertions because two of the five ruled points are
 * properties of the statements themselves, invisible to a test that only reads
 * the report:
 *
 *  - **point 5, data-side** — the duplicate probe must read the object's own
 *    table and never enumerate `_objectstack_sequences`. A counter-keyed probe
 *    would still find every duplicate on the card's own repro (the counters are
 *    right there) and silently miss the ones whose counter was since merged.
 *  - **point 2, the narrow definition** — the grouping key is the value and the
 *    filter is "held in more than one `COALESCE(<tenant column>, '__global__')`
 *    partition". A probe that dropped the partition test would report ordinary
 *    in-partition repeats, which is the wider reading the ruling declined.
 */

import { describe, it, expect } from 'vitest';
import { GLOBAL_TENANT, ORGANIZATION_FIELD, SEQUENCES_TABLE } from '@objectstack/metadata-protocol';
import {
  buildDuplicateProbeSql,
  buildHolderProbeSql,
  buildLiveConditionProbeSql,
  buildSequencesPresenceProbeSql,
  collectScanTargets,
  quoteIdent,
} from './duplicates.js';

const base = {
  object: 'crm_case',
  field: 'case_number',
  partitionField: ORGANIZATION_FIELD,
  globalTenant: GLOBAL_TENANT,
};

describe('#8928 duplicate probe — data-side, partitioned, ruled shape', () => {
  it('groups by the value and keeps only values held in more than one partition', () => {
    const sql = buildDuplicateProbeSql(base);
    expect(sql).toContain('FROM "crm_case"');
    expect(sql).toContain('GROUP BY "case_number"');
    // The ruled probe: `GROUP BY value HAVING count > 1`, narrowed to the
    // cross-partition case that is the ruled definition of duplicate.
    expect(sql).toContain('HAVING COUNT(*) > 1');
    expect(sql).toContain(`COUNT(DISTINCT COALESCE("organization_id", '${GLOBAL_TENANT}')) > 1`);
  });

  it('never reads the driver-private counter table', () => {
    // The whole point of point 5: a report keyed on `_objectstack_sequences`
    // cannot see a duplicate whose counter was merged away, and cannot run at
    // all on a driver that keeps no counters.
    expect(buildDuplicateProbeSql(base)).not.toContain(SEQUENCES_TABLE);
    expect(
      buildHolderProbeSql({ ...base, valueCount: 2, withCreatedAt: true }),
    ).not.toContain(SEQUENCES_TABLE);
  });

  it('honours a declared tenantField as the partition column', () => {
    const sql = buildDuplicateProbeSql({ ...base, partitionField: 'workspace_id' });
    expect(sql).toContain(`COALESCE("workspace_id", '${GLOBAL_TENANT}')`);
    expect(sql).not.toContain('organization_id');
  });

  it('binds the values it asks holders about, and never interpolates them', () => {
    const sql = buildHolderProbeSql({ ...base, valueCount: 3, withCreatedAt: true });
    expect(sql).toContain('IN (?, ?, ?)');
    expect(sql).toContain('AS holder_id');
    expect(sql).toContain('AS organization');
    expect(sql).toContain('AS created_at');
    // The retry shape for an object that opted out of system fields.
    expect(buildHolderProbeSql({ ...base, valueCount: 1, withCreatedAt: false })).not.toContain('created_at');
  });

  it('refuses an identifier that is not a plain SQL name', () => {
    expect(() => buildDuplicateProbeSql({ ...base, object: 'crm_case"; DROP TABLE x --' })).toThrow(
      /unsafe identifier/,
    );
    expect(() => buildHolderProbeSql({ ...base, field: 'a-b', valueCount: 1, withCreatedAt: true })).toThrow(
      /unsafe identifier/,
    );
  });

  it('quotes for the dialect actually connected — MySQL does not run ANSI_QUOTES', () => {
    expect(quoteIdent('crm_case')).toBe('"crm_case"');
    expect(quoteIdent('crm_case', 'mysql2')).toBe('`crm_case`');
    const mysql = buildDuplicateProbeSql({ ...base, client: 'mysql2' });
    expect(mysql).toContain('FROM `crm_case`');
    // Under MySQL's default sql_mode a double-quoted name is a string literal,
    // so a probe written with one quoting style for every dialect would compare
    // the literal 'case_number' with itself and report nothing, forever.
    expect(mysql).not.toContain('"case_number"');
  });
});

describe('#8928 live-condition probe — a __global__ counter standing BESIDE an org one', () => {
  it('inner-joins the two counter rows and binds the sentinel', () => {
    const sql = buildLiveConditionProbeSql(SEQUENCES_TABLE);
    expect(sql).toContain(`FROM "${SEQUENCES_TABLE}" g JOIN "${SEQUENCES_TABLE}" o`);
    expect(sql).toContain('o.tenant_id <> ?');
    expect(sql).toContain('WHERE g.tenant_id = ?');
    // "Beside" is the claim: a LEFT JOIN would also report an object whose
    // organization-scoped counter does not exist yet, which is the *repair's*
    // trigger, not the condition the ruling asked to be reported.
    expect(sql).not.toMatch(/LEFT JOIN/i);
  });

  it('probes for the counter table before reading it', () => {
    expect(buildSequencesPresenceProbeSql(SEQUENCES_TABLE)).toBe(
      `SELECT tenant_id FROM "${SEQUENCES_TABLE}" WHERE 1 = 0`,
    );
  });
});

describe('#8928 scan targets — which (object, field) pairs are in the population', () => {
  const objects = [
    {
      name: 'crm_case',
      fields: {
        case_number: { type: 'autonumber' },
        external_ref: { type: 'text', unique: 'organization' },
        subject: { type: 'text' },
      },
    },
    { name: 'crm_note', fields: { body: { type: 'text' } } },
    {
      name: 'sys_license',
      tenancy: { enabled: false },
      fields: { serial: { type: 'text', unique: 'global' } },
    },
    {
      name: 'ai_thread',
      fields: { thread_no: { type: 'autonumber' } },
    },
    {
      name: 'wk_task',
      tenancy: { enabled: true, tenantField: 'workspace_id' },
      fields: { workspace_id: { type: 'text' }, task_no: { type: 'autonumber' } },
    },
  ];

  it('scans autonumber and unique fields, and no others', () => {
    const { targets } = collectScanTargets(objects, { organizationField: ORGANIZATION_FIELD });
    expect(targets.map((t) => `${t.object}.${t.field}`)).toEqual([
      // Platform namespaces are NOT filtered out: that filter is correct for a
      // repair and wrong for a report, which must not omit a real duplicate.
      'ai_thread.thread_no',
      'crm_case.case_number',
      'crm_case.external_ref',
      'wk_task.task_no',
    ]);
    expect(targets.find((t) => t.field === 'task_no')?.partitionField).toBe('workspace_id');
    expect(targets.find((t) => t.field === 'case_number')?.identifier).toBe('autonumber');
    expect(targets.find((t) => t.field === 'external_ref')?.uniqueScope).toBe('organization');
  });

  it('says out loud why an organization-unscoped object was not scanned', () => {
    const { skipped } = collectScanTargets(objects, { organizationField: ORGANIZATION_FIELD });
    expect(skipped).toEqual([
      {
        object: 'sys_license',
        reason: 'object declares tenancy.enabled = false — its uniqueness is not organization-partitioned',
      },
    ]);
  });

  it('narrows to one object when asked, and reports nothing else', () => {
    const { targets } = collectScanTargets(objects, {
      organizationField: ORGANIZATION_FIELD,
      objectFilter: 'crm_case',
    });
    expect(new Set(targets.map((t) => t.object))).toEqual(new Set(['crm_case']));
  });
});
