// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#32905 — `history()` and `rollback()` name the holder of a
 * by-package name (ADR-0150 D3) as `?package=`, the spelling `layered()`
 * sends: the server numbers a name's versions across every holder, so a bare
 * read of a name two holders hold is refused 409, and `?package=` reads or
 * restores that one holder's versions. No `packageId`, no `package` key: a
 * name one holder holds is read exactly as before (CONTROL).
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient } from './metadata-client';

const BASE = 'http://localhost:3000/api/v1/meta';

function record() {
  const seen: { url: string; method: string; body?: string }[] = [];
  const client = new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body as string | undefined });
      const body = String(url).includes('/rollback')
        ? { success: true, version: 'v', seq: 5, restoredFromVersion: 1 }
        : { events: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch,
  });
  const door = (suffix: string) => seen.filter((s) => s.url.includes(`/${suffix}`));
  return { client, door };
}

function queryOf(url: string): URLSearchParams {
  const q = url.indexOf('?');
  return new URLSearchParams(q === -1 ? '' : url.slice(q + 1));
}

describe('MetadataClient — history and rollback name the holder (objectstack#32905)', () => {
  it('history() sends `?package=` beside the paging pair', async () => {
    const { client, door } = record();
    await client.history('flow', 'shared_flow', { limit: 100, sinceSeq: 2, packageId: 'com.acme.alpha.custom' });
    const [call] = door('history');
    expect(call?.url.startsWith(`${BASE}/flow/shared_flow/history?`)).toBe(true);
    expect(Object.fromEntries(queryOf(call!.url))).toEqual({ sinceSeq: '2', limit: '100', package: 'com.acme.alpha.custom' });
  });

  it('rollback() sends `?package=` on the URL, and the body stays `{ toVersion }`', async () => {
    const { client, door } = record();
    await client.rollback('flow', 'shared_flow', 3, { packageId: 'com.acme.alpha.custom' });
    const [call] = door('rollback');
    expect(call?.method).toBe('POST');
    expect(call?.url).toBe(`${BASE}/flow/shared_flow/rollback?package=com.acme.alpha.custom`);
    expect(JSON.parse(call!.body!)).toEqual({ toVersion: 3 });
  });

  it('CONTROL: no `packageId` sends no `package` key on either door', async () => {
    const { client, door } = record();
    await client.history('flow', 'solo_flow', { limit: 100 });
    await client.rollback('flow', 'solo_flow', 1);
    expect(door('history')[0]?.url).toBe(`${BASE}/flow/solo_flow/history?limit=100`);
    expect(door('rollback')[0]?.url).toBe(`${BASE}/flow/solo_flow/rollback`);
  });
});
