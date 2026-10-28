// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#26608] A record name composed of select option labels reads in the
// reader's locale — on a real boot: REST, the exec-context, the ObjectQL engine
// and the i18n service the stack's `translations` load into.
//
// The name is a formula `nameField` calling `label(record.kind)`. The console
// reads it without evaluating anything: the save toast from the WRITE response,
// the record page title from `GET /data/:object/:id`, a related list from the
// list read. All three are served here with `Accept-Language`, which the
// console sends on every call, in zh-CN and in en-US.
//
// The label a formula prints must be the label the select control shows the
// same reader, so one test reads both off the same boot: the option label
// `GET /meta/object/:name` serves in a locale, and the name the data read
// serves in it.
//
// Boots a fixture stack of its own, so it stays out of `SHARED_SHOWCASE`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';

const OBJECT = 'fol_version';
const NAME = "'v' + string(record.version_no) + ' · ' + label(record.kind)";

const fixtureStack = defineStack({
  manifest: {
    id: 'com.dogfood.formula-option-label-locale',
    namespace: 'fol',
    version: '0.0.0',
    type: 'app',
    name: 'Formula Option Label Locale Fixture',
    description: 'A contract version named by a formula over a select (#26608).',
  },
  objects: [
    {
      name: OBJECT,
      label: 'Contract Version',
      sharingModel: 'public_read_write',
      nameField: 'display_name',
      fields: {
        version_no: { type: 'number', label: 'Version' },
        kind: {
          type: 'select',
          label: 'Kind',
          options: [
            { label: 'Clean', value: 'clean' },
            { label: 'Redline', value: 'redline' },
          ],
        },
        display_name: { type: 'formula', label: 'Name', expression: { dialect: 'cel', source: NAME }, returnType: 'text' },
      },
    },
  ],
  translations: [
    {
      'zh-CN': {
        objects: { [OBJECT]: { fields: { kind: { options: { clean: '清稿', redline: '修订稿' } } } } },
      },
    },
  ],
} as never);

describe('dogfood: a formula name reads its select option label in the reader\'s locale (#26608)', () => {
  let stack: VerifyStack;
  let token: string;

  /** An authed JSON request in a stated language. */
  const apiIn = (locale: string | undefined, method: string, path: string, body?: unknown) =>
    stack.api(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(locale ? { 'Accept-Language': locale } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  /** The record a data response carries, whichever envelope it answers in. */
  const recordOf = async (res: Response, what: string): Promise<any> => {
    const text = await res.text();
    expect(res.status, `${what}: ${text.slice(0, 300)}`).toBeLessThan(300);
    const body = JSON.parse(text);
    return body?.record ?? body;
  };

  const create = async (locale: string | undefined, row: Record<string, unknown>) =>
    recordOf(await apiIn(locale, 'POST', `/data/${OBJECT}`, row), `POST /data/${OBJECT}`);

  const readOne = async (locale: string | undefined, id: string) =>
    recordOf(await apiIn(locale, 'GET', `/data/${OBJECT}/${id}`), `GET /data/${OBJECT}/${id}`);

  beforeAll(async () => {
    stack = await bootStack(fixtureStack);
    token = await stack.signIn();
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
  });

  it('the create response — what the save toast names the record from — reads the writer\'s locale', async () => {
    expect((await create('zh-CN', { version_no: 2, kind: 'clean' })).display_name).toBe('v2 · 清稿');
    expect((await create('en-US', { version_no: 3, kind: 'redline' })).display_name).toBe('v3 · Redline');
  });

  it('a record read — the record page title — reads each reader\'s own locale', async () => {
    const created = await create('en-US', { version_no: 4, kind: 'clean' });
    expect((await readOne('zh-CN', created.id)).display_name).toBe('v4 · 清稿');
    expect((await readOne('en-US', created.id)).display_name).toBe('v4 · Clean');
  });

  it('an update response reads the updater\'s locale', async () => {
    const created = await create('en-US', { version_no: 5, kind: 'clean' });
    const updated = await recordOf(
      await apiIn('zh-CN', 'PATCH', `/data/${OBJECT}/${created.id}`, { kind: 'redline' }),
      `PATCH /data/${OBJECT}/${created.id}`,
    );
    expect(updated.display_name).toBe('v5 · 修订稿');
  });

  it('a list read — a related list — reads the reader\'s locale', async () => {
    const created = await create('en-US', { version_no: 6, kind: 'redline' });
    const res = await apiIn('zh-CN', 'GET', `/data/${OBJECT}`);
    const text = await res.text();
    expect(res.status, text.slice(0, 300)).toBe(200);
    const body = JSON.parse(text);
    const rows: any[] = body?.records ?? body?.data ?? body?.value ?? [];
    expect(rows.find((r) => r.id === created.id)?.display_name, text.slice(0, 300)).toBe('v6 · 修订稿');
  });

  it('prints the label the select control shows the same reader — one translation path', async () => {
    const created = await create('en-US', { version_no: 7, kind: 'clean' });
    for (const locale of ['zh-CN', 'en-US']) {
      const meta = await apiIn(locale, 'GET', `/meta/object/${OBJECT}`);
      expect(meta.status, `GET /meta/object/${OBJECT}`).toBe(200);
      const options: any[] = ((await meta.json()) as any)?.item?.fields?.kind?.options ?? [];
      const shown = options.find((o) => o.value === 'clean')?.label;
      expect(shown, locale).toBeTruthy();
      expect((await readOne(locale, created.id)).display_name, locale).toBe(`v7 · ${shown}`);
    }
  });
});
