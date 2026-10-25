// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12725 — the per-key provenance of a pending draft (`draftChanges`,
 * objectstack#24298, written by objectstack#24395), read and written through
 * this package.
 *
 * The read: the strict draft read serves `draftChanges` beside `item`, one
 * `{ path, by, actor, at }` per changed key path. `governingDraftChange` is the
 * one reader of it: for a key, the entry with the LONGEST path that is the key
 * or one of its ancestors answers, because a draft save replaces every entry at
 * or under each path it changes. Absent means "not recorded", never `[]`.
 *
 * The write: `MetadataClient.save` sends `?surface=` exactly once, and only
 * when the caller states one; the HTTP doors refuse a repeated `?surface=` and
 * `copilot` (only an in-process tool may state it).
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient, type MetadataClientSaveOptions } from './metadata-client';
import {
  draftChangesUnder,
  governingDraftChange,
  readDraftChanges,
  type DraftChange,
} from './draft-envelope';

const AT = '2026-10-19T08:00:00.000Z';
const entry = (path: string[], by: DraftChange['by']): DraftChange => ({ path, by, actor: 'usr_1', at: AT });

describe('governingDraftChange — the longest prefix answers for a key (objectui#12725)', () => {
  const changes = [
    entry([], 'studio'),
    entry(['fields'], 'api'),
    entry(['fields', 'renewal_count'], 'copilot'),
    entry(['fields', 'renewal_count', 'label'], 'studio'),
  ];

  it('the deepest ancestor wins over every shallower one, the whole body included', () => {
    expect(governingDraftChange(changes, ['fields', 'renewal_count'])).toBe(changes[2]);
    expect(governingDraftChange(changes, ['fields', 'renewal_count', 'type'])).toBe(changes[2]);
    expect(governingDraftChange(changes, ['fields', 'renewal_count', 'label'])).toBe(changes[3]);
    expect(governingDraftChange(changes, ['fields', 'due_date'])).toBe(changes[1]);
  });

  it('`[]` is the whole body: it governs a key no deeper entry names', () => {
    expect(governingDraftChange(changes, ['label'])).toBe(changes[0]);
    expect(governingDraftChange([entry([], 'copilot')], ['kanban', 'columns'])).toEqual(entry([], 'copilot'));
  });

  it('an entry under the key does not govern it, and a sibling never does', () => {
    const under = [entry(['fields', 'renewal_count', 'label'], 'copilot')];
    expect(governingDraftChange(under, ['fields', 'renewal_count'])).toBeNull();
    expect(draftChangesUnder(under, ['fields', 'renewal_count'])).toEqual(under);
    expect(governingDraftChange([entry(['fields', 'renewal'], 'copilot')], ['fields', 'renewal_count'])).toBeNull();
  });

  it('segments compare whole, never as one dotted string', () => {
    const dotted = [entry(['fields', 'acme_loan.status'], 'copilot')];
    expect(governingDraftChange(dotted, ['fields', 'acme_loan', 'status'])).toBeNull();
    expect(governingDraftChange(dotted, ['fields', 'acme_loan.status'])).toBe(dotted[0]);
  });

  it('absent (`null`) answers none', () => {
    expect(governingDraftChange(null, ['fields', 'renewal_count'])).toBeNull();
    expect(draftChangesUnder(null, ['fields'])).toEqual([]);
  });
});

describe('readDraftChanges — absent is "not recorded", never `[]` (objectui#12725)', () => {
  it('reads the key beside `item` off the served envelope', () => {
    const changes = [entry(['kanban', 'columns'], 'copilot')];
    expect(readDraftChanges({ type: 'view', name: 'loan_board', item: {}, draftChanges: changes })).toEqual(changes);
  });

  it('a draft read that carries no `draftChanges` answers `null`, not an empty list', () => {
    expect(readDraftChanges({ type: 'view', name: 'loan_board', item: {} })).toBeNull();
    expect(readDraftChanges(null)).toBeNull();
  });
});

interface Sent {
  url: string;
  method: string;
}

function clientOver() {
  const sent: Sent[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), method: init?.method ?? 'GET' });
    return new Response(JSON.stringify({ success: true, version: 'v2', state: 'draft' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { client: new MetadataClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl }), sent };
}

describe('MetadataClient.save — the authoring surface, `?surface=` (objectui#12725)', () => {
  it('a stated surface is sent once, beside the draft mode', async () => {
    const { client, sent } = clientOver();
    await client.save('view', 'acme_loan.board', { name: 'acme_loan.board' }, { mode: 'draft', packageId: 'com.acme.app', surface: 'studio' });
    expect(sent).toHaveLength(1);
    const url = new URL(sent[0]!.url);
    expect(sent[0]!.method).toBe('PUT');
    expect(url.searchParams.getAll('surface')).toEqual(['studio']);
    expect(url.searchParams.get('mode')).toBe('draft');
  });

  it('control: a save that states none sends no `?surface=`, and the framework records it as `api`', async () => {
    const { client, sent } = clientOver();
    await client.save('view', 'acme_loan.board', { name: 'acme_loan.board' }, { mode: 'draft' });
    expect(new URL(sent[0]!.url).searchParams.has('surface')).toBe(false);
  });
});

// The HTTP doors refuse `?surface=copilot` 400: only an in-process tool states
// it. The option's type is the spec's set minus `copilot`, so it cannot be sent.
// @ts-expect-error -- `copilot` is not a surface this client may send.
export const copilotRefused: MetadataClientSaveOptions = { surface: 'copilot' };
