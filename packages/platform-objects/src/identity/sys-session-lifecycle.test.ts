// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7826] `sys_session`'s ADR-0057 lifecycle declaration, at the SPEC tier.
//
// This is the third control on the card: the declaration parses, and neither
// of #10165's two `ttl.onlyWhen` conflict refines fires for it.
//
// ⚠️ "Neither refine fires" is worth nothing as a bare absence — `sys_session`
// declares no `archive` and no rotation `storage`, so of course they do not
// fire, and the same green would be printed by a build in which both refines
// had been deleted. So each is measured against its own counterfactual: the
// exact declaration plus the conflicting block must be REFUSED, with #10165's
// own message. That turns "no refine fired" into a statement about live rules.
//
// The sweep behaviour these keys buy — the tombstone-sparing and positive
// controls — is measured where a real Reaper and a real SQL backend are
// reachable: `@objectstack/plugin-auth`'s `sys-session-ttl-sweep.test.ts`.

import { describe, it, expect } from 'vitest';
import { LifecycleSchema, ObjectSchema } from '@objectstack/spec/data';
import { SysSession } from './sys-session.object.js';
import { SysDeviceCode } from './sys-device-code.object.js';

const lifecycle = (SysSession as any).lifecycle;

describe('[#7826] sys_session lifecycle declaration', () => {
  it('is exactly the ruled declaration (maintainer 2026-08-20, option A)', () => {
    expect(lifecycle).toEqual({
      class: 'transient',
      ttl: {
        field: 'expires_at',
        expireAfter: '1d',
        onlyWhen: { revoked_at: { $null: true } },
      },
    });
  });

  it('parses — both as a lifecycle block and as part of the whole object', () => {
    expect(LifecycleSchema.safeParse(lifecycle).success).toBe(true);
    const parsed = ObjectSchema.safeParse(SysSession);
    expect(parsed.success).toBe(true);
  });

  it('filters on a field the object actually declares, of a nullable type', () => {
    // A filter naming a column that does not exist would compile to a
    // predicate matching nothing — the sweep would silently stop reaping.
    const field: any = (SysSession.fields as any)[Object.keys(lifecycle.ttl.onlyWhen)[0]];
    expect(field).toBeTruthy();
    expect(field.required).not.toBe(true);
    expect((SysSession.fields as any)[lifecycle.ttl.field]).toBeTruthy();
  });

  it('matches the window of sys_device_code, the only other better-auth transient object', () => {
    expect((SysDeviceCode as any).lifecycle.class).toBe('transient');
    expect((SysDeviceCode as any).lifecycle.ttl.expireAfter).toBe(lifecycle.ttl.expireAfter);
  });

  // ── #10165's two refines: not fired here, and proved to be live ──────────

  it('declares neither conflicting block, so neither #10165 refine fires', () => {
    expect(lifecycle.archive).toBeUndefined();
    expect(lifecycle.storage).toBeUndefined();
  });

  it('COUNTERFACTUAL — adding `archive` to this exact declaration is refused', () => {
    const r = LifecycleSchema.safeParse({ ...lifecycle, archive: { after: '7y', to: 'cold_store' } });
    expect(r.success).toBe(false);
    expect(r.success ? '' : r.error.issues.map((i: any) => i.message).join(' | '))
      .toContain('lifecycle.ttl.onlyWhen cannot be combined with archive');
  });

  it('COUNTERFACTUAL — adding rotation storage to this exact declaration is refused', () => {
    const r = LifecycleSchema.safeParse({
      ...lifecycle,
      storage: { strategy: 'rotation', shards: 7, unit: 'day' },
    });
    expect(r.success).toBe(false);
    expect(r.success ? '' : r.error.issues.map((i: any) => i.message).join(' | '))
      .toContain('lifecycle.ttl.onlyWhen cannot be combined with rotation storage');
  });
});
