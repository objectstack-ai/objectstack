// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26991] The share-link resolve answer builder, on its own. Both mounts of
 * the route are pinned through their real entries in
 * `runtime/src/domains/share-links-field-projection.test.ts`; this file holds
 * the builder's boundary and its redaction to their shapes.
 */

import { describe, it, expect } from 'vitest';
import type { ResolveShareLinkResult } from '@objectstack/spec/contracts';
import { buildShareLinkResolveAnswer, projectSharedRecordFields, redactSharedRecord } from './share-link-resolve-answer.js';

const SCHEMA = {
  name: 'deal',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' },
    title: { name: 'title', label: 'Deal Name', type: 'text', required: true, maxLength: 80 },
    stage: {
      name: 'stage',
      label: 'Stage',
      type: 'select',
      multiple: true,
      options: [{ value: 'open', label: 'Open', color: '#000', default: true, visibleWhen: 'x' }],
    },
    amount: { name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'CNY' } },
    account: { name: 'account', label: 'Account', type: 'lookup', reference: 'account', displayField: 'name', lookupFilters: [] },
    secret: { name: 'secret', label: 'Secret', type: 'text' },
    never_served: { name: 'never_served', label: 'Never Served', type: 'text' },
  },
};

const RESOLVED = {
  link: {
    id: 'shl_1',
    token: 'tok',
    object_name: 'deal',
    record_id: 'd1',
    permission: 'view',
    audience: 'public',
    expires_at: null,
    label: null,
    created_at: '2026-10-28T00:00:00.000Z',
    password_hash: 'hash',
    email_allowlist: ['a@example.test'],
    created_by: 'usr_1',
  },
  redactFields: ['secret'],
} as unknown as ResolveShareLinkResult;

const RECORD = { id: 'd1', title: 'T', stage: ['open'], amount: 3, account: 'a1', secret: 's', computed_extra: 1 };

describe('[#26991] buildShareLinkResolveAnswer', () => {
  it('projects exactly the served keys the object declares, redacted ones excluded', () => {
    const answer = buildShareLinkResolveAnswer(RECORD, RESOLVED, SCHEMA);
    expect(answer.record).toEqual({ id: 'd1', title: 'T', stage: ['open'], amount: 3, account: 'a1', computed_extra: 1 });
    expect(Object.keys(answer.fields).sort()).toEqual(['account', 'amount', 'id', 'stage', 'title']);
  });

  it('carries only the display keys of each field', () => {
    const { fields } = buildShareLinkResolveAnswer(RECORD, RESOLVED, SCHEMA);
    expect(fields.title).toEqual({ label: 'Deal Name', type: 'text' });
    expect(fields.stage).toEqual({ label: 'Stage', type: 'select', multiple: true, options: [{ value: 'open', label: 'Open', color: '#000' }] });
    expect(fields.amount).toEqual({ type: 'currency', currencyConfig: { currencyMode: 'dynamic', defaultCurrency: 'CNY' } });
    expect(fields.account).toEqual({ label: 'Account', type: 'lookup', reference: 'account', displayField: 'name' });
  });

  it('serves the nine link columns and never the hash, the allowlist or the creator (an unlabelled object adds no object_label)', () => {
    const { link, redactFields } = buildShareLinkResolveAnswer(RECORD, RESOLVED, SCHEMA);
    expect(Object.keys(link).sort()).toEqual(
      ['audience', 'created_at', 'expires_at', 'id', 'label', 'object_name', 'permission', 'record_id', 'token'],
    );
    expect(redactFields).toEqual(['secret']);
  });

  it('an object schema the engine cannot return projects nothing', () => {
    expect(buildShareLinkResolveAnswer(RECORD, RESOLVED, undefined).fields).toEqual({});
    expect(projectSharedRecordFields({ name: 'deal' }, RECORD, [])).toEqual({});
  });

  it('a redacted key is skipped even when the record still carries it', () => {
    expect(Object.keys(projectSharedRecordFields(SCHEMA, { secret: 's', id: 'd1' }, ['secret']))).toEqual(['id']);
  });
});

describe('[#26991] redactSharedRecord keeps the redaction both mounts served', () => {
  it('strips the named keys, and from each object of a top-level array', () => {
    expect(redactSharedRecord({ a: 1, b: 2 }, ['b'])).toEqual({ a: 1 });
    expect(redactSharedRecord([{ a: 1, b: 2 }], ['b'])).toEqual([{ a: 1 }]);
  });

  it('returns the input itself when there is nothing to strip', () => {
    const record = { a: 1 };
    expect(redactSharedRecord(record, [])).toBe(record);
    expect(redactSharedRecord(null, ['a'])).toBeNull();
  });
});

