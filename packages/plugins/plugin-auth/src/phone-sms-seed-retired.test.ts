// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The auth SMS seed is retired (ADR-0131: a row exists only when an
 * organization authored it; a notification template has no metadata type, so
 * its seed retires and no type is added).
 *
 *  1. A fresh boot with phone sign-in on writes no `sys_notification_template`
 *     row.
 *  2. Every built-in text renders byte for byte what the SEEDED store rendered,
 *     for every built-in topic and every recipient locale — and so does every
 *     store an operator already has, whatever rows it holds.
 *  3. A row an operator authored still wins.
 *
 * The SEEDED store is reproduced by an ORACLE below: the retired
 * `seedPhoneSmsTemplates` and the retired `loadPhoneSmsTemplateBody ??
 * builtinPhoneSmsBody` composition, transcribed from the last revision that
 * shipped them. It is a frozen copy on purpose: it is the "before" every
 * reading here is compared against, so it must not move when the module does.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PluginContext } from '@objectstack/core';
import { assertEngineFindOnePredicate, assertEngineUpdateDispatch } from '@objectstack/objectql';
import { AuthPlugin } from './auth-plugin';
import {
  BUILTIN_PHONE_SMS_TEMPLATES,
  PHONE_SMS_TOPICS,
  builtinPhoneSmsBody,
  interpolatePhoneSms,
  phoneSmsLocaleChain,
  resolvePhoneSmsTemplateBody,
} from './phone-sms-texts.js';

const TEMPLATE_OBJECT = 'sys_notification_template';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;
const SECRET = 'test-secret-at-least-32-chars-long';

type Row = Record<string, unknown>;

/**
 * A row store answering `find` by every key in `where` (plain equality),
 * honouring `limit`. It REFUSES a combinator it does not implement rather than
 * reading `$and` / `$or` as a field name (`check:where-matcher`).
 */
function matchesWhere(row: Row, where: Record<string, unknown> = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k.startsWith('$') || (v !== null && typeof v === 'object')) {
      throw new Error(`store(): unsupported where clause on '${k}' — this double implements plain equality only`);
    }
    return row[k] === v;
  });
}

function store(rows: Row[]) {
  const all = rows.map((r) => ({ ...r }));
  return {
    all,
    async find(_object: string, q: any) {
      const hit = all.filter((r) => matchesWhere(r, q?.where));
      return typeof q?.limit === 'number' ? hit.slice(0, q.limit) : hit;
    },
    async insert(_object: string, row: Row) { all.push({ ...row }); return row; },
  };
}

// ── The oracle: the retired seed, then the retired read ──────────────────────

/** The retired `seedPhoneSmsTemplates`: insert a built-in row where NO row exists. */
async function retiredSeed(engine: ReturnType<typeof store>): Promise<void> {
  for (const tpl of BUILTIN_PHONE_SMS_TEMPLATES) {
    const existing = await engine.find(TEMPLATE_OBJECT, {
      where: { topic: tpl.topic, channel: tpl.channel, locale: tpl.locale },
      limit: 1,
      context: SYSTEM_CTX,
    });
    if (existing.length > 0) continue;
    await engine.insert(TEMPLATE_OBJECT, { ...tpl });
  }
}

/** The retired `loadPhoneSmsTemplateBody(…) ?? builtinPhoneSmsBody(…)`. */
async function retiredRead(engine: ReturnType<typeof store>, topic: string, locale: string | undefined): Promise<string> {
  for (const loc of phoneSmsLocaleChain(locale)) {
    const result = await engine.find(TEMPLATE_OBJECT, {
      where: { topic, channel: 'sms', locale: loc, is_active: true },
      limit: 1,
      context: SYSTEM_CTX,
    });
    const body = result[0]?.body;
    if (typeof body === 'string' && body.trim()) return body;
  }
  return builtinPhoneSmsBody(topic, locale);
}

/** What the seeded store sent for `rows`: seed them as a boot did, then read. */
async function seededWorld(rows: Row[], topic: string, locale: string | undefined): Promise<string> {
  const engine = store(rows);
  await retiredSeed(engine);
  return retiredRead(engine, topic, locale);
}

// ── The matrix ──────────────────────────────────────────────────────────────

const TOPICS = Object.values(PHONE_SMS_TOPICS);
/** Every rung shape the chain takes: none, the two built-in tags, regioned, unbundled. */
const LOCALES: Array<string | undefined> = [undefined, 'en', 'en-US', 'zh', 'zh-CN', 'zh-TW', 'ja-JP'];

/** One operator row state at one `(topic, locale)`. */
type RowState = 'none' | 'active' | 'inactive' | 'blank';
const STATES: RowState[] = ['none', 'active', 'inactive', 'blank'];

function rowFor(topic: string, locale: string, state: RowState): Row[] {
  if (state === 'none') return [];
  return [{
    topic, channel: 'sms', locale, format: 'text',
    is_active: state !== 'inactive',
    body: state === 'blank' ? '   ' : `operator ${state} ${topic} ${locale} {{code}}`,
  }];
}

/** Every combination of states over the given `(topic, locale)` slots. */
function* storesOver(slots: Array<[string, string]>): Generator<Row[]> {
  const pick = (i: number, acc: Row[]): Row[][] =>
    i === slots.length ? [acc] : STATES.flatMap((st) => pick(i + 1, [...acc, ...rowFor(slots[i][0], slots[i][1], st)]));
  yield* pick(0, []);
}

