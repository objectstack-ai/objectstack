// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { preferredLocaleFromHeader, translateObject } from '@objectstack/spec/system';
import { ObjectQL } from './engine';
import { SchemaRegistry } from './registry';

/**
 * #15757 — ONE negotiation rule, not two.
 *
 * `@objectstack/spec`'s `resolveBundleLocale` already decides which bundle a
 * requested tag reaches (exact → case-insensitive → base language → VARIANT
 * expansion, which is where a bare `zh` reaches a `zh-CN` bundle). `pickData`
 * calls it, and every document translator — `translateObject`,
 * `translateView`, `translateDataset`, … — goes through `pickData`.
 *
 * The write path's message bridge did not. `ExecutionContext.locale` is the
 * header's first tag verbatim (`preferredLocaleFromHeader`, deliberately: it
 * reports what was ASKED FOR and expands nothing), and the engine handed that
 * tag straight to `II18nService.t()`. A production adapter resolves a locale
 * EXACTLY and then falls to its declared fallback — `FileI18nAdapter.t()`
 * (`@objectstack/services-i18n`) is `resolveFromLocale(key, locale)` then
 * `resolveFromLocale(key, fallbackLocale)` — so `zh` missed the `zh-CN` bundle
 * and the English text came back.
 *
 * The result was a half-translated response with no way for the app to see it
 * coming: same server, same bundle, same header, two paths giving opposite
 * answers. The table below is that observation, rebuilt in-repo.
 *
 * ⛔ These tests must not be satisfied by teaching this package to match
 * variants. The whole point of the card is that a THIRD negotiation rule is
 * the disease; the engine consults the one in `@objectstack/spec`.
 */
vi.mock('./registry', async () => {
  // [#10551] The one shared factory — see `registry-module-mock.ts`.
  const { createRegistryModuleMock } = await import('./registry-module-mock.js');
  return createRegistryModuleMock();
});

const AUTHORED_EN = 'Say why the duty is being returned — the owner needs to know what to change.';
const AUTHORED_ZH = '请写明打回的原因——负责人需要据此知道该改什么。';

/**
 * ONE bundle, feeding BOTH paths — that is what makes the table a control
 * rather than two unrelated readings. `t()` addresses it by dot-notation key
 * (`objects.duly_duty._validations.returned_needs_note.message`) and the
 * document translators read the same nested locations out of the same object.
 */
const BUNDLE: Record<string, any> = {
  en: {
    objects: {
      duly_duty: {
        label: 'Duty',
        fields: { form: { label: 'Form' }, name: { label: 'Duties on the register' } },
        _validations: { returned_needs_note: { message: AUTHORED_EN } },
      },
    },
  },
  'zh-CN': {
    objects: {
      duly_duty: {
        label: '职责',
        fields: { form: { label: '形式' }, name: { label: '清单内职责' } },
        _validations: { returned_needs_note: { message: AUTHORED_ZH } },
      },
    },
  },
};

/**
 * An `II18nService` shaped like the adapter a served deployment actually runs.
 *
 * Faithful to `FileI18nAdapter.t()`: the requested locale EXACTLY, then the
 * declared fallback locale, then the key echoed back (the contract's miss
 * signal). It performs no variant matching of its own — which is the point:
 * negotiation is the caller's job, and every other consumer in the platform
 * already delegates it to `@objectstack/spec`.
 */
function servedI18n(bundle: Record<string, any>, fallbackLocale = 'en') {
  const asked: string[] = [];
  const dig = (data: unknown, key: string): unknown =>
    key.split('.').reduce<unknown>(
      (cur, part) => (cur && typeof cur === 'object' ? (cur as any)[part] : undefined),
      data,
    );
  return {
    asked,
    t(key: string, locale: string): string {
      asked.push(locale);
      const exact = dig(bundle[locale], key);
      if (typeof exact === 'string') return exact;
      const fallback = dig(bundle[fallbackLocale], key);
      return typeof fallback === 'string' ? fallback : key;
    },
    getLocales: () => Object.keys(bundle),
  };
}

