// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18153] The record lock's per-row refusal is END-USER copy — pinned as such,
 * and pinned APART from the three operator-facing refusals beside it.
 *
 * ## What the card was
 *
 * A record held by a live approval refused the write with
 * `record '<id>' of '<apiName>' is locked while an approval is in progress`.
 * The console toast copies that sentence verbatim, so an end user read an
 * opaque primary key and a machine identifier, and a deny-path toast is exactly
 * the string that reaches screenshots, screen recordings and support tickets.
 *
 * ## The three pins, and why each is here
 *
 * 1. **The user-facing half.** Driven end to end — real {@link ObjectQL}, real
 *    sqlite driver, the real `beforeUpdate` hook — because the defect was about
 *    the string a real refusal produces, not about a helper in isolation. The
 *    assertion is stated as an ABSENCE (no record id, no object API name in the
 *    body) as well as a presence, because the presence alone would stay green
 *    on a sentence that named the record correctly and then appended the id.
 *
 * 2. **The three operator refusals, unchanged.** The cap refusals and the
 *    unanswerable-intersection refusal are raised about a WRITE SHAPE, and
 *    naming the object's API name there is the useful thing to say. The card
 *    ruled them out of scope; this pins that, so a later "harmonise the lock's
 *    messages" sweep goes red instead of quietly sweeping them into the
 *    end-user shape. They are driven through a FAKE engine rather than the real
 *    rig on purpose: two of the three need more than {@link PENDING_LOCK_LIMIT}
 *    locked rows and the third needs the engine's own read to fail, and neither
 *    is a state a sqlite fixture should be bent into to assert a string.
 *
 * 3. **`RECORD_LOCKED` / 409, both directions.** The card moved the human
 *    sentence only; the wire vocabulary is contract (ADR-0112) and the 409 is
 *    pinned across the batch-row protocol surfaces. Both directions means: the
 *    code and status are asserted to BE those values, and the `CODE: message`
 *    envelope is asserted to still be the envelope — a rewording that reached
 *    either would be a widening, not a copy fix.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { bindApprovalLockHook, APPROVALS_HOOK_PACKAGE } from './lifecycle-hooks.js';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { installDefaultOrganization } from './default-organization.testkit.js';

/**
 * [#35384] A flat `a.b.c` pack as the nested data `II18nService.getTranslations()`
 * hands over: the object label is read off it by `translateObject`, as `/meta`
 * reads it, never through `t()`.
 */
function nestedPack(flat: Record<string, string> = {}): Record<string, unknown> {
  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let cur = out;
    for (const part of parts.slice(0, -1)) cur = cur[part] ??= {};
    cur[parts[parts.length - 1]] = value;
  }
  return out;
}

const OPPORTUNITY = {
  name: 'opportunity',
  label: 'Opportunity',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    approval_status: { name: 'approval_status', type: 'text' as const },
  },
};

/** Same shape, no title-eligible field at all — the degradation leg. */
const LEDGER_ENTRY = {
  name: 'ledger_entry',
  label: 'Ledger Entry',
  nameField: 'id',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    amount: { name: 'amount', type: 'number' as const },
    approval_status: { name: 'approval_status', type: 'text' as const },
  },
};

const APPROVAL_REQUEST = {
  name: 'sys_approval_request',
  label: 'Approval Request',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    object_name: { name: 'object_name', type: 'text' as const },
    record_id: { name: 'record_id', type: 'text' as const },
    status: { name: 'status', type: 'text' as const },
    flow_run_id: { name: 'flow_run_id', type: 'text' as const },
    node_config_json: { name: 'node_config_json', type: 'text' as const },
  },
};

const NODE_CONFIG = JSON.stringify({ lockRecord: true, approvalStatusField: 'approval_status' });

