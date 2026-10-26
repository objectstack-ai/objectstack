/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `publishDraft()` names the bundle member it publishes — objectui#12402, the
 * publish half of objectui#12271.
 *
 * Since objectstack `038d4c958` the by-name publish door
 * (`POST /api/v1/meta/TYPE/NAME/publish`) reads `?member=`: one language of an
 * `email_template` is one member, and a publish that names none promotes the
 * CANONICAL member's draft. `GET /meta/_drafts` serves each draft's `member`
 * (`ListDraftsResponseSchema.drafts[].member`), and `publishDraft` had no way
 * to send it back.
 *
 * ## What is pinned
 *
 *   - given a member -> `?member=VALUE`, encoded as the by-name reads encode it;
 *   - no member      -> the parameter is ABSENT, never sent empty (the door
 *     refuses a blank selector, and any selector on a member-less type);
 *   - the two-argument call every existing caller makes sends exactly the URL
 *     it sent before this card.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient } from './metadata-client';

function record() {
  const seen: { url: string; method?: string }[] = [];
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method });
      return new Response(JSON.stringify({ success: true, version: 'sha256:0', seq: 1, message: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  });
  return { seen, client };
}

function queryOf(url: string): URLSearchParams {
  const q = url.indexOf('?');
  return new URLSearchParams(q === -1 ? '' : url.slice(q + 1));
}

describe('MetadataClient.publishDraft — the bundle member selector (objectui#12402)', () => {
  it('sends ?member=VALUE when the caller names a member', async () => {
    const { seen, client } = record();
    await client.publishDraft('email_template', 'welcome', { member: 'zh-CN' });

    expect(seen).toHaveLength(1);
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.url).toBe('http://localhost:3000/api/v1/meta/email_template/welcome/publish?member=zh-CN');
  });

  it('two members of one name publish to two different URLs', async () => {
    const { seen, client } = record();
    await client.publishDraft('email_template', 'welcome', { member: 'en-US' });
    await client.publishDraft('email_template', 'welcome', { member: 'zh-CN' });

    expect(seen.map((s) => queryOf(s.url).get('member'))).toEqual(['en-US', 'zh-CN']);
  });

  it('omits the parameter when there is no member: absent, not empty', async () => {
    for (const options of [undefined, {}, { member: '' }, { member: undefined }]) {
      const { seen, client } = record();
      await client.publishDraft('email_template', 'welcome', options);
      expect(seen[0]?.url).toBe('http://localhost:3000/api/v1/meta/email_template/welcome/publish');
      expect(queryOf(seen[0]!.url).has('member')).toBe(false);
    }
  });

  it('keeps the two-argument call byte for byte', async () => {
    const { seen, client } = record();
    await client.publishDraft('view', 'cases');
    expect(seen[0]?.url).toBe('http://localhost:3000/api/v1/meta/view/cases/publish');
  });

  it('encodes the member as a query value', async () => {
    const { seen, client } = record();
    await client.publishDraft('email_template', 'welcome', { member: 'x&y z' });
    expect(seen[0]?.url.endsWith('/publish?member=x%26y%20z')).toBe(true);
    expect(queryOf(seen[0]!.url).get('member')).toBe('x&y z');
  });
});
