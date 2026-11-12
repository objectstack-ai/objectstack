// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { boundOutboxRowSender, installOutboxSenderBound } from './outbox-sender-bound.js';

const configured = { name: 'Acme', address: 'noreply@acme.test' };
function source(opts: { from?: unknown; managed?: string[] } = {}) {
  const managed = new Set(opts.managed ?? []);
  return {
    getDefaultFrom: () => ('from' in opts ? (opts.from as any) : configured),
    isServiceManaged: (id: string) => managed.has(id),
  };
}

describe('an outbox row the mail service did not write is sent as the configured sender', () => {
  it('writes the configured sender over the row\'s from_address', () => {
    const row = { status: 'queued', from_address: 'ceo@acme.test', to_addresses: 'pat@example.test' };
    expect(boundOutboxRowSender('sys_email', row, source())).toBe(true);
    expect(row.from_address).toBe('Acme <noreply@acme.test>');
  });

  it('applies to both mail logs', () => {
    const row = { status: 'queued', from_address: 'ceo@acme.test' };
    expect(boundOutboxRowSender('sys_identity_email', row, source())).toBe(true);
    expect(row.from_address).toBe('Acme <noreply@acme.test>');
  });

  it('leaves the column empty when no sender is configured, so the delivery fails that row', () => {
    const row = { status: 'queued', from_address: 'ceo@acme.test' };
    boundOutboxRowSender('sys_email', row, source({ from: undefined }));
    expect(row.from_address).toBe('');
  });

  it('CONTROL: a row the service wrote keeps the sender its send decided', () => {
    const row = { id: 'em_1', status: 'queued', from_address: 'Templates <billing@acme.test>' };
    expect(boundOutboxRowSender('sys_email', row, source({ managed: ['em_1'] }))).toBe(false);
    expect(row.from_address).toBe('Templates <billing@acme.test>');
  });

  it('CONTROL: a record of mail (not queued, or already sent) keeps its from_address', () => {
    for (const row of [
      { status: 'sent', from_address: 'x@acme.test' },
      { status: 'queued', message_id: 'm1', from_address: 'x@acme.test' },
    ]) {
      expect(boundOutboxRowSender('sys_email', row, source())).toBe(false);
      expect(row.from_address).toBe('x@acme.test');
    }
    expect(boundOutboxRowSender('crm_note', { status: 'queued', from_address: 'x' }, source())).toBe(false);
  });

  it('is registered before insert on both mail logs and bounds every row of a batch', () => {
    const hooks: Array<{ event: string; object: unknown; handler: (ctx: any) => unknown }> = [];
    installOutboxSenderBound(
      { registerHook: (event, handler, options) => hooks.push({ event, object: options?.object, handler }) },
      source(),
      'pkg',
    );
    expect(hooks.map((h) => `${h.event}:${h.object}`)).toEqual(['beforeInsert:sys_email', 'beforeInsert:sys_identity_email']);
    const rows = [
      { status: 'queued', from_address: 'a@x.test' },
      { status: 'queued', from_address: 'b@x.test' },
    ];
    hooks[0].handler({ object: 'sys_email', input: { data: rows } });
    expect(rows.map((r) => r.from_address)).toEqual(['Acme <noreply@acme.test>', 'Acme <noreply@acme.test>']);
  });
});