describe('the retired auth SMS seed', () => {
  it('a fresh store renders every built-in text, at every locale, byte for byte as the seeded store did', async () => {
    let compared = 0;
    for (const topic of TOPICS) {
      for (const locale of LOCALES) {
        const now = await resolvePhoneSmsTemplateBody(store([]), topic, locale);
        expect(now, `${topic} @ ${String(locale)}`).toBe(await seededWorld([], topic, locale));
        // …and that text IS the built-in one for the rung, rendered identically.
        expect(now).toBe(builtinPhoneSmsBody(topic, locale));
        const data = { code: '482913', appName: 'Acme', minutes: 5, loginUrl: 'https://acme.test/_console/login' };
        expect(interpolatePhoneSms(now, data)).toBe(interpolatePhoneSms(await seededWorld([], topic, locale), data));
        compared += 1;
      }
    }
    // Every built-in text is reached: both topics in both bundled languages.
    const reached = new Set<string>();
    for (const topic of TOPICS) for (const locale of LOCALES) reached.add(await resolvePhoneSmsTemplateBody(store([]), topic, locale));
    expect([...reached].sort()).toEqual(BUILTIN_PHONE_SMS_TEMPLATES.map((t) => t.body).sort());
    expect(compared).toBe(TOPICS.length * LOCALES.length);
  });

  it('every store an operator may already have renders exactly what it rendered seeded', async () => {
    // Each OTP slot in four states — the two built-in tags and the regioned and
    // unbundled tags a recipient can carry — with the invite topic's built-in
    // slots too: 4^6 stores, every locale, both topics.
    const slots: Array<[string, string]> = [
      [PHONE_SMS_TOPICS.otp, 'en'], [PHONE_SMS_TOPICS.otp, 'zh'],
      [PHONE_SMS_TOPICS.otp, 'zh-CN'], [PHONE_SMS_TOPICS.otp, 'ja-JP'],
      [PHONE_SMS_TOPICS.invite, 'en'], [PHONE_SMS_TOPICS.invite, 'zh'],
    ];
    let compared = 0;
    const diverged: string[] = [];
    for (const rows of storesOver(slots)) {
      for (const topic of TOPICS) {
        for (const locale of LOCALES) {
          const now = await resolvePhoneSmsTemplateBody(store(rows), topic, locale);
          const before = await seededWorld(rows, topic, locale);
          if (now !== before) diverged.push(`${topic} @ ${String(locale)} over ${JSON.stringify(rows)}: ${now} != ${before}`);
          compared += 1;
        }
      }
    }
    expect(diverged.slice(0, 3)).toEqual([]);
    expect(compared).toBe(4 ** slots.length * TOPICS.length * LOCALES.length);
  });

  it('a row an operator authored still wins', async () => {
    const custom = '【定制】验证码 {{code}}';
    const rows = [{ topic: PHONE_SMS_TOPICS.otp, channel: 'sms', locale: 'zh', is_active: true, body: custom }];
    expect(await resolvePhoneSmsTemplateBody(store(rows), PHONE_SMS_TOPICS.otp, 'zh-CN')).toBe(custom);
    expect(await resolvePhoneSmsTemplateBody(store(rows), PHONE_SMS_TOPICS.otp, 'zh')).toBe(custom);
    // The other topic, and the other language, keep their built-in texts.
    expect(await resolvePhoneSmsTemplateBody(store(rows), PHONE_SMS_TOPICS.invite, 'zh')).toBe(
      builtinPhoneSmsBody(PHONE_SMS_TOPICS.invite, 'zh'),
    );
    expect(await resolvePhoneSmsTemplateBody(store(rows), PHONE_SMS_TOPICS.otp, 'en')).toBe(
      builtinPhoneSmsBody(PHONE_SMS_TOPICS.otp, 'en'),
    );
  });
});

describe('a fresh boot with phone sign-in on', () => {
  it('writes no sys_notification_template row', async () => {
    const inserted: Array<{ object: string; row: Row }> = [];
    const engine = {
      registerHook: vi.fn(),
      unregisterHooksByPackage: vi.fn(() => 0),
      count: vi.fn(async () => 0),
      find: vi.fn(async () => []),
      findOne: vi.fn(async (object: string, query: unknown = {}) => {
        assertEngineFindOnePredicate(object, query as never);
        return null;
      }),
      update: vi.fn(async (_object: string, doc: Record<string, unknown>, options?: unknown) => {
        assertEngineUpdateDispatch(doc, options as never);
        return {};
      }),
      insert: vi.fn(async (object: string, row: Row) => { inserted.push({ object, row }); return row; }),
    };
    const hooks: Array<() => Promise<void>> = [];
    const ctx = {
      registerService: vi.fn(),
      getService: vi.fn((name: string) => {
        // `data` is the engine AuthManager is handed (`getDataEngine()`), the
        // one the retired seed wrote through; `objectql` the hooks resolve.
        if (name === 'objectql' || name === 'data') return engine;
        if (name === 'manifest') return { register: vi.fn() };
        return undefined;
      }),
      getServices: vi.fn(() => new Map()),
      hook: vi.fn((name: string, handler: () => Promise<void>) => {
        if (name === 'kernel:ready') hooks.push(handler);
      }),
      trigger: vi.fn(),
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      getKernel: vi.fn(),
    } as never as PluginContext;

    const plugin = new AuthPlugin({ secret: SECRET, baseUrl: 'http://localhost:3000', plugins: { phoneNumber: true } } as never);
    await plugin.init(ctx);
    await plugin.start(ctx);
    expect(hooks.length).toBeGreaterThan(0);
    // Every kernel:ready handler runs; one this file is not about may throw on
    // the minimal engine, and that must not decide this case either way.
    for (const h of hooks) {
      try { await h(); } catch { /* not this test's subject */ }
    }

    expect(inserted.filter((w) => w.object === TEMPLATE_OBJECT)).toEqual([]);
  });
});