describe('[#18153] the per-row refusal is user-facing copy', () => {
  let engine: ObjectQL;
  let opportunityId: string;
  let ledgerId: string;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  beforeEach(async () => {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }), true);
    await engine.init();
    // `packageId` is REQUIRED by `registerObject` — passed rather than elided so
    // this file adds no raw `tsc` error to the package's TEST_DEBT ledger.
    for (const o of [OPPORTUNITY, LEDGER_ENTRY, APPROVAL_REQUEST]) {
      engine.registry.registerObject(o as any, 'com.objectstack.test.18153');
    }
    await engine.syncSchemas();
    // A real `single` install's Default Organization: the system writes below
    // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
    await installDefaultOrganization(engine);

    opportunityId = String((await engine.insert('opportunity', { name: 'Acme renewal', amount: 100 })).id);
    ledgerId = String((await engine.insert('ledger_entry', { amount: 100 })).id);
    for (const [object, recordId] of [['opportunity', opportunityId], ['ledger_entry', ledgerId]] as const) {
      await engine.insert('sys_approval_request', {
        object_name: object, record_id: recordId, status: 'pending',
        flow_run_id: 'run_1', node_config_json: NODE_CONFIG,
      }, { context: { isSystem: true } } as any);
    }

    bindApprovalLockHook(engine as any);
  });

  async function refusal(object: string, id: string): Promise<any> {
    let thrown: any = null;
    try {
      await engine.update(object, { amount: 999 }, { where: { id } } as any);
    } catch (e) { thrown = e; }
    expect(thrown).not.toBeNull();
    return thrown;
  }

  it('names the record by its label and leaks neither the id nor the API name', async () => {
    const thrown = await refusal('opportunity', opportunityId);

    expect(thrown.message).toBe(
      "RECORD_LOCKED: Opportunity 'Acme renewal' is locked while an approval is in progress, " +
      'and cannot be edited until that approval is complete',
    );
    // Stated as an absence too: a sentence that named the record correctly and
    // then appended the id would satisfy the equality above only by accident,
    // and these two are what the card actually asked for.
    expect(thrown.message).not.toContain(opportunityId);
    expect(thrown.message).not.toContain(OPPORTUNITY.name);
  });

  it('degrades to the object label — ⛔ never back to the id — when no title resolves', async () => {
    // `nameField: 'id'` is the pointer a title-less object ends up with, and it
    // is exactly the shape that would re-introduce the defect if the resolver
    // trusted the pointer.
    const thrown = await refusal('ledger_entry', ledgerId);

    expect(thrown.message).toBe(
      'RECORD_LOCKED: This Ledger Entry is locked while an approval is in progress, ' +
      'and cannot be edited until that approval is complete',
    );
    expect(thrown.message).not.toContain(ledgerId);
    expect(thrown.message).not.toContain(LEDGER_ENTRY.name);
  });

  it('keeps the id and the API name reachable on the CONSOLE for support', async () => {
    engine.unregisterHooksByPackage(APPROVALS_HOOK_PACKAGE);
    const info: string[] = [];
    bindApprovalLockHook(engine as any, { warn: () => {}, info: (m: any) => info.push(String(m)) });

    await refusal('opportunity', opportunityId);

    // The card's own remedy: "moved to the console … not simply deleted if a
    // support path still needs them".
    expect(info.some((line) => line.includes(opportunityId) && line.includes('opportunity'))).toBe(true);
  });

  it('pins `RECORD_LOCKED` and 409 in both directions', async () => {
    const thrown = await refusal('opportunity', opportunityId);

    expect(thrown.code).toBe('RECORD_LOCKED');
    expect(thrown.statusCode).toBe(409);
    // The other direction: the wire vocabulary did not acquire a second
    // spelling, and the `CODE: message` envelope is still the envelope.
    expect(thrown.status).toBeUndefined();
    expect(String(thrown.message).startsWith('RECORD_LOCKED: ')).toBe(true);
  });
});

/**
 * CONTROL — the three operator-facing refusals, byte for byte.
 *
 * A fake engine, because these three are reached by write SHAPES, not by record
 * states: two need more locked rows than {@link PENDING_LOCK_LIMIT} and the
 * third needs the intersection read to throw. Each refusal is driven through
 * the REAL handler `bindApprovalLockHook` registers.
 */
