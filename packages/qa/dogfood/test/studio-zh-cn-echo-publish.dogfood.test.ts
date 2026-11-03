// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#29673] Studio in zh-CN: a new object whose body echoes the translated
// `/meta` read publishes, registers, and serves data — over the real showcase
// composition and through the REST doors the card measured.
//
// ## What was broken
//
// A `/meta` read in zh-CN serves every injected system column with its label
// translated through the built-in table (`queue` → `队列`, `owner_id` →
// `负责人`). Studio edits by GET → edit → PUT of the whole body, so the draft
// PUT carried those columns back with the translated labels. The write door
// stored them verbatim; no longer byte-identical to the platform's own
// definition, they were kept as the AUTHOR's fields. The registry refuses an
// author's `queue` on a user-owned object, the publish's registry write-through
// swallowed that refusal into a log line, and `publish-drafts` answered
// `outcome: 'published'` for an object whose data door then answered 404.
//
// ## What these cases pin
//
//  - the echo: a zh-CN draft PUT carrying the translated `queue` and `owner_id`
//    stores neither (the save door restores the source label, and the strip
//    that follows removes the platform's own columns), publishes, and serves
//    data; an `en` read of it is served `Owner` / `Queue`, not the Chinese.
//  - the control: the same body echoed from an `en` read.
//  - the publish answer: an object the registry would refuse (an author's own
//    `queue`) is refused at the save door — `422 INVALID_METADATA`, nothing
//    stored — so no publish can report it published. The publish door's own
//    refusal of such a draft stored before this rule is pinned in-process
//    (`packages/objectql/src/protocol-meta-effective-schema.test.ts`).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const PKG = 'app.zhecho29673';
const NS = 'zhecho';

describe('dogfood: a zh-CN Studio echo of the translated read publishes and serves data (#29673)', () => {
  let stack: VerifyStack;
  let token: string;

  const call = async (method: string, path: string, body?: unknown, locale?: string) => {
    const res = await stack.api(path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(locale ? { 'Accept-Language': locale } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const json: any = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };

  /** The object document a `/meta` read answers, wherever the envelope nests it. */
  const docOf = (json: any) => json?.data?.item ?? json?.item ?? json?.data ?? json;

  beforeAll(async () => {
    stack = await bootShowcase();
    token = await stack.signIn();
    const created = await call('POST', '/packages', {
      manifest: { id: PKG, name: 'zh-CN echo probe', version: '0.1.0', type: 'app', namespace: NS },
    });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  /** The injected columns as a read in `locale` serves them, off a showcase object. */
  const servedColumns = async (locale: string) => {
    const read = await call('GET', '/meta/object/showcase_task', undefined, locale);
    expect(read.status, JSON.stringify(read.json)).toBe(200);
    const fields = docOf(read.json)?.fields ?? {};
    expect(fields.queue, 'showcase_task is served the injected `queue`').toBeTruthy();
    return { queue: fields.queue, owner_id: fields.owner_id };
  };

  /** Save as a draft in `locale`, publish, and answer the publish receipt. */
  const saveAndPublish = async (name: string, fields: Record<string, unknown>, locale: string) => {
    const saved = await call(
      'PUT',
      `/meta/object/${name}?mode=draft&package=${PKG}`,
      { name, label: name, sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' }, ...fields } },
      locale,
    );
    expect(saved.status, JSON.stringify(saved.json)).toBe(200);
    const published = await call('POST', `/packages/${PKG}/publish-drafts`, {});
    expect(published.status, JSON.stringify(published.json)).toBe(200);
    return published.json?.data as { outcome?: string; failedCount?: number };
  };

  const expectServesData = async (name: string) => {
    const created = await call('POST', `/data/${name}`, { title: `row of ${name}` });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const listed = await call('GET', `/data/${name}`);
    expect(listed.status, JSON.stringify(listed.json)).toBe(200);
    expect(JSON.stringify(listed.json)).toContain(`row of ${name}`);
  };

  it('the read the card starts from: zh-CN serves the injected columns translated, en does not', async () => {
    const zh = await servedColumns('zh-CN');
    const en = await servedColumns('en');
    expect(zh.queue.label).toBe('队列');
    expect(zh.owner_id.label).toBe('负责人');
    expect(en.queue.label).toBe('Queue');
  });

  it('the card: a zh-CN echo of the translated columns publishes, stores neither column, and serves data', async () => {
    const zh = await servedColumns('zh-CN');
    const name = `${NS}_q_zh`;
    expect(await saveAndPublish(name, { queue: zh.queue, owner_id: zh.owner_id }, 'zh-CN')).toMatchObject({
      outcome: 'published',
      failedCount: 0,
    });
    await expectServesData(name);

    const layers = await call('GET', `/meta/object/${name}?layers=true`);
    expect(layers.status, JSON.stringify(layers.json)).toBe(200);
    const stored = JSON.stringify(docOf(layers.json)?.overlay ?? layers.json);
    expect(stored).toContain('"title"');
    expect(stored).not.toContain('队列');
    expect(stored).not.toContain('负责人');

    const en = docOf((await call('GET', `/meta/object/${name}`, undefined, 'en')).json);
    expect(en?.fields?.owner_id?.label).toBe('Owner');
    expect(en?.fields?.queue?.label).toBe('Queue');
  });

  it('control: the same body echoed from an en read publishes and serves data', async () => {
    const en = await servedColumns('en');
    const name = `${NS}_q_en`;
    expect(await saveAndPublish(name, { queue: en.queue, owner_id: en.owner_id }, 'en')).toMatchObject({
      outcome: 'published',
      failedCount: 0,
    });
    await expectServesData(name);
  });

  it('an object the registry would refuse (an author `queue`) is refused at the save door, so no publish reports it published', async () => {
    const name = `${NS}_q_own`;
    const saved = await call('PUT', `/meta/object/${name}?mode=draft&package=${PKG}`, {
      name,
      label: name,
      sharingModel: 'private',
      fields: { title: { type: 'text', label: 'Title' }, queue: { type: 'text', label: 'Support Queue' } },
    });
    expect(saved.status, JSON.stringify(saved.json)).toBe(422);
    expect(JSON.stringify(saved.json)).toContain('INVALID_METADATA');
    expect(JSON.stringify(saved.json)).toContain('declares a field named `queue`');

    const drafts = await call('GET', `/meta/_drafts?packageId=${PKG}`);
    expect(drafts.status, JSON.stringify(drafts.json)).toBe(200);
    expect(JSON.stringify(drafts.json)).not.toContain(name);
  });
});