const DUTY_SCHEMA = {
  name: 'duly_duty',
  fields: {
    name: { type: 'text', label: 'Duties on the register' },
    form: { type: 'select', label: 'Form' },
    status: { type: 'select', label: 'Status' },
    return_note: { type: 'text', label: 'Return note' },
  },
  validations: [{
    type: 'script',
    name: 'returned_needs_note',
    message: AUTHORED_EN,
    condition: "record.status == 'returned' && (record.return_note == null || record.return_note == '')",
    fields: ['return_note'],
  }],
};

function makeDriver() {
  return {
    name: 'memory',
    supports: {},
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockResolvedValue([{ id: 'r1' }]),
    findOne: vi.fn().mockResolvedValue({ id: 'r1', status: 'open' }),
    create: vi.fn(async (_o: string, row: any) => ({ id: 'r1', ...row })),
    update: vi.fn(async (_o: string, id: string, row: any) => ({ id, ...row })),
    updateMany: vi.fn(async () => 1),
    delete: vi.fn(),
  } as any;
}

async function makeEngine(i18n?: { t: (k: string, l: string) => string; getLocales?: () => string[] }) {
  vi.mocked((SchemaRegistry as any).getObject).mockImplementation((name: string) =>
    name === 'duly_duty' ? DUTY_SCHEMA : undefined,
  );
  const ql = new ObjectQL();
  ql.registerDriver(makeDriver(), true);
  await ql.init();
  if (i18n) ql.setI18nService(i18n as any);
  return ql;
}

/**
 * PATH A — the authored validation message. One `PATCH`-shaped write that
 * trips `returned_needs_note`, with nothing varying but `accept-language`.
 */
async function refusalEnvelopeFor(
  header: string,
  i18n: ReturnType<typeof servedI18n>,
): Promise<{ code: string; field: string; message: string }> {
  const ql = await makeEngine(i18n);
  const locale = preferredLocaleFromHeader(header);
  try {
    await ql.update(
      'duly_duty',
      { id: 'r1', status: 'returned' },
      { context: { locale } } as any,
    );
  } catch (e: any) {
    const f = e?.fields?.[0] ?? {};
    return { code: String(f.code), field: String(f.field), message: String(f.message ?? e?.message ?? '') };
  }
  throw new Error('expected the write to be rejected');
}

async function refusalFor(header: string, i18n: ReturnType<typeof servedI18n>): Promise<string> {
  return (await refusalEnvelopeFor(header, i18n)).message;
}

/** PATH B — the cross-path control: a document translator, same bundle, same header. */
function datasetStyleLabelsFor(header: string): string[] {
  const locale = preferredLocaleFromHeader(header);
  const translated = translateObject(DUTY_SCHEMA as any, BUNDLE, { locale }) as any;
  return [translated.fields.form.label, translated.fields.name.label];
}