describe('[#18153] CONTROL — the operator-facing refusals are untouched', () => {
  const LIMIT = 1_000;

  /** Captures the handler the real binder registers, then drives it directly. */
  function bindAgainst(find: (object: string, args: any) => Promise<any[]>) {
    let handler!: (ctx: any) => Promise<void>;
    bindApprovalLockHook({
      registerHook: (_event: string, h: any) => { handler = h; },
      unregisterHooksByPackage: () => 0,
      find: find as any,
    } as any);
    return handler;
  }

  async function refusalFrom(handler: (ctx: any) => Promise<void>, ctx: any): Promise<any> {
    let thrown: any = null;
    try { await handler(ctx); } catch (e) { thrown = e; }
    expect(thrown).not.toBeNull();
    return thrown;
  }

  it('the named-id cap refusal still names the object', async () => {
    const handler = bindAgainst(async () => []);
    const ids = Array.from({ length: LIMIT + 1 }, (_v, i) => `r${i}`);

    const thrown = await refusalFrom(handler, {
      object: 'leave_request',
      input: { id: { $in: ids }, data: { amount: 1 } },
    });

    expect(thrown.message).toBe(
      `RECORD_LOCKED: refusing to authorize an update naming more than ${LIMIT} records of 'leave_request' — ` +
      'the approval lock cannot check them row by row; scope the write',
    );
    expect(thrown.code).toBe('RECORD_LOCKED');
    expect(thrown.statusCode).toBe(409);
    // [#34699] An operator-facing sentence (it names the API name) is not marked for the end user.
    expect(thrown.userMessage).toBeUndefined();
  });

  it('the predicate cap refusal still names the object', async () => {
    const pending = Array.from({ length: LIMIT + 1 }, (_v, i) => ({ record_id: `r${i}`, status: 'pending' }));
    const handler = bindAgainst(async () => pending);

    const thrown = await refusalFrom(handler, {
      object: 'leave_request',
      input: { data: { amount: 1 }, options: { where: { status: 'draft' } } },
    });

    expect(thrown.message).toBe(
      `RECORD_LOCKED: refusing a predicate update on 'leave_request': more than ${LIMIT} of its records carry a ` +
      'pending approval, so the lock cannot decide row by row; scope the write to the rows you mean',
    );
    expect(thrown.code).toBe('RECORD_LOCKED');
    expect(thrown.statusCode).toBe(409);
  });

  it('the unanswerable-intersection refusal still names the object', async () => {
    const handler = bindAgainst(async (object: string) => {
      if (object === 'sys_approval_request') return [{ record_id: 'r1', status: 'pending' }];
      throw new Error('driver exploded');
    });

    const thrown = await refusalFrom(handler, {
      object: 'leave_request',
      input: { data: { amount: 1 }, options: { where: { status: 'draft' } } },
    });

    expect(thrown.message).toBe(
      "RECORD_LOCKED: cannot determine which rows a predicate update on 'leave_request' would touch " +
      '(driver exploded); 1 record(s) of it carry a pending approval, so the write is refused',
    );
    expect(thrown.code).toBe('RECORD_LOCKED');
    expect(thrown.statusCode).toBe(409);
  });
});

/**
 * [#34060] The per-row refusal is in the WRITER's locale.
 *
 * User-facing refusal text is in the request locale (ruling C on #32440), and
 * the record door's other refusals already answer that way through the shared
 * Operation Message Catalog. This refusal now does too, under the
 * `record_locked*` keys: the object is named by its label in the writer's
 * locale (the pack's `objects.<object>.label`, else the declared label), the
 * record by its title, and a locale the catalog does not carry reads English.
 * The wire vocabulary does not move: `RECORD_LOCKED` / 409 and the
 * `CODE: message` envelope on every leg.
 *
 * Same real rig as the #18153 describe above. The `i18n` service is a double
 * holding one zh-CN pack, shaped as `II18nService` answers: `t()` echoes the
 * key back on a miss, and `getLocales()` lists what it holds.
 */
