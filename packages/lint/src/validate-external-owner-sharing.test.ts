// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { defineStack } from '@objectstack/spec';
import { runAuthoringRules, splitBySeverity } from './authoring-rules.js';
import {
  SECURITY_EXTERNAL_OWNER_UNMAPPED,
  validateExternalOwnerSharing,
} from './validate-external-owner-sharing.js';

/**
 * The two external objects of `packages/runtime/src/plugin-driver-external-object.spike.test.ts`,
 * copied verbatim (fields trimmed to what the rule reads). That spike measures the runtime half:
 * on `spike_owned` (no `sharingModel`) a member holding `allowEdit` is refused every PATCH (404
 * since #27425: the read scope admits no row),
 * step (e3); on `spike_node` (`public_read_write`) the same member's write reaches the driver.
 */
const SPIKE_STACK = defineStack({
  manifest: { id: 'com.spike.plugin-driver', name: 'Plugin driver spike', version: '1.0.0', type: 'app' },
  datasources: [
    {
      name: 'spike_tree',
      label: 'Spike tree (plugin driver)',
      driver: 'spike_tree',
      schemaMode: 'external',
      config: {},
      external: { allowWrites: true, validation: { onMismatch: 'fail', checkOnBoot: false } },
    },
  ],
  objects: [
    {
      name: 'spike_node',
      label: 'Spike node',
      datasource: 'spike_tree',
      external: { remoteName: 'nodes', writable: true },
      sharingModel: 'public_read_write',
      fields: { name: { type: 'text', label: 'Name' } },
    },
    {
      name: 'spike_owned',
      label: 'Spike owned',
      datasource: 'spike_tree',
      external: { remoteName: 'owned', writable: true },
      fields: { name: { type: 'text', label: 'Name' } },
    },
  ],
}) as unknown as Record<string, unknown>;

const NAME_FIELD = { name: { type: 'text', label: 'Name' } };

/** One external object, writable unless the override says otherwise. */
function ext(overrides: Record<string, unknown> = {}, external: Record<string, unknown> = {}) {
  return {
    name: 'remote_row',
    label: 'Remote row',
    datasource: 'remote',
    external: { remoteName: 'rows', writable: true, ...external },
    fields: NAME_FIELD,
    ...overrides,
  };
}

const findingsFor = (...objects: unknown[]) => validateExternalOwnerSharing({ objects });

describe('security-external-owner-unmapped — the spike shapes', () => {
  const findings = validateExternalOwnerSharing(SPIKE_STACK);

  it('spike_owned (the default sharing model) gets one warning naming the owner_id column', () => {
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'warning',
      rule: SECURITY_EXTERNAL_OWNER_UNMAPPED,
      where: 'object "spike_owned"',
      path: 'objects[1].sharingModel',
    });
    expect(findings[0]!.message).toContain("'owner_id'");
  });

  it('spike_node (public_read_write) gets none', () => {
    expect(findings.filter((f) => f.where === 'object "spike_node"')).toEqual([]);
  });

  it('`os validate` reports it as an advisory, never a gating error', () => {
    const all = runAuthoringRules('validate', { normalized: SPIKE_STACK, parsed: SPIKE_STACK });
    const { errors, advisories } = splitBySeverity(all);
    expect(errors.filter((f) => f.rule === SECURITY_EXTERNAL_OWNER_UNMAPPED)).toEqual([]);
    expect(advisories.filter((f) => f.rule === SECURITY_EXTERNAL_OWNER_UNMAPPED).map((f) => f.where)).toEqual([
      'object "spike_owned"',
    ]);
  });
});

