// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5948] `getUiView` is the producer behind `GET /ui/view/:object/:type`
// (`packages/rest/src/rest-server.ts`, which does a bare `res.json(view)` —
// no envelope, no validation). Its declared response schema is
// `GetUiViewResponseSchema` (`packages/spec/src/api/protocol.zod.ts`), which
// resolves to `ViewSchema`.
//
// Until this fix the two shapes disagreed, and nothing in the repo could see
// it: `GetUiViewResponseSchema` had no runtime reader anywhere, so the body
// went out unchecked. Measured on `origin/main` before the change:
//
//   real list body -> RED  [unrecognized_keys] path=["list"] … `object`
//   real form body -> RED  [unrecognized_keys] path=["form"] … `object`, `label`
//
// `ListViewSchema` / `FormViewSchema` are `strictObject` and never declared
// `object`; the container (`ViewSchema`) is where `object` belongs and always
// declared it. `form.label` was `Edit ${…}` — a rendered UI string that no
// view schema declares at all.
//
// These tests are the standing guard on that agreement. They deliberately
// parse the output of the REAL `getUiView` call rather than a hand-built
// literal: a hand-written fixture would pin what this file believes the
// producer emits, which is exactly the belief that was wrong before. Feeding
// the production assembly path through the production schema is the only
// version of this test that can fail when the producer drifts.

import { describe, it, expect } from 'vitest';
import { GetUiViewResponseSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
  name: 'account',
  label: 'Account',
  fields: {
    id: { name: 'id', type: 'text' },
    name: { name: 'name', type: 'text', label: 'Name', required: true },
    status: { name: 'status', type: 'text', label: 'Status' },
    notes: { name: 'notes', type: 'textarea', label: 'Notes' },
    secret: { name: 'secret', type: 'text', hidden: true },
    created_at: { name: 'created_at', type: 'datetime' },
  },
};

function protocolFor(schema: unknown = SCHEMA) {
  const engine = { registry: { getObject: () => schema } };
  return new ObjectStackProtocolImplementation(engine as any);
}

/** Render zod issues into something a failure message can be read from. */
function explain(result: { success: boolean; error?: any }) {
  if (result.success) return 'GREEN';
  return result.error.issues
    .map((i: any) => `[${i.code}] path=${JSON.stringify(i.path)} ${i.message}`)
    .join('\n');
}

describe('[#5948] getUiView emits a body that satisfies its own declared schema', () => {
  it('list branch parses GREEN against GetUiViewResponseSchema', async () => {
    const p = protocolFor();
    const body = await p.getUiView({ object: 'account', type: 'list' });

    const parsed = GetUiViewResponseSchema.safeParse(body);
    expect(explain(parsed)).toBe('GREEN');
    expect(parsed.success).toBe(true);
  });

  it('form branch parses GREEN against GetUiViewResponseSchema', async () => {
    const p = protocolFor();
    const body = await p.getUiView({ object: 'account', type: 'form' });

    const parsed = GetUiViewResponseSchema.safeParse(body);
    expect(explain(parsed)).toBe('GREEN');
    expect(parsed.success).toBe(true);
  });

  // The three keys this issue removed, pinned by name. The GREEN assertions
  // above already fail if any of them comes back — `strictObject` rejects
  // them — but naming them here is what makes a future failure legible
  // instead of a bare "unrecognized_keys" the next reader has to decode.
  it('the object binding sits on the container, never on the view member', async () => {
    const p = protocolFor();

    const listBody: any = await p.getUiView({ object: 'account', type: 'list' });
    expect(listBody.object).toBe('account');
    expect(listBody.list).toBeDefined();
    expect(listBody.list).not.toHaveProperty('object');

    const formBody: any = await p.getUiView({ object: 'account', type: 'form' });
    expect(formBody.object).toBe('account');
    expect(formBody.form).toBeDefined();
    expect(formBody.form).not.toHaveProperty('object');
  });

  it('the form view carries no rendered `label` heading', async () => {
    const p = protocolFor();
    const formBody: any = await p.getUiView({ object: 'account', type: 'form' });
    // `Edit ${schema.label}` was a UI string living in a metadata body.
    // `FormViewSchema` declares no `label`; the heading is the UI's to compose.
    expect(formBody.form).not.toHaveProperty('label');
  });

  // Guards the half of the payload that did NOT move: `ListViewSchema` DOES
  // declare `label`, so the list view keeps its own. A future cleanup that
  // over-reaches and strips this one too would be caught here rather than
  // silently degrading the list header.
  it('the list view keeps its declared `label`', async () => {
    const p = protocolFor();
    const listBody: any = await p.getUiView({ object: 'account', type: 'list' });
    expect(listBody.list.label).toBe('Account');
  });

  // The producer builds `sort` only when the object has `created_at`. The
  // no-`created_at` branch emits `sort: undefined`, which is a different
  // parse path (optional vs present-but-undefined) and was never exercised.
  it('parses GREEN for an object with no created_at (sort omitted)', async () => {
    const p = protocolFor({
      name: 'tag',
      label: 'Tag',
      fields: { name: { name: 'name', type: 'text', label: 'Name' } },
    });

    const listBody = await p.getUiView({ object: 'tag', type: 'list' });
    const parsed = GetUiViewResponseSchema.safeParse(listBody);
    expect(explain(parsed)).toBe('GREEN');
  });
});
