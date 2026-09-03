// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── The explicit per-write "legitimately org-less" declaration (#13636) ──────
//
// Maintainer ruling, 2026-08-31 (总监席第 7 场决裁批 #17, verbatim 「同意」),
// direction B:
//
//   1. 「平台获得一个显式的每写入「合法 org-less」申报通道,
//      `resolveSystemInsertOrganization` 据此区分「有意的环境级/无租户行」与
//      「漏 stamp 的 bug」。同一个 NULL 不再身兼两义。」
//   2. 「申报必须 loud, checkable, countable ... 静默可选标记不合格 —— 那只是给
//      旁路换名。」
//
// ## What each half of this file discriminates
//
// The two halves fail differently and both are pinned, because a file that
// pinned only one of them would stay green through the failure that matters:
//
//   1. **The discrimination.** A declared org-less write is accepted and a
//      "same write, no declaration" CONTROL is refused, run through the same
//      engine on the same posture. Pinning only the acceptance would stay green
//      if admission had quietly stopped happening — the object would sail
//      through as `unclassified` and the control would still "pass"; pinning
//      only the refusal would stay green if the declaration did nothing at all.
//   2. **The anti-silent-marker property.** Every unadmitted spelling THROWS,
//      including on objects whose writes this resolver never judges. That is
//      what makes the option a declaration rather than a renamed bypass, and it
//      is a property of WHERE the check sits — ahead of every early return — so
//      it is pinned on the early-return objects specifically, where a check
//      placed one line lower would silently ignore it.
//
// Refusals are asserted on `code` + `status` (ADR-0112), never on a bare
// `toThrow()`: a plain `Error` from anywhere in the pipeline satisfies that and
// would leave both directions of this file green while the control was dead.

import { describe, it, expect } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';
import {
  PLATFORM_OBJECT_TENANCY,
  admittedOrgLessReasons,
  classifyPlatformObjectTenancy,
  conditionalPlatformObjects,
  isPlatformObjectOutOfTenantAuditScope,
} from './tenancy/platform-object-tenancy.js';

const ORG_ID = 'org_msokm9oaz0cal87q';
const SYSTEM_CTX: ExecutionContext = { isSystem: true } as ExecutionContext;
const PACKAGE_ID = '#13636';

const ENV_METADATA = { orgLessWrite: { object: 'sys_metadata', reason: 'env-level-metadata' } } as any;

interface ObservedCall {
  object: string;
  method: string;
  options: Record<string, unknown> | undefined;
}

function makeDriver(observed: ObservedCall[], organizations: string[]) {
  const record = (object: string, method: string, options: any) =>
    observed.push({ object, method, options });
  return {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, _ast: any, options: any) {
      record(object, 'find', options);
      return object === 'sys_organization' ? organizations.map((id) => ({ id })) : [];
    },
    async findOne() { return null; },
    async count() { return 0; },
    async create(object: string, data: any, options: any) {
      record(object, 'create', options);
      return { id: 'r_1', ...data };
    },
    async update(object: string, id: string, data: any, options: any) {
      record(object, 'update', options); return { id, ...data };
    },
    async delete() { return true; },
    async bulkCreate(object: string, rows: any[], options: any) {
      record(object, 'bulkCreate', options);
      return rows.map((r, i) => ({ id: `r_${i + 1}`, ...r }));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async syncSchema() {},
  } as any;
}

/** CONDITIONAL — #6190 option A's env-wide write is its adjudicated org-less half. */
const SYS_METADATA = { name: 'sys_metadata', fields: { type: { type: 'text' } } } as any;
/** CONDITIONAL — its writers' enumerated untenanted-subject rows. */
const SYS_AUDIT_LOG = { name: 'sys_audit_log', fields: { action: { type: 'text' } } } as any;
/** TENANT-SCOPED — in the machinery, but with NO org-less population to declare. */
const SYS_FILE = { name: 'sys_file', fields: { key: { type: 'text' } } } as any;
/** UNCLASSIFIED — the resolver returns early for it, which is the point. */
const SYS_UNADJUDICATED = { name: 'sys_audit_entry', fields: { subject: { type: 'text' } } } as any;
/** An application object: never in the platform exemption at all. */
const DISPATCH_ORDER = { name: 'dispatch_order', fields: { subject: { type: 'text' } } } as any;
const ORG_OBJECT = { name: 'sys_organization', fields: { name: { type: 'text' } } } as any;