describe('[#34060] the per-row refusal is worded in the writer\'s locale', () => {
  const TAIL_EN = 'is locked while an approval is in progress, and cannot be edited until that approval is complete';
  const ZH = BUILTIN_OPERATION_MESSAGES['zh-CN'];
  const PACKS: Record<string, Record<string, string>> = {
    'zh-CN': {
      'objects.opportunity.label': '商机',
      'objects.ledger_entry.label': '分类账分录',
    },
  };
  const i18n = {
    getLocales: () => Object.keys(PACKS),
    getTranslations: (locale: string) => nestedPack(PACKS[locale]),
    t: (key: string, locale: string) => PACKS[locale]?.[key] ?? key,
  };

  let engine: ObjectQL;
  let opportunityId: string;
  let ledgerId: string;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  async function rig(service: (() => any) | undefined): Promise<void> {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const o of [OPPORTUNITY, LEDGER_ENTRY, APPROVAL_REQUEST]) {
      engine.registry.registerObject(o as any, 'com.objectstack.test.34060');
    }
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    opportunityId = String((await engine.insert('opportunity', { name: 'Acme renewal', amount: 100 })).id);
    ledgerId = String((await engine.insert('ledger_entry', { amount: 100 })).id);
    for (const [object, recordId] of [['opportunity', opportunityId], ['ledger_entry', ledgerId]] as const) {
      await engine.insert('sys_approval_request', {
        object_name: object, record_id: recordId, status: 'pending',
        flow_run_id: 'run_1', node_config_json: NODE_CONFIG,
      }, { context: { isSystem: true } } as any);
    }
    bindApprovalLockHook(engine as any, undefined, undefined, service);
  }

  /** The refusal a writer in `locale` gets; the engine copies the envelope's locale onto the hook session. */
  async function refusalIn(locale: string | undefined, object: string, id: string): Promise<any> {
    let thrown: any = null;
    try {
      await engine.update(object, { amount: 999 }, {
        where: { id },
        context: { userId: 'u_writer', positions: [], permissions: [], ...(locale ? { locale } : {}) },
      } as any);
    } catch (e) { thrown = e; }
    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('RECORD_LOCKED');
    expect(thrown.statusCode).toBe(409);
    expect(thrown.message.startsWith('RECORD_LOCKED: ')).toBe(true);
    // Nothing reached the store.
    expect((await engine.findOne(object, { where: { id } }))?.amount).toBe(100);
    return thrown;
  }

  it('zh-CN: the Chinese sentence, naming the object by its zh-CN label and the record by its title', async () => {
    await rig(() => i18n);
    const thrown = await refusalIn('zh-CN', 'opportunity', opportunityId);
    expect(thrown.message).toBe(
      `RECORD_LOCKED: ${ZH.record_locked.replace('{{object}}', '商机').replace('{{title}}', 'Acme renewal')}`,
    );
    expect(thrown.message).toContain('商机「Acme renewal」');
    expect(thrown.message).not.toContain(TAIL_EN);
    expect(thrown.message).not.toContain(opportunityId);
    // [#34699] The same sentence is marked for the end user, without the wire prefix.
    expect(thrown.userMessage).toBe(ZH.record_locked.replace('{{object}}', '商机').replace('{{title}}', 'Acme renewal'));
  });

  it('zh-CN, a record with no title: the label-only sentence, still in Chinese', async () => {
    await rig(() => i18n);
    const thrown = await refusalIn('zh-CN', 'ledger_entry', ledgerId);
    expect(thrown.message).toBe(`RECORD_LOCKED: ${ZH.record_locked_untitled.replace('{{object}}', '分类账分录')}`);
    expect(thrown.message).not.toContain(ledgerId);
  });

  it('a bare `zh` reaches the zh-CN sentence and label', async () => {
    await rig(() => i18n);
    const thrown = await refusalIn('zh', 'opportunity', opportunityId);
    expect(thrown.message).toContain('商机「Acme renewal」');
  });

  it('en-US: the English sentence, byte-identical to the one this replaced', async () => {
    await rig(() => i18n);
    const thrown = await refusalIn('en-US', 'opportunity', opportunityId);
    expect(thrown.message).toBe(`RECORD_LOCKED: Opportunity 'Acme renewal' ${TAIL_EN}`);
  });

  it('a locale the catalog does not carry falls back to English', async () => {
    await rig(() => i18n);
    const thrown = await refusalIn('xx-YY', 'opportunity', opportunityId);
    expect(thrown.message).toBe(`RECORD_LOCKED: Opportunity 'Acme renewal' ${TAIL_EN}`);
  });

  it('no locale on the write: English', async () => {
    await rig(() => i18n);
    const thrown = await refusalIn(undefined, 'opportunity', opportunityId);
    expect(thrown.message).toBe(`RECORD_LOCKED: Opportunity 'Acme renewal' ${TAIL_EN}`);
    expect(thrown.userMessage).toBe(`Opportunity 'Acme renewal' ${TAIL_EN}`);
  });

  it('no i18n service: the built-in catalog still answers zh-CN, with the declared label', async () => {
    await rig(undefined);
    const thrown = await refusalIn('zh-CN', 'opportunity', opportunityId);
    expect(thrown.message).toBe(
      `RECORD_LOCKED: ${ZH.record_locked.replace('{{object}}', 'Opportunity').replace('{{title}}', 'Acme renewal')}`,
    );
  });

  it('a deployment translation of `errors.record_locked` wins, interpolated', async () => {
    const override = {
      getLocales: () => ['zh-CN'],
      getTranslations: i18n.getTranslations,
      t: (key: string, locale: string) =>
        key === 'errors.record_locked' && locale === 'zh-CN' ? '{{object}}《{{title}}》审批中，暂不可改' : i18n.t(key, locale),
    };
    await rig(() => override);
    const thrown = await refusalIn('zh-CN', 'opportunity', opportunityId);
    expect(thrown.message).toBe('RECORD_LOCKED: 商机《Acme renewal》审批中，暂不可改');
  });

  it('a throwing i18n service degrades the wording, never the lock', async () => {
    await rig(() => { throw new Error('i18n exploded'); });
    const thrown = await refusalIn('zh-CN', 'opportunity', opportunityId);
    expect(thrown.message).toContain('Opportunity「Acme renewal」');
  });
});

