// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { auditExpiryCutoff, windowOf, type AuditExpiryRequest } from './expiry.js';
import { bindingCrypto, memoryEngine, recordingLogger } from './seal-store.testkit.js';
import { AuditSealer } from './sealer.js';
import { amendmentBodyFromRow, type ExpiryAmendmentBody } from './signed-body.js';
import { LocalCheckpointSigner } from './signer.js';

/**
 * ADR-0154 D8, seat ruling on review 7198128323 S1: a tenant-scoped retention
 * window applies to its organization's chain, and no chain expires under a
 * window shorter than one configured for its rows; review 7202871622 S4: a
 * window is matched to each row by the column it is configured on, which need
 * not be the chain column: a chain expires under the longest window among the
 * owners of its rows, the deployment chain under the longest of all.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 26, 15, 0, 0);
const at = (days: number) => new Date(NOW - days * DAY).toISOString();

const request: AuditExpiryRequest = {
  object: 'app_ledger',
  policy: 'retention.maxAge',
  policyValue: '30d',
  cutoff: at(30),
  tenantColumn: 'tenant_id',
  tenants: [
    { tenantId: 'org_long', policyValue: '400d', cutoff: at(400) },
    { tenantId: 'org_short', policyValue: '10d', cutoff: at(10) },
  ],
};

describe('windowOf — the window each chain of a sealed object expires under', () => {
  it("an organization's chain takes its own tenant-scoped window, shorter or longer than the global one", () => {
    expect(windowOf(request, 'org:org_long', 'tenant_id')).toEqual({ cutoffMs: auditExpiryCutoff(NOW - 400 * DAY), policyValue: '400d' });
    expect(windowOf(request, 'org:org_short', 'tenant_id')).toEqual({ cutoffMs: auditExpiryCutoff(NOW - 10 * DAY), policyValue: '10d' });
  });

  it('an organization with no window of its own takes the global one', () => {
    expect(windowOf(request, 'org:org_plain', 'tenant_id')).toEqual({ cutoffMs: auditExpiryCutoff(NOW - 30 * DAY), policyValue: '30d' });
  });

  it('a chain of no one organization takes the longest of all of them', () => {
    expect(windowOf(request, 'deployment', 'tenant_id')).toEqual({ cutoffMs: auditExpiryCutoff(NOW - 400 * DAY), policyValue: '400d' });
    expect(windowOf({ ...request, tenants: [{ tenantId: 'org_short', policyValue: '10d', cutoff: at(10) }] }, 'deployment', 'tenant_id'))
      .toEqual({ cutoffMs: auditExpiryCutoff(NOW - 30 * DAY), policyValue: '30d' });
  });

  it('where the windows are configured on another column than the chain column, a chain whose owners are not read takes the longest', () => {
    const other = { ...request, tenantColumn: 'organization_id' };
    for (const key of ['org:org_short', 'org:org_long', 'org:org_plain', 'deployment']) {
      expect(windowOf(other, key, 'tenant_id')).toEqual({ cutoffMs: auditExpiryCutoff(NOW - 400 * DAY), policyValue: '400d' });
    }
  });

  it('where the windows are configured on another column, a chain takes the longest window among the owners of its rows', () => {
    // A ledger chained on `tenant_id` whose windows are configured on `organization_id`: the chain key names no owner.
    const other = { ...request, tenantColumn: 'organization_id' };
    const short = { cutoffMs: auditExpiryCutoff(NOW - 10 * DAY), policyValue: '10d' };
    const long = { cutoffMs: auditExpiryCutoff(NOW - 400 * DAY), policyValue: '400d' };
    const global = { cutoffMs: auditExpiryCutoff(NOW - 30 * DAY), policyValue: '30d' };
    expect(windowOf(other, 'org:org_long', 'tenant_id', ['org_short'])).toEqual(short);
    expect(windowOf(other, 'org:org_short', 'tenant_id', ['org_short', 'org_long'])).toEqual(long);
    expect(windowOf(other, 'org:org_short', 'tenant_id', ['org_short', 'org_plain'])).toEqual(global);
    expect(windowOf(other, 'org:org_short', 'tenant_id', ['org_short', null])).toEqual(global);
    // A row that could not be read may be anyone's.
    expect(windowOf(other, 'org:org_short', 'tenant_id', ['org_short', undefined])).toEqual(long);
    // The deployment chain takes the longest of all, whoever owns its rows.
    expect(windowOf(other, 'deployment', 'tenant_id', ['org_short'])).toEqual(long);
  });

  it('with no tenant window every chain takes the global one', () => {
    const { tenants: _, ...plain } = request;
    expect(windowOf(plain, 'org:org_long', 'tenant_id')).toEqual({ cutoffMs: auditExpiryCutoff(NOW - 30 * DAY), policyValue: '30d' });
  });
});

describe('a ledger chained on `tenant_id` beside an injected `organization_id`: each row expires under its owner\'s window (review 7202871622 S4)', () => {
  const H = 60 * 60 * 1000;
  const DAY0 = Date.UTC(2026, 10, 10);
  const hour = (h: number, m: number) => new Date(DAY0 + h * H + m * 60_000).toISOString();
  const LEDGER = {
    name: 'policy_change_log',
    fields: {
      id: { type: 'text' }, created_at: { type: 'datetime' }, tenant_id: { type: 'lookup' },
      organization_id: { type: 'lookup' }, new_value: { type: 'textarea' },
    },
    lifecycle: { class: 'audit', retention: { maxAge: '90d' }, seal: { valueFields: ['new_value'] } },
  };
  const entry = (id: string, created: string, tenant: string | null, organization: string) =>
    ({ id, created_at: created, tenant_id: tenant, organization_id: organization, new_value: `{"v":"${id}"}` });

  /** Seal the four rows at 12:30, move `archived` to the archive, and expire 60 days on: org_short 10d, org_long 400d. */
  const expireShape = async (archived: readonly string[] = []) => {
    const ledger = archived.length > 0 ? { ...LEDGER, lifecycle: { ...LEDGER.lifecycle, archive: { after: '30d', to: 'archive' } } } : LEDGER;
    const store = memoryEngine([ledger, { name: 'sys_audit_amendment', fields: {} }] as never);
    const crypto = bindingCrypto();
    const signer = new LocalCheckpointSigner({ engine: store.engine, crypto });
    const clock = { now: DAY0 + 12 * H + 30 * 60_000 };
    const sealer = new AuditSealer({ engine: store.engine, crypto, signer: () => signer, logger: recordingLogger(), now: () => clock.now });
    store.hot.table('policy_change_log').push(
      entry('s0', hour(8, 10), 'org_short', 'org_short'), // chain org:org_short, sequence 0
      entry('s1', hour(9, 10), 'org_short', 'org_long'), // chain org:org_short, sequence 1: org_long's row
      entry('l0', hour(8, 20), 'org_long', 'org_short'), // chain org:org_long: org_short's row
      entry('d0', hour(8, 30), null, 'org_short'), // the deployment chain
    );
    await sealer.runPass();
    for (const id of archived) {
      const hot = store.hot.table('policy_change_log');
      store.archive.table('policy_change_log').push(...hot.splice(hot.findIndex((r) => r.id === id), 1));
    }
    clock.now = DAY0 + 60 * DAY;
    const since = (days: number) => new Date(clock.now - days * DAY).toISOString();
    const runs = await sealer.expire({
      object: 'policy_change_log', policy: 'retention.maxAge', policyValue: '90d', cutoff: since(90),
      tenantColumn: 'organization_id',
      tenants: [
        { tenantId: 'org_short', policyValue: '10d', cutoff: since(10) },
        { tenantId: 'org_long', policyValue: '400d', cutoff: since(400) },
      ],
    });
    const signed = store.hot.table('sys_audit_amendment').map((row) => amendmentBodyFromRow(row) as ExpiryAmendmentBody);
    return {
      runs: Object.fromEntries(runs.map((r) => [r.chain, r.rowIds])),
      signed: Object.fromEntries(signed.map((b) => [b.tenant_id, [b.first_sequence, b.last_sequence, b.policy_value]])),
    };
  };

  it('a chain takes the longest window among the organizations that own its rows, whatever its chain key names', async () => {
    const { runs, signed } = await expireShape();
    expect(runs).toEqual({ 'org:org_short': ['s0'], 'org:org_long': ['l0'] });
    expect(signed).toEqual({ org_short: [0, 0, '10d'], org_long: [0, 0, '10d'] });
  });

  it('the owner of a row already archived is read from the archive', async () => {
    const { runs, signed } = await expireShape(['l0']);
    expect(runs).toEqual({ 'org:org_short': ['s0'], 'org:org_long': ['l0'] });
    expect(signed).toEqual({ org_short: [0, 0, '10d'], org_long: [0, 0, '10d'] });
  });
});