async function makeEngine(opts: { posture?: string; organizations?: string[] } = {}) {
  const observed: ObservedCall[] = [];
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(observed, opts.organizations ?? [ORG_ID]), true);
  await engine.init();
  for (const o of [SYS_METADATA, SYS_AUDIT_LOG, SYS_FILE, SYS_UNADJUDICATED, DISPATCH_ORDER, ORG_OBJECT]) {
    engine.registry.registerObject(o, PACKAGE_ID);
  }
  if (opts.posture) engine.setTenancyPostureProvider(() => opts.posture as any);
  return { engine, observed };
}

const lastWrite = (observed: ObservedCall[], object: string) =>
  [...observed].reverse().find((c) => c.object === object && c.method !== 'find');

/** The ADR-0112 envelope both refusals in this area carry. */
async function expectRefusal(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toMatchObject({ code, status: 500 });
}

describe('#13636 the ledger — `conditional` is the fourth verdict', () => {
  it('admits exactly the two specimens the ruling named, as a LIST', () => {
    // Pinned as a list rather than a count: constraint 3 fixes the FIRST BATCH
    // at these two and requires every later member to arrive with its own
    // writer evidence — 「⛔ 不从 #13491 的 51 只 cannot-determine 里凭猜挑成员」.
    // A silent arrival here is a member picked by guess.
    expect(conditionalPlatformObjects()).toEqual(['sys_audit_log', 'sys_metadata']);
    expect(classifyPlatformObjectTenancy('sys_metadata')).toBe('conditional');
    expect(classifyPlatformObjectTenancy('sys_audit_log')).toBe('conditional');
  });

  it('a conditional object is ADMITTED into the machinery, not exempted from it', () => {
    // The direction that matters: `conditional` is the strictest verdict in the
    // ledger, so it answers the same as `tenant-scoped` here. An implementation
    // that read it as a softer `global` would answer `true` and quietly restore
    // the blindness this card exists to remove.
    expect(isPlatformObjectOutOfTenantAuditScope('sys_metadata')).toBe(false);
    expect(isPlatformObjectOutOfTenantAuditScope('sys_audit_log')).toBe(false);
    // Controls on both sides of it.
    expect(isPlatformObjectOutOfTenantAuditScope('sys_file')).toBe(false);
    expect(isPlatformObjectOutOfTenantAuditScope('sys_permission_set')).toBe(true);
    expect(isPlatformObjectOutOfTenantAuditScope('sys_audit_entry')).toBe(true);
  });

  it('every conditional entry admits at least one reason, and no other verdict admits any', () => {
    for (const [name, entry] of Object.entries(PLATFORM_OBJECT_TENANCY)) {
      if (entry.tenancy === 'conditional') {
        expect(entry.orgLessReasons?.length, name).toBeGreaterThan(0);
      } else {
        // A reason is never admissible everywhere: the channel checks the PAIR.
        expect(admittedOrgLessReasons(name), name).toEqual([]);
      }
    }
    expect(admittedOrgLessReasons('sys_metadata')).toEqual(['env-level-metadata']);
    expect(admittedOrgLessReasons('sys_audit_log')).toEqual(['audit-of-untenanted-record']);
  });
});

describe('#13636 the discrimination — one NULL stops meaning two things', () => {
  it.each(['isolated', 'group'] as const)(
    '%s posture: the DECLARED env-level write lands org-less',
    async (posture) => {
      const { engine, observed } = await makeEngine({ posture });
      await engine.insert('sys_metadata', { type: 'datasource' }, {
        context: SYSTEM_CTX,
        ...ENV_METADATA,
      } as any);
      // Nothing was derived and nothing was stamped: this is the #6190 option A
      // row, which belongs to the installation.
      expect(lastWrite(observed, 'sys_metadata')?.options?.tenantId).toBeUndefined();
    },
  );

  it.each(['isolated', 'group'] as const)(
    '%s posture: the SAME write UNDECLARED is refused — the control',
    async (posture) => {
      const { engine } = await makeEngine({ posture });
      await expectRefusal(
        engine.insert('sys_metadata', { type: 'datasource' }, { context: SYSTEM_CTX } as any),
        'ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED',
      );
    },
  );

  it('single posture: an UNDECLARED org-less write derives the organization', async () => {
    // The other half of admission. Without this the acceptance test above would
    // stay green even if `conditional` had silently become an exemption.
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('sys_audit_log', { action: 'create' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'sys_audit_log')?.options?.tenantId).toBe(ORG_ID);
  });

  it('single posture: a DECLARED write is NOT given the derived organization', async () => {
    const { engine, observed } = await makeEngine({ posture: 'single' });
    await engine.insert('sys_audit_log', { action: 'create' }, {
      context: SYSTEM_CTX,
      orgLessWrite: { object: 'sys_audit_log', reason: 'audit-of-untenanted-record' },
    } as any);
    expect(lastWrite(observed, 'sys_audit_log')?.options?.tenantId).toBeUndefined();
  });

  it('a row that names its own organization is untouched by the declaration', async () => {
    // The declaration describes the rows a write MAY land org-less; a write that
    // carries an organization simply never lands one. Keeping the two
    // independent is what lets a writer state the claim once at the call site.
    const { engine, observed } = await makeEngine({ posture: 'isolated' });
    await engine.insert('sys_metadata', { type: 'datasource', organization_id: ORG_ID }, {
      context: SYSTEM_CTX,
      ...ENV_METADATA,
    } as any);
    expect(lastWrite(observed, 'sys_metadata')?.options?.tenantId).toBeUndefined();
  });
});

