/**
 * objectui#11908 — `createOrganization` carries the creator's zone on the
 * QUERY of `POST /organization/create`, never in the body.
 *
 * The wire shape is the server's (triage's unlock on the card): the create
 * route reads `?timezone=IANA_ZONE` and its body stays `{ name, slug }`. The
 * console's two creation call sites mock `useAuth`, so their pins see only the
 * argument object; this file is the link that sees the request. It drives the
 * REAL better-auth client through a stubbed `fetch`, the same way
 * `createAuthClient.test.ts` and `org-error-code-4474.test.ts` next door do,
 * and asserts the URL's query and the body's exact keys as they leave.
 */

import { describe, it, expect, vi } from 'vitest';
import { createAuthClient } from '../createAuthClient';

interface Sent {
  url: URL;
  method: string;
  body: Record<string, unknown>;
}

/** A fetch that answers `/organization/create` and records what was sent. */
function recordingFetch() {
  const sent: Sent[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
    sent.push({ url: new URL(raw), method: init?.method ?? 'GET', body });
    return new Response(JSON.stringify({ id: 'org_new', name: body.name, slug: body.slug }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const client = createAuthClient({
    baseURL: 'http://localhost/api/v1/auth',
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  const createCalls = () => sent.filter((s) => s.url.pathname.endsWith('/organization/create'));
  return { client, createCalls };
}

describe('createOrganization sends the zone as a query parameter (objectui#11908)', () => {
  it('a zone → POST /organization/create?timezone=Asia%2FShanghai, body exactly { name, slug }', async () => {
    const { client, createCalls } = recordingFetch();

    const org = await client.createOrganization({ name: 'Acme', slug: 'acme', timezone: 'Asia/Shanghai' });

    expect(org.id).toBe('org_new');
    const calls = createCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/api/v1/auth/organization/create');
    expect(calls[0].url.search).toBe('?timezone=Asia%2FShanghai');
    expect(calls[0].url.searchParams.get('timezone')).toBe('Asia/Shanghai');
    expect(Object.keys(calls[0].body).sort()).toEqual(['name', 'slug']);
    expect(calls[0].body).toEqual({ name: 'Acme', slug: 'acme' });
  });

  it('a logo still rides the body; the zone still rides the query only', async () => {
    const { client, createCalls } = recordingFetch();

    await client.createOrganization({ name: 'Acme', slug: 'acme', logo: 'https://x.test/l.png', timezone: 'Europe/Paris' });

    const [call] = createCalls();
    expect(call.url.searchParams.get('timezone')).toBe('Europe/Paris');
    expect(Object.keys(call.body).sort()).toEqual(['logo', 'name', 'slug']);
  });

  it.each([
    ['omitted', undefined],
    ['empty', ''],
  ] as const)('control: a zone %s → no timezone parameter at all, body exactly { name, slug }', async (_label, timezone) => {
    const { client, createCalls } = recordingFetch();

    await client.createOrganization(
      timezone === undefined ? { name: 'Acme', slug: 'acme' } : { name: 'Acme', slug: 'acme', timezone },
    );

    const calls = createCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].url.search).toBe('');
    expect(calls[0].url.searchParams.has('timezone')).toBe(false);
    expect(Object.keys(calls[0].body).sort()).toEqual(['name', 'slug']);
  });
});