describe('#15757 the validation-message bridge negotiates the locale like every other consumer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The card's four rows. THREE OF THEM ARE CONTROLS: `zh-CN` and
   * `zh-CN,zh;q=0.9` prove the path itself works (the key is present, the
   * bundle is loaded); `en` proves the fallback is right. Only bare `zh` was
   * the defect.
   */
  it('answers a bare `zh` in Chinese, and leaves the three control rows exactly as they were', async () => {
    const i18n = servedI18n(BUNDLE);
    // Built as a whole table so ALL FOUR rows are reported by one run — a row
    // that stops the test is a row whose controls were never read.
    const table: Record<string, string> = {};
    for (const header of ['zh-CN', 'zh-CN,zh;q=0.9', 'zh', 'en']) {
      table[header] = await refusalFor(header, i18n);
    }
    expect(table).toEqual({
      'zh-CN': AUTHORED_ZH,          // control: the path works at all
      'zh-CN,zh;q=0.9': AUTHORED_ZH, // control: a q-weighted header is unchanged
      zh: AUTHORED_ZH,               // THE DEFECT: was AUTHORED_EN
      en: AUTHORED_EN,               // control: the fallback is right
    });
  });

  /**
   * The MACHINE-READABLE half of the envelope is what a client ACTS on, and it
   * is untouched: the write is refused in exactly the same cases, with the same
   * `code` and the same `field`, for every one of the four headers. Only the
   * sentence's LANGUAGE moved — no request is newly accepted, and none is newly
   * rejected.
   */
  it('changes the language of a refusal and nothing about the refusal', async () => {
    const i18n = servedI18n(BUNDLE);
    const envelopes = [];
    for (const header of ['zh-CN', 'zh-CN,zh;q=0.9', 'zh', 'en', 'de']) {
      envelopes.push(await refusalEnvelopeFor(header, i18n));
    }
    // Every header is refused, and refused identically where it counts.
    expect(envelopes.map((e) => e.code)).toEqual(
      ['rule_violation', 'rule_violation', 'rule_violation', 'rule_violation', 'rule_violation'],
    );
    expect(envelopes.map((e) => e.field)).toEqual(
      ['return_note', 'return_note', 'return_note', 'return_note', 'return_note'],
    );
    // A record that satisfies the rule is still accepted, in every locale.
    for (const locale of ['zh-CN', 'zh', 'en', 'de']) {
      const ql = await makeEngine(i18n);
      await expect(
        ql.update('duly_duty', { id: 'r1', status: 'returned', return_note: 'why' }, { context: { locale } } as any),
      ).resolves.toBeDefined();
    }
  });

  /**
   * The cross-path control, and the whole point of the card: the SAME `zh`,
   * against the SAME bundle, must not produce a Chinese screen with an English
   * refusal on it.
   */
  it('agrees with the document translators on the same header and the same bundle', async () => {
    const i18n = servedI18n(BUNDLE);
    expect(datasetStyleLabelsFor('zh')).toEqual(['形式', '清单内职责']);
    expect(await refusalFor('zh', i18n)).toBe(AUTHORED_ZH);

    expect(datasetStyleLabelsFor('en')).toEqual(['Form', 'Duties on the register']);
    expect(await refusalFor('en', i18n)).toBe(AUTHORED_EN);
  });

  /**
   * The mechanism, asserted rather than inferred: the bridge asks the service
   * for `zh-CN`, the locale `resolveBundleLocale` picked out of what the
   * service reports it HAS. `preferredLocaleFromHeader` still returns the bare
   * tag — it is not this card's job to change what a client asked for.
   */
  it('asks the service for the locale it actually has, not the tag the client sent', async () => {
    const i18n = servedI18n(BUNDLE);
    expect(preferredLocaleFromHeader('zh')).toBe('zh');
    await refusalFor('zh', i18n);
    expect(i18n.asked).not.toContain('zh');
    expect(i18n.asked).toContain('zh-CN');
  });

  /**
   * A tag no variant of which is on offer must not be bent into one. `de` has
   * nothing behind it, so the service is asked for `de`, misses, and the
   * deployment's own fallback answers — unchanged behaviour.
   */
  it('leaves a locale with no match alone', async () => {
    const i18n = servedI18n(BUNDLE);
    expect(await refusalFor('de', i18n)).toBe(AUTHORED_EN);
    expect(i18n.asked).toContain('de');
  });

  /**
   * `getLocales()` is required by `II18nService`, but the engine's setter
   * accepts anything with a `t` — a partial double, a host-supplied shim. With
   * nothing to negotiate against, the requested tag is passed through
   * verbatim: negotiation needs a list of what EXISTS, and inventing one is
   * how a second rule gets born.
   */
  it('passes the tag through when the service cannot report its locales', async () => {
    const asked: string[] = [];
    const ql = await makeEngine({
      t: (key: string, locale: string) => { asked.push(locale); return key; },
    });
    try {
      await ql.update('duly_duty', { id: 'r1', status: 'returned' }, { context: { locale: 'zh' } } as any);
    } catch { /* expected */ }
    expect(asked).toContain('zh');
  });
});