describe('security-external-owner-unmapped — which objects it judges', () => {
  it('warns on an owner-keyed model: unset, private and public_read', () => {
    for (const sharingModel of [undefined, 'private', 'public_read']) {
      const obj = sharingModel === undefined ? ext() : ext({ sharingModel });
      expect(findingsFor(obj).map((f) => f.rule), String(sharingModel)).toEqual([SECURITY_EXTERNAL_OWNER_UNMAPPED]);
    }
  });

  it('stays silent on public_read_write and controlled_by_parent', () => {
    expect(findingsFor(ext({ sharingModel: 'public_read_write' }))).toEqual([]);
    expect(findingsFor(ext({ sharingModel: 'controlled_by_parent' }))).toEqual([]);
  });

  it('stays silent on a read-only binding', () => {
    expect(findingsFor(ext({ sharingModel: 'private' }, { writable: false }))).toEqual([]);
    expect(findingsFor({ ...ext({ sharingModel: 'private' }), external: { remoteName: 'rows' } })).toEqual([]);
  });

  it('stays silent on a datasource this stack declares with allowWrites: false, and warns when it allows writes', () => {
    const datasource = (allowWrites: boolean) => ({ name: 'remote', schemaMode: 'external', external: { allowWrites } });
    const obj = ext({ sharingModel: 'private' });
    expect(validateExternalOwnerSharing({ datasources: [datasource(false)], objects: [obj] })).toEqual([]);
    expect(
      validateExternalOwnerSharing({ datasources: [datasource(true)], objects: [obj] }).map((f) => f.rule),
    ).toEqual([SECURITY_EXTERNAL_OWNER_UNMAPPED]);
  });

  it('stays silent on an object the platform stores, and on a system object with no sharingModel', () => {
    const { external: _external, ...local } = ext({ sharingModel: 'private' });
    expect(findingsFor(local)).toEqual([]);
    expect(findingsFor(ext({ isSystem: true }))).toEqual([]);
  });

  it('stays silent when the author declares owner_id, with or without a columnMap entry for it', () => {
    const fields = { ...NAME_FIELD, owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner' } };
    expect(findingsFor(ext({ sharingModel: 'private', fields }))).toEqual([]);
    expect(findingsFor(ext({ sharingModel: 'private', fields }, { columnMap: { assignee: 'owner_id' } }))).toEqual([]);
  });

  it('a columnMap entry alone does not silence it: only a built-in SQL driver applies columnMap', () => {
    const findings = findingsFor(ext({ sharingModel: 'private' }, { columnMap: { assignee: 'owner_id' } }));
    expect(findings.map((f) => f.rule)).toEqual([SECURITY_EXTERNAL_OWNER_UNMAPPED]);
    expect(findings[0]!.message).toContain("'owner_id'");
    expect(findings[0]!.message).toContain('columnMap');
  });

  it('[#27425] names the refusal the model produces: 404 on private (reads are scoped too), 403 on public_read', () => {
    for (const obj of [ext(), ext({ sharingModel: 'private' }), ext({ sharingModel: 'private' }, { columnMap: { assignee: 'owner_id' } })]) {
      expect(findingsFor(obj)[0]!.message).toContain("refused (404: the member's read scope admits no row)");
    }
    expect(findingsFor(ext({ sharingModel: 'public_read' }))[0]!.message).toContain('refused (403)');
    expect(findingsFor(ext({ sharingModel: 'private', ownership: 'none' }))[0]!.message).toContain('refused (403)');
  });

  it('a columnMap that maps only created_by does not serve the owner check', () => {
    const findings = findingsFor(ext({ sharingModel: 'private' }, { columnMap: { author: 'created_by' } }));
    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("'owner_id'");
  });
});

describe("security-external-owner-unmapped — ownership: 'none' moves the refusal to the floor", () => {
  it('warns on an object with no owner_id, naming created_by', () => {
    for (const ownership of ['none', 'org', 'business_unit']) {
      const findings = findingsFor(ext({ sharingModel: 'private', ownership }));
      expect(findings, ownership).toHaveLength(1);
      expect(findings[0]!.message, ownership).toContain("'created_by'");
    }
  });

  it('warns when the audit columns are off, and on a columnMap entry for created_by alone', () => {
    const noAudit = findingsFor(ext({ sharingModel: 'private', ownership: 'none', systemFields: { audit: false } }));
    expect(noAudit).toHaveLength(1);
    expect(noAudit[0]!.message).toContain("'created_by'");
    const mapped = findingsFor(ext({ sharingModel: 'private', ownership: 'none' }, { columnMap: { author: 'created_by' } }));
    expect(mapped).toHaveLength(1);
    expect(mapped[0]!.message).toContain("'created_by'");
    expect(mapped[0]!.message).toContain('columnMap');
  });

  it('is silent when the author declares created_by', () => {
    const fields = { ...NAME_FIELD, created_by: { type: 'lookup', reference: 'sys_user', label: 'Created by' } };
    expect(findingsFor(ext({ sharingModel: 'private', ownership: 'none', fields }))).toEqual([]);
  });

  it('is silent on public_read_write whatever the ownership tier', () => {
    expect(findingsFor(ext({ sharingModel: 'public_read_write', ownership: 'none' }))).toEqual([]);
  });
});

describe('security-external-owner-unmapped — the fix line', () => {
  // The hint is the author's whole remedy: pinned whole, so a way out cannot be
  // dropped or an unmeasured one added without this test saying so.
  const hintOf = (obj: unknown) => findingsFor(obj).map((f) => f.hint);

  it('names both ways out for an undeclared owner_id', () => {
    expect(hintOf(ext({ sharingModel: 'private' }))).toEqual([
      "Either declare sharingModel: 'public_read_write' and decide who may edit in a beforeUpdate hook, or " +
        'declare owner_id in fields and have the driver return the remote owner under that name (a built-in ' +
        'SQL driver does it through external.columnMap; a plugin driver must return it itself)',
    ]);
  });

  it('asks for the declaration when columnMap alone targets owner_id', () => {
    expect(hintOf(ext({ sharingModel: 'private' }, { columnMap: { assignee: 'owner_id' } }))).toEqual([
      'Declare owner_id in fields (a plugin driver must return the remote owner under that name itself), ' +
        "or declare sharingModel: 'public_read_write' and decide who may edit in a beforeUpdate hook",
    ]);
  });

  it('names created_by on an object without owner_id, the audit columns on or off', () => {
    const expected =
      "Either declare sharingModel: 'public_read_write' and decide who may edit in a beforeUpdate hook, or " +
      'declare created_by in fields and have the driver return the remote creator under that name (a built-in ' +
      'SQL driver does it through external.columnMap; a plugin driver must return it itself)';
    expect(hintOf(ext({ sharingModel: 'private', ownership: 'none' }))).toEqual([expected]);
    expect(hintOf(ext({ sharingModel: 'private', ownership: 'none', systemFields: { audit: false } }))).toEqual([expected]);
  });

  it('a declared created_by with the audit columns off is enough', () => {
    const fields = { ...NAME_FIELD, created_by: { type: 'lookup', reference: 'sys_user', label: 'Created by' } };
    expect(findingsFor(ext({ sharingModel: 'private', ownership: 'none', systemFields: { audit: false }, fields }))).toEqual([]);
  });

  it('the verdict leaves room for an app-authored row-level policy', () => {
    for (const f of findingsFor(ext({ sharingModel: 'private' }), ext({ sharingModel: 'private', ownership: 'none' }))) {
      expect(f.message).toContain('unless an app-authored row-level policy admits the row');
    }
  });
});