/**
 * [#34454] A deployment's `errors.record_locked*` override is asked with the
 * NEGOTIATED locale, the tag the object's label in the same sentence is asked
 * with — the way objectql's catalog callers ask (`negotiatedMessageLocale`).
 *
 * The `i18n` double is shaped as `FileI18nAdapter` answers, which is what makes
 * the gap reachable: `t()` matches the locale tag EXACTLY (a `zh-CN` pack is
 * not read for `zh`) and interpolates the `params` it is handed. Asked with the
 * raw `zh`, the override missed and a bare-`zh` writer read the built-in zh-CN
 * sentence around the pack's zh-CN label, the deployment's own sentence skipped.
 *
 * The last case is the override path's interpolation: the record's title is
 * row content, and a title that itself contains a placeholder is printed as
 * written, not expanded by a second pass over the service's answer.
 */
describe('[#34454] the record-lock override is asked with the negotiated locale', () => {
  const OVERRIDE = '{{object}}《{{title}}》审批中，暂不可改';
  const PACKS: Record<string, Record<string, string>> = {
    'zh-CN': {
      'objects.opportunity.label': '商机',
      'errors.record_locked': OVERRIDE,
    },
  };
  /** `FileI18nAdapter`-shaped: exact tag match, `{{name}}` interpolation of `params`, the key echoed on a miss. */
  const exactMatchI18n = {
    getLocales: () => Object.keys(PACKS),
    getTranslations: (locale: string) => nestedPack(PACKS[locale]),
    t: (key: string, locale: string, params?: Record<string, unknown>) => {
      const value = PACKS[locale]?.[key];
      if (value === undefined) return key;
      return params ? value.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (params[k] != null ? String(params[k]) : m)) : value;
    },
  };

  let engine: ObjectQL;

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  /** One opportunity named `title`, held by a pending approval; the hook bound to the exact-match service. */
  async function lockedOpportunity(title: string): Promise<string> {
    engine = new ObjectQL();
    engine.registerDriver(new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const o of [OPPORTUNITY, APPROVAL_REQUEST]) {
      engine.registry.registerObject(o as any, 'com.objectstack.test.34454');
    }
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    const id = String((await engine.insert('opportunity', { name: title, amount: 100 })).id);
    await engine.insert('sys_approval_request', {
      object_name: 'opportunity', record_id: id, status: 'pending',
      flow_run_id: 'run_1', node_config_json: NODE_CONFIG,
    }, { context: { isSystem: true } } as any);
    bindApprovalLockHook(engine as any, undefined, undefined, () => exactMatchI18n);
    return id;
  }

  async function refusalIn(locale: string, id: string): Promise<any> {
    let thrown: any = null;
    try {
      await engine.update('opportunity', { amount: 999 }, {
        where: { id },
        context: { userId: 'u_writer', positions: [], permissions: [], locale },
      } as any);
    } catch (e) { thrown = e; }
    expect(thrown).not.toBeNull();
    expect(thrown.code).toBe('RECORD_LOCKED');
    expect(thrown.statusCode).toBe(409);
    expect((await engine.findOne('opportunity', { where: { id } }))?.amount).toBe(100);
    return thrown;
  }

  it('a bare `zh` writer reads the deployment\'s zh-CN override', async () => {
    const id = await lockedOpportunity('Acme renewal');
    const thrown = await refusalIn('zh', id);
    expect(thrown.message).toBe('RECORD_LOCKED: 商机《Acme renewal》审批中，暂不可改');
  });

  it('CONTROL — a zh-CN writer reads the same override', async () => {
    const id = await lockedOpportunity('Acme renewal');
    const thrown = await refusalIn('zh-CN', id);
    expect(thrown.message).toBe('RECORD_LOCKED: 商机《Acme renewal》审批中，暂不可改');
  });

  it('a title containing a placeholder is printed as written on the override path', async () => {
    const id = await lockedOpportunity('Q{{object}} {{title}}');
    const thrown = await refusalIn('zh', id);
    expect(thrown.message).toBe('RECORD_LOCKED: 商机《Q{{object}} {{title}}》审批中，暂不可改');
  });
});
