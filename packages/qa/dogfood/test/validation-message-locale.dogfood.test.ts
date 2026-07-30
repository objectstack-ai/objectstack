// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Localized field-validation messages, end-to-end through the real stack:
// HTTP request (`Accept-Language`) → REST exec-context → ObjectQL engine →
// record-validator → `400 VALIDATION_FAILED` body → what the Console toast and
// the CSV-import row report display.
//
// #3957: the write path built each message by concatenating the API field name
// into a hardcoded English template, so a Chinese-locale user importing a bad row
// read, verbatim in the UI:
//
//     第 1 行:penalty_amount must be ≥ 0
//
// …for a field declared `label: '处罚金额'`. The form layer localized the SAME
// constraint correctly (the browser's native `min`), so the language flipped
// depending on which layer caught the value. These tests pin the whole chain:
// the message is in the caller's language, names the field the way the user
// knows it, and carries the constraint as data so a custom client can format its
// own text.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { defineStack } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

// Mirrors the reporting object from the issue: Chinese labels, range-guarded
// settlement amounts, a bounded remark.
const VmlSettlement = ObjectSchema.create({
  name: 'vml_settlement',
  label: '结算单',
  fields: {
    name: Field.text({ label: '名称', required: true }),
    penalty_amount: Field.currency({ label: '处罚金额', min: 0 }),
    copq: Field.currency({ label: '质量成本', max: 99999999.99 }),
    quota_hours: Field.number({ label: '定额工时', min: 0 }),
    remark: Field.text({ label: '备注', maxLength: 512 }),
  },
});

const vmlStack = defineStack({
  manifest: {
    id: 'com.dogfood.validation_message_locale',
    namespace: 'vml',
    version: '0.0.0',
    type: 'app',
    name: 'Validation Message Locale Fixture',
    description: 'Range-guarded settlement fields with Chinese labels (#3957).',
  },
  objects: [VmlSettlement],
});

describe('objectstack verify: localized field-validation messages (#3957)', () => {
  let stack: VerifyStack;
  let token: string;

  /** An authed JSON request that expresses a language preference. */
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

  const reject = async (locale: string | undefined, body: unknown) => {
    const r = await apiIn(locale, 'POST', '/data/vml_settlement', body);
    expect(r.status, `expected a 400, got ${r.status}`).toBe(400);
    return (await r.json()) as any;
  };

  beforeAll(async () => {
    stack = await bootStack(vmlStack);
    token = await stack.signIn();
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('a zh-CN caller reads Chinese, and never the API column name', async () => {
    const body = await reject('zh-CN', { name: 'S1', penalty_amount: -1 });
    // What the Console toast shows verbatim.
    expect(body.error).toBe('处罚金额必须大于或等于 0');
    expect(JSON.stringify(body)).not.toContain('must be');
    expect(body.fields[0].message).toBe('处罚金额必须大于或等于 0');
    // The API name stays in `field` so a form can focus the right input.
    expect(body.fields[0].field).toBe('penalty_amount');
    expect(body.fields[0].message).not.toContain('penalty_amount');
  });

  it('carries label + code + constraint so a client can format its own text', async () => {
    const body = await reject('zh-CN', { name: 'S1', remark: 'x'.repeat(3000) });
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.fields[0]).toMatchObject({
      field: 'remark',
      code: 'max_length',
      label: '备注',
      constraint: { maxLength: 512, actual: 3000 },
    });
    expect(body.fields[0].message).toBe('备注长度不能超过 512 个字符(当前 3000 个)');
  });

  it('every range guard from the issue is localized', async () => {
    expect((await reject('zh-CN', { name: 'S', copq: 1e12 })).error)
      .toBe('质量成本必须小于或等于 99999999.99');
    expect((await reject('zh-CN', { name: 'S', quota_hours: -3 })).error)
      .toBe('定额工时必须大于或等于 0');
    // required, on the same object
    expect((await reject('zh-CN', { penalty_amount: 1 })).error).toBe('名称不能为空');
  });

  /**
   * The sentence and the field name resolve independently: the TEMPLATE comes
   * from the requested locale's catalog, the LABEL from the bundle (or, with no
   * translation for that locale, the declared label). This fixture ships only
   * Chinese labels, so a `ja-JP` request yields a Japanese sentence around the
   * declared Chinese label — correct, and proof the two are separate lookups.
   */
  it('follows the request locale, not a single server-wide language', async () => {
    expect((await reject('ja-JP', { name: 'S', quota_hours: -3 })).error)
      .toBe('定额工时は 0 以上で入力してください');
    expect((await reject('es-ES', { name: 'S', quota_hours: -3 })).error)
      .toBe('定额工时 debe ser mayor o igual que 0');
    // A base-language tag and a weighted header both resolve.
    expect((await reject('zh', { name: 'S', quota_hours: -3 })).error)
      .toBe('定额工时必须大于或等于 0');
    expect((await reject('zh-CN,zh;q=0.9,en;q=0.8', { name: 'S', quota_hours: -3 })).error)
      .toBe('定额工时必须大于或等于 0');
  });

  /**
   * No stated preference → the workspace default (`en-US`). The template is
   * English again, but the field is STILL named by its label: even the
   * unlocalized path stops leaking `quota_hours` at end users.
   */
  it('a caller with no language preference gets English against the label', async () => {
    const body = await reject(undefined, { name: 'S', quota_hours: -3 });
    expect(body.error).toBe('定额工时 must be ≥ 0');
    expect(body.error).not.toContain('quota_hours');
  });

  it('PATCH is localized too, not only create', async () => {
    const created = await apiIn('zh-CN', 'POST', '/data/vml_settlement', { name: 'S-patch' });
    expect(created.status).toBeLessThan(300);
    const id = ((await created.json()) as any).record?.id ?? ((await created.clone().json()) as any).id;
    expect(id).toBeTruthy();

    const r = await apiIn('zh-CN', 'PATCH', `/data/vml_settlement/${id}`, { quota_hours: -1 });
    expect(r.status).toBe(400);
    expect(((await r.json()) as any).error).toBe('定额工时必须大于或等于 0');
  });

  /**
   * The issue's actual repro: a CSV/JSON import row report. Both the engine's
   * constraint messages and the importer's own cell-coercion messages land in
   * the same report, so both must speak the caller's language.
   */
  it('the import row report is localized — constraint AND cell coercion', async () => {
    const r = await apiIn('zh-CN', 'POST', '/data/vml_settlement/import', {
      format: 'json',
      runAutomations: false,
      rows: [
        { name: '越界行', penalty_amount: -1 },   // engine constraint
        { name: '烂单元格', quota_hours: 'abc' }, // importer coercion
        { name: '好行', penalty_amount: 10 },
      ],
    });
    expect(r.status).toBeLessThan(300);
    const body = (await r.json()) as any;
    const failed = body.results.filter((x: any) => !x.ok);
    expect(failed).toHaveLength(2);
    expect(failed[0].error).toBe('处罚金额必须大于或等于 0');
    expect(failed[1].error).toBe('定额工时:“abc”不是有效的数字');
    // The row report never shows an API column name.
    expect(JSON.stringify(failed)).not.toContain('penalty_amount:');
    expect(JSON.stringify(failed)).not.toContain('quota_hours:');
  });
});
