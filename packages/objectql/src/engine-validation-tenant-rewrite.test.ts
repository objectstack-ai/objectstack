// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0029 D9.2a — a tenant's rewrite of a packaged rule message beats the
 * packaged translation, on BOTH readers of the rule, and the two still agree.
 *
 * A packaged object declares two rules and ships their `zh-CN` translations at
 * `objects.<o>._validations.<rule>.message`. A tenant overlays the object
 * (ADR-0029 D9) and rewrites one of the two messages, keeping the rule's name.
 * The catalog translates the PACKAGED rule, so under `zh-CN`:
 *
 *  - the rewritten rule must answer the tenant's own sentence, as written;
 *  - the rule the tenant left alone must still answer its translation;
 *  - a rule a second package folds on through `objectExtensions` — absent
 *    from the owner's declaration by construction — must still answer its own
 *    package's translation: it has no packaged message to diverge from.
 *
 * Both readers are driven off ONE real registry: the refusal of a real write
 * (the engine's validator), and the served object as `/meta` translates it —
 * `translateObject` over the resolved object, with the packaged base the
 * serving layer hands it (`getPackagedObjectBase`, the accessor `/meta` reads
 * through `packagedObjectBaseOf`). For every header they must be one string.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { preferredLocaleFromHeader, translateObject } from '@objectstack/spec/system';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './index.js';

const OBJ = 'tr_duty';
const PKG = 'com.objectstack.test.tenant-rewrite';
const EXT_PKG = 'com.objectstack.test.tenant-rewrite-extension';

const PACKAGED = {
  returned_needs_note: 'Say why the duty is being returned.',
  done_needs_owner: 'A finished duty needs an owner.',
  ext_blocked_needs_reason: 'Say what is blocking the duty.',
};
const ZH = {
  returned_needs_note: '请写明打回的原因。',
  done_needs_owner: '已完成的职责需要负责人。',
  ext_blocked_needs_reason: '请写明阻塞原因。',
};

/** The extension package's own rule, folded onto the object. */
const EXTENSION = {
  name: OBJ,
  validations: [{
    type: 'script',
    name: 'ext_blocked_needs_reason',
    message: PACKAGED.ext_blocked_needs_reason,
    condition: "record.status == 'blocked' && record.return_note == null",
    fields: ['return_note'],
  }],
};
const REWRITE = 'Tell the owner what to change before you send it back.';

const rules = (returnedMessage: string) => [
  {
    type: 'script',
    name: 'returned_needs_note',
    message: returnedMessage,
    condition: "record.status == 'returned' && record.return_note == null",
    fields: ['return_note'],
  },
  {
    type: 'script',
    name: 'done_needs_owner',
    message: PACKAGED.done_needs_owner,
    condition: "record.status == 'done' && record.owner == null",
    fields: ['owner'],
  },
];

const body = (returnedMessage: string) => ({
  name: OBJ,
  label: 'Duty',
  fields: {
    status: { type: 'text', label: 'Status' },
    return_note: { type: 'text', label: 'Return note' },
    owner: { type: 'text', label: 'Owner' },
  },
  validations: rules(returnedMessage),
});

const BUNDLE: Record<string, any> = {
  en: {
    objects: {
      [OBJ]: {
        _validations: {
          returned_needs_note: { message: PACKAGED.returned_needs_note },
          done_needs_owner: { message: PACKAGED.done_needs_owner },
          ext_blocked_needs_reason: { message: PACKAGED.ext_blocked_needs_reason },
        },
      },
    },
  },
  'zh-CN': {
    objects: {
      [OBJ]: {
        _validations: {
          returned_needs_note: { message: ZH.returned_needs_note },
          done_needs_owner: { message: ZH.done_needs_owner },
          ext_blocked_needs_reason: { message: ZH.ext_blocked_needs_reason },
        },
      },
    },
  },
};

/** `FileI18nAdapter.t()`-shaped: the locale exactly, then the fallback, then the key echoed. */
function servedI18n(bundle: Record<string, any>, fallbackLocale = 'en') {
  const dig = (data: unknown, key: string): unknown =>
    key.split('.').reduce<unknown>(
      (cur, part) => (cur && typeof cur === 'object' ? (cur as any)[part] : undefined),
      data,
    );
  return {
    t(key: string, locale: string): string {
      const exact = dig(bundle[locale], key);
      if (typeof exact === 'string') return exact;
      const fallback = dig(bundle[fallbackLocale], key);
      return typeof fallback === 'string' ? fallback : key;
    },
    getLocales: () => Object.keys(bundle),
  };
}

function makeDriver() {
  const rows = new Map<string, any>();
  return {
    name: 'com.objectstack.driver.memory.tr',
    version: '1.0.0',
    async connect() { /* noop */ },
    async disconnect() { /* noop */ },
    async initObjects() { /* noop */ },
    async find() { return [...rows.values()]; },
    async findOne(_o: string, options?: any) { return rows.get(String(options?.where?.id)) ?? null; },
    async count() { return rows.size; },
    async create(_o: string, data: any) { rows.set(String(data.id), data); return data; },
    async update(_o: string, data: any) { return data; },
    async delete() { return false; },
  } as any;
}

describe('ADR-0029 D9.2a a tenant-rewritten rule message, on the refusal and on /meta', () => {
  let engine: ObjectQL;
  let protocol: any;

  /** Boot the packaged object, then (optionally) the tenant's overlay layer. */
  async function boot(overlay: boolean) {
    engine = new ObjectQL();
    engine.registerDriver(makeDriver(), true);
    await engine.init();
    engine.setI18nService(servedI18n(BUNDLE) as any);
    engine.registry.registerObject(body(PACKAGED.returned_needs_note) as any, PKG);
    engine.registry.registerObject(EXTENSION as any, EXT_PKG, undefined, 'extend');
    if (overlay) {
      engine.registry.registerObject({ ...body(REWRITE), _provenance: 'org' } as any, PKG, undefined, 'overlay');
    }
    protocol = new ObjectStackProtocolImplementation(engine as any);
  }

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  async function refusal(header: string, data: Record<string, unknown>): Promise<string> {
    try {
      await engine.insert(OBJ, data, { context: { locale: preferredLocaleFromHeader(header) } } as any);
    } catch (e: any) {
      return String(e?.fields?.[0]?.message ?? e?.message);
    }
    throw new Error('expected the write to be rejected');
  }

  function served(header: string): Record<string, string> {
    const doc = translateObject(engine.registry.getObject(OBJ) as any, BUNDLE as any, {
      locale: preferredLocaleFromHeader(header),
      fallbackChain: ['en'],
      packagedBase: protocol.getPackagedObjectBase(OBJ),
    }) as any;
    return Object.fromEntries(doc.validations.map((r: any) => [r.name, r.message]));
  }

  async function table() {
    const out: Record<string, unknown> = {};
    for (const header of ['zh-CN', 'zh', 'en']) {
      out[header] = {
        served: served(header),
        refusal: {
          returned_needs_note: await refusal(header, { id: 'r1', status: 'returned' }),
          done_needs_owner: await refusal(header, { id: 'r2', status: 'done' }),
          ext_blocked_needs_reason: await refusal(header, { id: 'r3', status: 'blocked' }),
        },
      };
    }
    return out;
  }

  describe('with the tenant overlay', () => {
    beforeEach(async () => { await boot(true); });

    it('the overlay is what both readers see, over a packaged owner that is still there', () => {
      const served = (engine.registry.getObject(OBJ) as any).validations.map((r: any) => r.name);
      expect(served).toEqual(['returned_needs_note', 'done_needs_owner', 'ext_blocked_needs_reason']);
      expect((engine.registry.getObject(OBJ) as any).validations[0].message).toBe(REWRITE);
      const packaged = protocol.getPackagedObjectBase(OBJ) as any;
      expect(packaged.validations.map((r: any) => r.name)).toEqual(['returned_needs_note', 'done_needs_owner']);
      expect(packaged.validations[0].message).toBe(PACKAGED.returned_needs_note);
    });

    it('serves and refuses with the rewrite as written, and still translates the untouched and extension rules', async () => {
      const rows = (t: typeof ZH) => ({
        returned_needs_note: REWRITE,
        done_needs_owner: t.done_needs_owner,
        ext_blocked_needs_reason: t.ext_blocked_needs_reason,
      });
      expect(await table()).toEqual({
        'zh-CN': { served: rows(ZH), refusal: rows(ZH) },
        zh: { served: rows(ZH), refusal: rows(ZH) },
        en: { served: rows(PACKAGED), refusal: rows(PACKAGED) },
      });
    });
  });

  describe('control: no overlay', () => {
    beforeEach(async () => { await boot(false); });

    it('translates every rule on both readers', async () => {
      expect(await table()).toEqual({
        'zh-CN': { served: ZH, refusal: ZH },
        zh: { served: ZH, refusal: ZH },
        en: { served: PACKAGED, refusal: PACKAGED },
      });
    });
  });
});
