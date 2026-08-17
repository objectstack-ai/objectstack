// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8993] Partial masking (`field.maskingRule`) — maintainer ruling 2026-08-16,
// Option A. The scope pins these suites hold:
//
//   1. Single channel: enforcement lives in FieldMasker / the engine read
//      middleware — an API caller and a browser user are masked identically
//      (there is no UI-side path to test because there is no UI-side path).
//   2. Closed presets (`phone`/`id_card`/`bank_account`/`email`/`name`) plus
//      the keepHead/keepTail escape hatch. Deterministic, length-preserving,
//      idempotent output (same input → same masked value — list rendering and
//      grouping stay stable).
//   3. Declare = enforce: the field's `requiredPermissions` is the UNMASK gate
//      (one evaluation, no parallel rule matrix); a rule with no gate masks
//      every non-system caller from the first read.
//   4. No oracle: masked-for-caller fields are non-filterable / non-sortable /
//      non-aggregatable (rejected loudly), and a masked-echo write is refused
//      with 400 VALIDATION_ERROR instead of silently destroying the value.

import { describe, it, expect, vi } from 'vitest';
import { SecurityPlugin } from './security-plugin.js';
import { FieldMasker, maskFieldValue, MASK_CHAR } from './field-masker.js';
import type { PermissionSet } from '@objectstack/spec/security';
import type { FieldMaskingRule } from '@objectstack/spec/data';

// ---------------------------------------------------------------------------
// maskFieldValue — the preset + keepHead/keepTail transforms
// ---------------------------------------------------------------------------
describe('maskFieldValue (#8993 presets)', () => {
  it('phone: keeps first 3 + last 4', () => {
    expect(maskFieldValue('13812345678', 'phone')).toBe('138****5678');
  });

  it('id_card: keeps first 6 + last 4 (middle 8 of an 18-digit id masked)', () => {
    expect(maskFieldValue('110101199001011234', 'id_card')).toBe('110101********1234');
  });

  it('bank_account: keeps last 4 only', () => {
    expect(maskFieldValue('6222021234567891234', 'bank_account')).toBe('***************1234');
  });

  it('email: keeps the local first character + full domain', () => {
    expect(maskFieldValue('john.doe@example.com', 'email')).toBe('j*******@example.com');
  });

  it('email without an @ degrades to keep-first-char', () => {
    expect(maskFieldValue('not-an-email', 'email')).toBe('n***********');
  });

  it('name: keeps the first character (surname), masks the given name', () => {
    expect(maskFieldValue('张伟民', 'name')).toBe('张**');
  });

  it('keepHead/keepTail escape hatch masks the middle span', () => {
    expect(maskFieldValue('AB1234567CD', { keepHead: 2, keepTail: 2 })).toBe('AB*******CD');
  });

  it('keepHead 0 / keepTail 0 masks the whole value', () => {
    expect(maskFieldValue('secret', { keepHead: 0, keepTail: 0 })).toBe('******');
  });

  it('a value too short to keep both ends is masked ENTIRELY (degrade toward more masking)', () => {
    // 7 chars <= keepHead 3 + keepTail 4 → full mask, never a full reveal.
    expect(maskFieldValue('1234567', 'phone')).toBe('*******');
  });

  it('is deterministic AND idempotent (stable output — the scope pin; masking a masked value is a fixed point)', () => {
    const once = maskFieldValue('13812345678', 'phone');
    expect(maskFieldValue('13812345678', 'phone')).toBe(once);
    expect(maskFieldValue(once, 'phone')).toBe(once);
    const email = maskFieldValue('john.doe@example.com', 'email');
    expect(maskFieldValue(email, 'email')).toBe(email);
  });

  it('null/undefined pass through; numbers mask their decimal rendering; arrays mask element-wise', () => {
    expect(maskFieldValue(null, 'phone')).toBeNull();
    expect(maskFieldValue(undefined, 'phone')).toBeUndefined();
    expect(maskFieldValue(13812345678, 'phone')).toBe('138****5678');
    expect(maskFieldValue(['13812345678', '13987654321'], 'phone')).toEqual(['138****5678', '139****4321']);
  });

  it('a shape the rule was never written for collapses to a fixed opaque mask (no length/truthiness leak)', () => {
    expect(maskFieldValue(true, 'phone')).toBe(MASK_CHAR.repeat(3));
    expect(maskFieldValue({ nested: 'x' }, 'phone')).toBe(MASK_CHAR.repeat(3));
  });
});