describe('#13636 the declaration is not a bypass — every unadmitted spelling THROWS', () => {
  it('refuses a declaration on a TENANT-SCOPED object, which has no org-less population', async () => {
    const { engine } = await makeEngine({ posture: 'single' });
    await expectRefusal(
      engine.insert('sys_file', { key: 'k1' }, {
        context: SYSTEM_CTX,
        orgLessWrite: { object: 'sys_file', reason: 'env-level-metadata' },
      } as any),
      'ERR_ORGLESS_WRITE_DECLARATION_REFUSED',
    );
  });

  it('refuses a reason the object does not admit, even though another object does', async () => {
    const { engine } = await makeEngine({ posture: 'isolated' });
    await expectRefusal(
      engine.insert('sys_metadata', { type: 'datasource' }, {
        context: SYSTEM_CTX,
        orgLessWrite: { object: 'sys_metadata', reason: 'audit-of-untenanted-record' },
      } as any),
      'ERR_ORGLESS_WRITE_DECLARATION_REFUSED',
    );
  });

  it('refuses a declaration that names an object OTHER than the one being written', async () => {
    // What stops a declaration riding a shared sudo context or a spread options
    // bag onto a different object's row.
    const { engine } = await makeEngine({ posture: 'isolated' });
    await expectRefusal(
      engine.insert('sys_audit_log', { action: 'create' }, {
        context: SYSTEM_CTX,
        ...ENV_METADATA,
      } as any),
      'ERR_ORGLESS_WRITE_DECLARATION_REFUSED',
    );
  });

  it.each([
    ['an unclassified platform object', 'sys_audit_entry', { subject: 'e1' }],
    ['an application object', 'dispatch_order', { subject: 'o1' }],
  ])(
    'refuses a declaration on %s — the object the resolver returns EARLY for',
    async (_label, object, row) => {
      // ⭐ The placement pin. Each of these exits the resolver before the
      // posture is ever read, so a check written one line lower would IGNORE the
      // declaration here — and an option with a silently-ignored spelling is the
      // 「静默可选标记」 the ruling disqualified by name.
      const { engine } = await makeEngine({ posture: 'single' });
      await expectRefusal(
        engine.insert(object, row, {
          context: SYSTEM_CTX,
          orgLessWrite: { object, reason: 'env-level-metadata' },
        } as any),
        'ERR_ORGLESS_WRITE_DECLARATION_REFUSED',
      );
    },
  );

  it('refuses an unadmitted declaration even when the context CARRIES an organization', async () => {
    // The very first early return in the resolver. A write carrying an
    // organization resolves nothing — but a bogus claim on it is still a claim,
    // and this is the branch a check placed after the early returns would miss
    // on every ordinary session write in the platform.
    const { engine } = await makeEngine({ posture: 'isolated' });
    await expectRefusal(
      engine.insert('sys_file', { key: 'k1' }, {
        context: { isSystem: true, tenantId: ORG_ID } as ExecutionContext,
        orgLessWrite: { object: 'sys_file', reason: 'env-level-metadata' },
      } as any),
      'ERR_ORGLESS_WRITE_DECLARATION_REFUSED',
    );
  });

  it.each([
    ['a bare boolean', true],
    ['a string', 'env-level-metadata'],
    ['an array', [{ object: 'sys_metadata', reason: 'env-level-metadata' }]],
    ['an object naming no `object`', { reason: 'env-level-metadata' }],
  ])('refuses %s in the declaration slot', async (_label, declared) => {
    const { engine } = await makeEngine({ posture: 'isolated' });
    await expectRefusal(
      engine.insert('sys_metadata', { type: 'datasource' }, {
        context: SYSTEM_CTX,
        orgLessWrite: declared,
      } as any),
      'ERR_ORGLESS_WRITE_DECLARATION_REFUSED',
    );
  });
});