describe('[#27188] a record-mode amount (ADR-0144 D2)', () => {
  const RECORD_SCHEMA = {
    name: 'deal',
    fields: {
      amount: { name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code' } },
      currency_code: { name: 'currency_code', label: 'Currency', type: 'text', valueDomain: 'iso_4217_currency' },
    },
  };

  it('projects the currencyField pointer when the record carries the code field', () => {
    const fields = projectSharedRecordFields(RECORD_SCHEMA, { amount: 5, currency_code: 'EUR' }, []);
    expect(fields.amount.currencyConfig).toEqual({ currencyMode: 'record', currencyField: 'currency_code' });
    expect(fields.currency_code).toEqual({ label: 'Currency', type: 'text' });
  });

  it('never names a redacted code field', () => {
    const answer = buildShareLinkResolveAnswer(
      { amount: 5, currency_code: 'EUR' },
      { ...RESOLVED, redactFields: ['currency_code'] } as ResolveShareLinkResult,
      RECORD_SCHEMA,
    );
    expect(answer.record).toEqual({ amount: 5 });
    expect(answer.fields.amount.currencyConfig).toEqual({ currencyMode: 'record' });
    expect(answer.fields.currency_code).toBeUndefined();
  });
});

describe('the object label and the hidden flag', () => {
  const LABELLED = {
    name: 'deal',
    label: 'Deal',
    fields: {
      title: { name: 'title', label: 'Deal Name', type: 'text' },
      score: { name: 'score', label: 'Score', type: 'number', hidden: true },
      queue: { name: 'queue', label: 'Queue', type: 'text', hidden: true, system: true },
      shown: { name: 'shown', label: 'Shown', type: 'text', hidden: false },
    },
  };
  const ROW = { title: 'T', score: 7, queue: 'q', shown: 's' };
  const I18N = {
    getLocales: () => ['en', 'zh-CN'],
    getTranslations: (locale: string) =>
      locale === 'zh-CN' ? { objects: { deal: { label: '商机' } } } : { objects: {} },
    getDefaultLocale: () => 'en',
  };

  it('a field the object declares hidden reports hidden; any other field carries no flag', () => {
    const { fields } = buildShareLinkResolveAnswer(ROW, { ...RESOLVED, redactFields: [] } as ResolveShareLinkResult, LABELLED);
    expect(fields.score).toEqual({ label: 'Score', type: 'number', hidden: true });
    expect(fields.queue.hidden).toBe(true);
    expect(fields.title).not.toHaveProperty('hidden');
    expect(fields.shown).not.toHaveProperty('hidden');
  });

  it('link.object_label is the object label translated into the request locale', () => {
    const answer = buildShareLinkResolveAnswer(ROW, RESOLVED, LABELLED, {
      acceptLanguage: 'zh-CN,zh;q=0.9,en;q=0.8',
      i18n: I18N,
    });
    expect(answer.link.object_label).toBe('商机');
  });

  it('the declared label stands with no i18n service, a locale the bundle does not cover, or a throwing service', () => {
    expect(buildShareLinkResolveAnswer(ROW, RESOLVED, LABELLED).link.object_label).toBe('Deal');
    expect(buildShareLinkResolveAnswer(ROW, RESOLVED, LABELLED, { acceptLanguage: 'ja-JP', i18n: I18N }).link.object_label).toBe('Deal');
    const throwing = { ...I18N, getTranslations: () => { throw new Error('boom'); } };
    expect(buildShareLinkResolveAnswer(ROW, RESOLVED, LABELLED, { acceptLanguage: 'zh-CN', i18n: throwing }).link.object_label).toBe('Deal');
  });

  it('with no Accept-Language the label is read in the i18n default locale, as the meta door reads it', () => {
    const zhDefault = { ...I18N, getDefaultLocale: () => 'zh-CN' };
    expect(buildShareLinkResolveAnswer(ROW, RESOLVED, LABELLED, { i18n: zhDefault }).link.object_label).toBe('商机');
  });

  it('an object that declares no label carries no object_label', () => {
    const answer = buildShareLinkResolveAnswer(ROW, RESOLVED, { name: 'deal', fields: LABELLED.fields }, { acceptLanguage: 'zh-CN', i18n: I18N });
    expect(answer.link).not.toHaveProperty('object_label');
  });
});
