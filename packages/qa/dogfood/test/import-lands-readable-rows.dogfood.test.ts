// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Checklist item `records-forms.import-wizard-encoding-and-hints` (#26573):
// the server half of its api clause, at the door the wizard's end state is
// written through — `POST /api/v1/data/showcase_contact/import`, the route the
// console's `importRecords` forwards the parsed rows to verbatim — on the
// showcase as shipped.
//
//   acceptance[3], negative[1] — a completed import lands rows the API reads
//     back: the answer's `created` count equals the rows a filtered
//     `GET /data/showcase_contact` then finds for the import's marker, and every
//     CJK value (the strings a GBK file decodes to) re-reads byte-for-byte.
//     A success answer whose filtered read finds fewer rows is the silent drop
//     negative[1] names.
//
// The GBK decode itself (acceptance[0]) and the wizard's preview (negative[0])
// stay the objectui parser pins' and a browser leg: the console decodes the
// file client-side and sends strings, which is exactly what this file sends.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const CONTACT = 'showcase_contact';

describe('records-forms.import-wizard-encoding-and-hints — an import lands rows the API reads back', () => {
  let stack: VerifyStack;
  let token = '';

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('acceptance[3], negative[1]: the created count equals the filtered read, and the decoded values re-read intact', async () => {
    const marker = `iwe-${Math.random().toString(36).slice(2, 8)}`;
    const rows = [
      { name: '张伟', email: `${marker}-1@verify.test`, company: '北京数据科技有限公司', notes: `${marker} 第一行：中文备注` },
      { name: '李娜', email: `${marker}-2@verify.test`, company: '上海云端信息', notes: `${marker} 第二行，含全角标点！` },
      { name: '王芳', email: `${marker}-3@verify.test`, company: '深圳市创新工场', notes: `${marker} 第三行` },
    ];

    const res = await stack.apiAs(token, 'POST', `/data/${CONTACT}/import`, { format: 'json', rows });
    const answer: any = await res.json();
    expect(res.status, JSON.stringify(answer)).toBe(200);
    expect(answer).toMatchObject({ total: 3, ok: 3, errors: 0, created: 3 });

    const filter = encodeURIComponent(JSON.stringify([['email', 'contains', marker]]));
    const read = await stack.apiAs(token, 'GET', `/data/${CONTACT}?$filter=${filter}&$top=50`);
    expect(read.status).toBe(200);
    const body: any = await read.json();
    const found: any[] = body.records ?? body.data ?? body.value ?? body;
    expect(found, 'the filtered read finds every row the answer counted as created').toHaveLength(answer.created);

    const byEmail = new Map(found.map((r) => [r.email, r]));
    for (const row of rows) {
      expect(byEmail.get(row.email), row.email).toMatchObject(row);
    }
  });
});