// ---------------------------------------------------------------------------
// FieldMasker.maskResults with partial rules
// ---------------------------------------------------------------------------
describe('FieldMasker.maskResults — partial rules (#8993)', () => {
  it('REPLACES a partial-rule field and still DELETES plain hidden fields', () => {
    const masker = new FieldMasker();
    const rows = [{ id: 'r1', phone: '13812345678', ssn: 'hide-me', name: 'A' }];
    const perms = {
      // the requiredPermissions fold marks a gated rule field non-readable —
      // the rule converts that deletion into a replacement
      phone: { readable: false, editable: false },
      ssn: { readable: false, editable: false },
    };
    const out = masker.maskResults(rows, perms, 'contact', { phone: 'phone' }) as any[];
    expect(out[0].phone).toBe('138****5678');
    expect(out[0].ssn).toBeUndefined();
    expect(out[0].name).toBe('A');
  });

  it('masks a rule field even with NO permission entries (rule without gate)', () => {
    const masker = new FieldMasker();
    const rows = [{ id: 'r1', phone: '13812345678' }];
    const out = masker.maskResults(rows, {}, 'contact', { phone: 'phone' }) as any[];
    expect(out[0].phone).toBe('138****5678');
  });

  it('leaves rows without the field untouched (no key materializes)', () => {
    const masker = new FieldMasker();
    const out = masker.maskResults([{ id: 'r1' }], {}, 'contact', { phone: 'phone' }) as any[];
    expect('phone' in out[0]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectMaskedEchoWrites — the fixed-point echo test
// ---------------------------------------------------------------------------
describe('FieldMasker.detectMaskedEchoWrites (#8993)', () => {
  const masker = new FieldMasker();
  const rules: Record<string, FieldMaskingRule> = { phone: 'phone', code: { keepHead: 2, keepTail: 2 } };

  it('flags the exact placeholder a masked read served', () => {
    expect(masker.detectMaskedEchoWrites({ phone: '138****5678' }, rules)).toEqual(['phone']);
  });

  it('passes a real value — and a short value that is its own mask image but carries no mask char', () => {
    expect(masker.detectMaskedEchoWrites({ phone: '13812345678' }, rules)).toEqual([]);
    // 7 chars: maskSpan would full-mask it, but the VALUE has no '*' → legit.
    expect(masker.detectMaskedEchoWrites({ phone: '1234567' }, rules)).toEqual([]);
  });

  it('a value containing * that is NOT a fixed point of the rule passes (not an echo)', () => {
    // '*' inside the kept tail span — masking this value would move the stars.
    expect(masker.detectMaskedEchoWrites({ code: 'AB12*' }, rules)).toEqual([]);
  });

  it('unions across bulk rows and sorts the offender list', () => {
    expect(
      masker.detectMaskedEchoWrites(
        [{ phone: '138****5678' }, { code: 'AB*****CD' }],
        rules,
      ),
    ).toEqual(['code', 'phone']);
  });

  it('flags an echoed element inside a multi-value array', () => {
    expect(masker.detectMaskedEchoWrites({ phone: ['138****5678'] }, rules)).toEqual(['phone']);
  });
});

// ---------------------------------------------------------------------------
// Middleware integration — the single enforcement channel
// ---------------------------------------------------------------------------
describe('SecurityPlugin — maskingRule middleware enforcement (#8993)', () => {
  const fieldsSchema = {
    fields: {
      id: { name: 'id' },
      name: { name: 'name' },
      // rule + unmask gate: requiredPermissions is the unmask evaluation
      phone: { name: 'phone', maskingRule: 'phone', requiredPermissions: ['view_full_pii'] },
      // rule with NO gate: masked for every non-system caller
      bank: { name: 'bank', maskingRule: 'bank_account' },
    },
  };
  const setNoCap: PermissionSet = {
    name: 'msk_member',
    objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  } as any;
  const setWithCap: PermissionSet = {
    name: 'msk_pii',
    objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    systemPermissions: ['view_full_pii'],
  } as any;
  const setFieldDeny: PermissionSet = {
    name: 'msk_deny',
    objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
    fields: { 'contact.phone': { readable: false, editable: false } },
  } as any;

  const harnessFor = (sets: PermissionSet[], fallback: string) => {
    let middleware: any;
    const schema = { name: 'contact', ...fieldsSchema };
    const ql: any = {
      registerMiddleware: (mw: any) => { if (!middleware) middleware = mw; },
      getSchema: () => schema,
      findOne: async () => null,
      find: async () => [],
    };
    const metadata = { get: async () => schema, list: async () => sets };
    const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
    const ctx: any = {
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerService: vi.fn(),
      getService: (n: string) => { if (!(n in services)) throw new Error(`service not registered: ${n}`); return services[n]; },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: fallback });
    return { plugin, ctx, run: async (opCtx: any) => { await middleware(opCtx, async () => {}); return opCtx; } };
  };

  const row = { id: 'r1', name: 'A', phone: '13812345678', bank: '6222021234567891234' };

  it('serves the PARTIAL mask (not deletion) to a caller lacking the unmask capability, and masks the gate-less rule field too', async () => {
    const h = harnessFor([setNoCap], 'msk_member');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'contact', operation: 'find', ast: { where: undefined }, result: [{ ...row }], context: { userId: 'u1', positions: [], permissions: [] } };
    await h.run(opCtx);
    expect(opCtx.result[0].phone).toBe('138****5678');
    expect(opCtx.result[0].bank).toBe('***************1234');
    expect(opCtx.result[0].name).toBe('A');
  });

  it('serves the FULL value to a caller holding the field requiredPermissions (the unmask gate)', async () => {
    const h = harnessFor([setWithCap], 'msk_pii');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'contact', operation: 'find', ast: { where: undefined }, result: [{ ...row }], context: { userId: 'u1', positions: [], permissions: ['msk_pii'] } };
    await h.run(opCtx);
    expect(opCtx.result[0].phone).toBe('13812345678');
    // bank declares no unmask gate — masked even for this caller
    expect(opCtx.result[0].bank).toBe('***************1234');
  });

  it('an explicit permission-set field DENY still deletes the key (a rule never widens an explicit deny)', async () => {
    const h = harnessFor([setFieldDeny], 'msk_deny');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'contact', operation: 'find', ast: { where: undefined }, result: [{ ...row }], context: { userId: 'u1', positions: [], permissions: [] } };
    await h.run(opCtx);
    expect('phone' in opCtx.result[0]).toBe(false);
  });

  it('masks the record echoed back by a WRITE (update response image rides the same channel)', async () => {
    const h = harnessFor([setNoCap], 'msk_member');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'contact', operation: 'update', data: { name: 'B' }, result: { ...row }, context: { userId: 'u1', positions: [], permissions: [] } };
    await h.run(opCtx);
    expect(opCtx.result.phone).toBe('138****5678');
  });

  it('refuses a FILTER on a masked-for-caller field (the equality-probe oracle), envelope code + status asserted', async () => {
    const h = harnessFor([setNoCap], 'msk_member');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'contact', operation: 'find', ast: { where: { bank: '6222021234567891234' } }, context: { userId: 'u1', positions: [], permissions: [] } };
    await expect(h.run(opCtx)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
  });

  it('refuses a SORT on a masked-for-caller field', async () => {
    const h = harnessFor([setNoCap], 'msk_member');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'contact', operation: 'find', ast: { orderBy: [{ field: 'phone', direction: 'asc' }] }, context: { userId: 'u1', positions: [], permissions: [] } };
    await expect(h.run(opCtx)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
  });

  it('allows the same filter for a caller holding the unmask capability', async () => {
    const h = harnessFor([setWithCap], 'msk_pii');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'contact', operation: 'find', ast: { where: { phone: '13812345678' } }, context: { userId: 'u1', positions: [], permissions: ['msk_pii'] } };
    await expect(h.run(opCtx)).resolves.toBeDefined();
  });

  it('refuses an AGGREGATE over a masked-for-caller field (min/max reveal the hidden span)', async () => {
    const h = harnessFor([setNoCap], 'msk_member');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'contact', operation: 'aggregate', ast: { aggregations: [{ fn: 'max', field: 'bank', alias: 'm' }] }, context: { userId: 'u1', positions: [], permissions: [] } };
    await expect(h.run(opCtx)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', statusCode: 403 });
  });

  it('refuses a masked-echo WRITE with 400 VALIDATION_ERROR (code AND status — the ADR-0112 envelope)', async () => {
    // `bank` (no unmask gate) — a caller may EDIT it while reading it masked,
    // which is exactly the round-trip the guard exists for. (`phone` never
    // reaches the echo guard for this caller: its requiredPermissions fold
    // already denies the write at step 2.5 with 403, tested above.)
    const h = harnessFor([setNoCap], 'msk_member');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'contact', operation: 'update', data: { bank: '***************1234' }, context: { userId: 'u1', positions: [], permissions: [] } };
    await expect(h.run(opCtx)).rejects.toMatchObject({
      name: 'MaskedValueWriteError',
      code: 'VALIDATION_ERROR',
      status: 400,
      statusCode: 400,
    });
  });

  it('accepts a REAL new value written by a masked caller (masked read does not imply denied write)', async () => {
    const h = harnessFor([setNoCap], 'msk_member');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const opCtx: any = { object: 'contact', operation: 'update', data: { bank: '6222020000000000000' }, context: { userId: 'u1', positions: [], permissions: [] } };
    await expect(h.run(opCtx)).resolves.toBeDefined();
  });

  it('an invalid declared rule fails CLOSED to a full mask (never the unmasked value), with a warning', async () => {
    const badSchema = {
      name: 'contact',
      fields: {
        id: { name: 'id' },
        phone: { name: 'phone', maskingRule: 'not-a-preset' },
      },
    };
    let middleware: any;
    const ql: any = {
      registerMiddleware: (mw: any) => { if (!middleware) middleware = mw; },
      getSchema: () => badSchema,
      findOne: async () => null,
      find: async () => [],
    };
    const metadata = { get: async () => badSchema, list: async () => [setNoCap] };
    const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
    const warn = vi.fn();
    const ctx: any = {
      logger: { info: vi.fn(), warn, error: vi.fn() },
      registerService: vi.fn(),
      getService: (n: string) => { if (!(n in services)) throw new Error(`service not registered: ${n}`); return services[n]; },
    };
    const plugin = new SecurityPlugin({ fallbackPermissionSet: 'msk_member' });
    await plugin.init(ctx); await plugin.start(ctx);
    const opCtx: any = { object: 'contact', operation: 'find', ast: { where: undefined }, result: [{ id: 'r1', phone: '13812345678' }], context: { userId: 'u1', positions: [], permissions: [] } };
    await middleware(opCtx, async () => {});
    expect(opCtx.result[0].phone).toBe('***********');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid maskingRule'), expect.anything());
  });

  it('getReadableFields KEEPS a partial-masked column (the export header matches the masked values the rows carry)', async () => {
    const h = harnessFor([setNoCap], 'msk_member');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const svc: any = h.ctx.registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1];
    expect(svc).toBeDefined();
    const readable = await svc.getReadableFields('contact', { userId: 'u1', positions: [], permissions: [] });
    expect(readable).toContain('phone');
    expect(readable).toContain('bank');
    expect(readable).toContain('name');
  });

  it('getReadableFields still EXCLUDES a column a permission set explicitly denies', async () => {
    const h = harnessFor([setFieldDeny], 'msk_deny');
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const svc: any = h.ctx.registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1];
    const readable = await svc.getReadableFields('contact', { userId: 'u1', positions: [], permissions: [] });
    expect(readable).not.toContain('phone');
  });

  // -------------------------------------------------------------------------
  // [#9127] explain ↔ enforcement, on THIS fixture. The suites above pin what
  // the caller actually receives; these pin that `explain` says the same thing
  // about the same (caller, object) pair. Same harness, same permission sets,
  // same schema — so a future change that moves one channel without the other
  // fails here rather than shipping an access report that contradicts the
  // access. That is the module contract's own claim: explain "matches
  // enforcement by construction".
  // -------------------------------------------------------------------------
  const explainFlsFor = async (sets: PermissionSet[], fallback: string, permissions: string[] = []) => {
    const h = harnessFor(sets, fallback);
    await h.plugin.init(h.ctx); await h.plugin.start(h.ctx);
    const svc: any = h.ctx.registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1];
    const decision = await svc.explain(
      { object: 'contact', operation: 'read' },
      { userId: 'u1', positions: [], permissions },
    );
    return decision.layers.find((l: any) => l.layer === 'fls');
  };

  it('explain reports the partially masked fields the read path actually serves masked', async () => {
    const fls = await explainFlsFor([setNoCap], 'msk_member');
    // The enforcement test above serves this caller `138****5678` / `***…1234`
    // — the keys ARE present, so neither may be reported deleted.
    expect(fls.verdict).toBe('narrows');
    expect(fls.detail).not.toContain('masked from responses');
    expect(fls.detail).toContain('PARTIALLY masked');
    expect(fls.detail).toContain('phone (phone)');
    expect(fls.detail).toContain('bank (bank_account)');
  });

  it('explain drops the gated field from the masked set once the caller holds the unmask capability', async () => {
    const fls = await explainFlsFor([setWithCap], 'msk_pii', ['msk_pii']);
    // Enforcement serves `phone` whole and `bank` masked for this caller.
    expect(fls.detail).not.toContain('phone');
    expect(fls.detail).toContain('bank (bank_account)');
  });

  it('explain reports an explicit permission-set DENY as HIDDEN, not partially masked', async () => {
    const fls = await explainFlsFor([setFieldDeny], 'msk_deny');
    // Enforcement DELETES the key for this caller (a rule never widens an
    // explicit deny), so the report must say deleted — not "value replaced".
    expect(fls.detail).toContain('masked from responses');
    expect(fls.detail).toContain('phone');
    expect(fls.detail).not.toContain('phone (phone)');
  });
});
