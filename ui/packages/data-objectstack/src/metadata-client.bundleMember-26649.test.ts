/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26649 — the editor's by-name doors name the bundle member they
 * address.
 *
 * Setup's metadata editor opens one member of an `email_template` (one
 * language) by `?member=`. The doors it reads and writes through take the same
 * selector: the item read (`state=draft` included), the layered read since
 * objectstack#26699, the publish and the delete (ruling 6116165299). A call
 * that names none addresses the CANONICAL member, so each method has to carry
 * the member or the editor reads one language and writes another.
 *
 * ## What is pinned, per method
 *
 *   - given a member -> `?member=VALUE`, beside `?package=` when both are named;
 *   - no member      -> the parameter is ABSENT, never sent empty (the door
 *     refuses a blank selector, and any selector on a member-less type);
 *   - `getDraft` asks the ledger first, and a ledger row of the same name that
 *     is ANOTHER member's draft is no reason to send the draft read.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient } from './metadata-client';

const BASE = 'http://localhost:3000/api/v1/meta';

function record(drafts: Array<Record<string, unknown>> = []) {
  const seen: { url: string; method: string }[] = [];
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      seen.push({ url, method });
      const body = String(url).includes('/_drafts')
        ? { drafts }
        : String(url).includes('/layers')
          ? { code: null, overlay: null, overlayScope: null, effective: { name: 'welcome' } }
          : { type: 'email_template', name: 'welcome', item: { name: 'welcome' }, success: true };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch,
  });
  return { seen, client };
}

function queryOf(url: string): URLSearchParams {
  const q = url.indexOf('?');
  return new URLSearchParams(q === -1 ? '' : url.slice(q + 1));
}

/** The requests that were not the drafts-ledger read. */
const doorCalls = (seen: { url: string; method: string }[]) => seen.filter((s) => !s.url.includes('/_drafts'));

describe('MetadataClient — the bundle member on the editor\'s by-name doors (objectstack#26649)', () => {
  it('layered() reads one member\'s layers: ?member=, beside ?package=', async () => {
    const { seen, client } = record();
    await client.layered('email_template', 'welcome', { member: 'zh-CN' });
    await client.layered('email_template', 'welcome', { packageId: 'com.acme', member: 'zh-CN' });

    expect(seen.map((s) => s.url)).toEqual([
      `${BASE}/email_template/welcome/layers?member=zh-CN`,
      `${BASE}/email_template/welcome/layers?package=com.acme&member=zh-CN`,
    ]);
  });

  it('get() reads one member: ?member=', async () => {
    const { seen, client } = record();
    await client.get('email_template', 'welcome', { member: 'zh-CN' });

    expect(seen[0]?.url).toBe(`${BASE}/email_template/welcome?member=zh-CN`);
  });

  it('getDraft() reads one member\'s draft when the ledger lists that member', async () => {
    const { seen, client } = record([
      { type: 'email_template', name: 'welcome', member: 'en-US' },
      { type: 'email_template', name: 'welcome', member: 'zh-CN' },
    ]);
    await client.getDraft('email_template', 'welcome', { member: 'zh-CN' });

    const reads = doorCalls(seen);
    expect(reads).toHaveLength(1);
    expect(queryOf(reads[0]!.url).get('state')).toBe('draft');
    expect(queryOf(reads[0]!.url).get('member')).toBe('zh-CN');
  });

  it('getDraft() sends no draft read when the ledger\'s row of that name is another member\'s', async () => {
    const { seen, client } = record([{ type: 'email_template', name: 'welcome', member: 'en-US' }]);
    await expect(client.getDraft('email_template', 'welcome', { member: 'zh-CN' })).resolves.toBeNull();

    expect(doorCalls(seen)).toHaveLength(0);
  });

  it('CONTROL: getDraft() with no member still reads on a same-name row of any member', async () => {
    const { seen, client } = record([{ type: 'email_template', name: 'welcome', member: 'zh-CN' }]);
    await client.getDraft('email_template', 'welcome');

    const reads = doorCalls(seen);
    expect(reads).toHaveLength(1);
    expect(queryOf(reads[0]!.url).has('member')).toBe(false);
  });

  it('publish() promotes one member\'s draft: ?member=, beside ?package=', async () => {
    const { seen, client } = record();
    await client.publish('email_template', 'welcome', { packageId: 'com.acme', member: 'zh-CN' });

    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.url).toBe(`${BASE}/email_template/welcome/publish?package=com.acme&member=zh-CN`);
  });

  it('reset() removes one member\'s row, active and draft: ?member=', async () => {
    const { seen, client } = record();
    await client.reset('email_template', 'welcome', { member: 'zh-CN' });
    await client.reset('email_template', 'welcome', { state: 'draft', member: 'zh-CN' });

    expect(seen.map((s) => [s.method, s.url])).toEqual([
      ['DELETE', `${BASE}/email_template/welcome?member=zh-CN`],
      ['DELETE', `${BASE}/email_template/welcome?state=draft&member=zh-CN`],
    ]);
  });

  it('omits the parameter on every door when there is no member: absent, not empty', async () => {
    for (const member of [undefined, '']) {
      const { seen, client } = record([{ type: 'email_template', name: 'welcome' }]);
      await client.layered('email_template', 'welcome', { member });
      await client.get('email_template', 'welcome', { member });
      await client.getDraft('email_template', 'welcome', { member });
      await client.publish('email_template', 'welcome', { member });
      await client.reset('email_template', 'welcome', { member });

      const calls = doorCalls(seen);
      expect(calls).toHaveLength(5);
      for (const call of calls) expect(queryOf(call.url).has('member')).toBe(false);
    }
  });
});
