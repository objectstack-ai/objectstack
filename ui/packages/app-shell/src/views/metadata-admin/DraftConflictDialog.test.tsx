// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11773 — the draft-save version guard, against a door double that
 * answers the way the `/meta` door of the published `@objectstack/*`
 * 18.0.0-next.0 server was MEASURED to answer (the readings are on the pull
 * request):
 *
 *  - a `?mode=draft` save returns `{ success, version, seq, state, message }`;
 *    `version` is the token, keyed (`hmac-sha256:…`);
 *  - the draft read (`GET …?state=draft&package=P`) serves `version`, the token
 *    of the draft at THAT address (`null` when that address holds none — a
 *    read naming no package of a package-bound draft serves `null`), and
 *    answers `404 NO_DRAFT` with no draft at all;
 *  - an `If-Match` that is not the current draft's token, or `If-None-Match: *`
 *    while a draft exists, is `409 { error, code: 'METADATA_CONFLICT',
 *    currentVersion }` (`currentVersion: null` with no draft row); the two
 *    headers together are `400`;
 *  - a destructive change is `409 { error, code: 'DESTRUCTIVE_CHANGE', issues }`
 *    unless `?force=true`, judged BEFORE the version.
 *
 * The client is the REAL `MetadataClient`, so the headers on the wire and the
 * parsed refusal are production's, not a hand-built error object.
 */

import { describe, it, expect, vi } from 'vitest';
import { MetadataClient } from '@object-ui/data-objectstack';
import {
  DraftVersionGuard,
  draftPinOf,
  isDraftVersionConflict,
  readDraftForSave,
  type DraftConflictChoice,
} from './DraftConflictDialog';

interface SentPut {
  type: string;
  name: string;
  draft: boolean;
  force: boolean;
  ifMatch: string | null;
  ifNoneMatch: string | null;
  body: Record<string, unknown>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const v = (seq: number) => `hmac-sha256:${seq.toString(16).padStart(64, '0')}`;

/** The measured draft door, over `fetch`. */
function measuredDoor(options: { conflictCarriesCurrentVersion?: boolean } = {}) {
  const carriesCurrent = options.conflictCarriesCurrentVersion ?? true;
  const rows = new Map<string, { body: Record<string, unknown>; version: string }>();
  const puts: SentPut[] = [];
  const reads: string[] = [];
  let seq = 0;
  const rowKey = (type: string, name: string, pkg: string | null, draft: boolean) =>
    `${draft ? 'draft' : 'active'}:${type}/${name}@${pkg ?? ''}`;
  const write = (key: string, body: Record<string, unknown>) => {
    seq += 1;
    const version = v(seq);
    rows.set(key, { body, version });
    return version;
  };
  const conflict = (type: string, name: string, head: string | null) =>
    json(409, {
      error: `${type}/${name} has been modified since you loaded it. Expected parent null but current is ${head}.`,
      code: 'METADATA_CONFLICT',
      ...(carriesCurrent ? { currentVersion: head } : {}),
    });
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const [, , , , type = '', name = ''] = url.pathname.split('/').map(decodeURIComponent);
    const pkg = url.searchParams.get('package');
    if ((init?.method ?? 'GET') === 'GET') {
      reads.push(`${url.pathname}?${url.searchParams.toString()}`);
      if (type === '_drafts') {
        const drafts = [...rows.keys()].filter((k) => k.startsWith('draft:')).map((k) => {
          const [t, rest] = k.slice('draft:'.length).split('/');
          return { type: t, name: rest!.split('@')[0] };
        });
        return json(200, { drafts });
      }
      if (url.searchParams.get('state') !== 'draft') return json(404, { error: 'not modelled' });
      const own = rows.get(rowKey(type, name, pkg, true));
      // Content falls back to any package's draft; the version is the address's.
      const served = own ?? [...rows.entries()].find(([k]) => k.startsWith(`draft:${type}/${name}@`))?.[1];
      if (!served) return json(404, { error: `No pending draft exists for ${type}/${name}.`, code: 'NO_DRAFT' });
      return json(200, { type, name, item: served.body, version: own ? own.version : null });
    }
    if (init?.method !== 'PUT') return json(404, { error: 'not modelled' });
    const draft = url.searchParams.get('mode') === 'draft';
    const force = url.searchParams.get('force') === 'true';
    const headers = new Headers(init.headers);
    const ifMatch = headers.get('If-Match');
    const ifNoneMatch = headers.get('If-None-Match');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    puts.push({ type, name, draft, force, ifMatch, ifNoneMatch, body });
    if (ifMatch !== null && ifNoneMatch !== null) {
      return json(400, { error: { code: 'VALIDATION_ERROR', message: 'Send If-Match or If-None-Match, not both.' } });
    }
    if (body.dropsAField && !force) {
      return json(409, {
        error: `${type}/${name} would drop or transform existing data: Field 'subject' removed. — re-submit with ?force=true to proceed.`,
        code: 'DESTRUCTIVE_CHANGE',
        issues: [{ code: 'field_removed', field: 'subject', message: "Field 'subject' removed." }],
      });
    }
    const key = rowKey(type, name, pkg, draft);
    const head = rows.get(key)?.version ?? null;
    if (ifMatch !== null && (head === null || ifMatch.replace(/^"|"$/g, '') !== head)) return conflict(type, name, head);
    if (ifNoneMatch !== null && head !== null) return conflict(type, name, head);
    const version = write(key, body);
    return json(200, {
      success: true,
      version,
      seq,
      state: draft ? 'draft' : 'active',
      message: `Saved ${type} '${name}' [seq=${seq}]`,
    });
  }) as typeof fetch;
  return {
    client: new MetadataClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl }),
    puts,
    reads,
    /** Another editor's save of the same draft row, outside this guard. */
    savedElsewhere(type: string, name: string, pkg: string, body: Record<string, unknown>) {
      return write(rowKey(type, name, pkg, true), body);
    },
    draftBody(type: string, name: string, pkg: string) {
      return rows.get(rowKey(type, name, pkg, true))?.body;
    },
    /** A publish promotes the draft row and drops it (`currentVersion: null` after). */
    publishDraft(type: string, name: string, pkg: string) {
      const key = rowKey(type, name, pkg, true);
      const row = rows.get(key);
      if (row) write(rowKey(type, name, pkg, false), row.body);
      rows.delete(key);
    },
  };
}

function guardOver(door: ReturnType<typeof measuredDoor>, ...answers: DraftConflictChoice[]) {
  const queue = answers.length ? [...answers] : ['cancel' as const];
  const ask = vi.fn(async () => (queue.length > 1 ? queue.shift()! : queue[0]!));
  const reload = vi.fn();
  const guard = new DraftVersionGuard({
    client: () => door.client,
    ask,
    reload,
    notSaved: (c) => new Error(`not saved: ${c.type}/${c.name}`),
  });
  return { guard, ask, reload };
}

const PKG = 'com.acme.app';
const DRAFT = { mode: 'draft' as const, packageId: PKG };

/** One editor's load: the draft read at the save's address, recorded where the buffer is installed. */
async function load(door: ReturnType<typeof measuredDoor>, guard: DraftVersionGuard, name = 'acme_task') {
  const read = await readDraftForSave(door.client, 'object', name, PKG);
  guard.recordRead('object', name, PKG, read.pin);
  return read;
}

describe('DraftVersionGuard — the first save after a load is pinned to the read (objectui#11773)', () => {
  it('a load of an item with a pending draft pins the first save to the version the read served', async () => {
    const door = measuredDoor();
    door.savedElsewhere('object', 'acme_task', PKG, { label: 'saved earlier' });
    const { guard, ask } = guardOver(door);
    await load(door, guard);
    expect(await guard.save('object', 'acme_task', { label: 'A' }, DRAFT)).toBe('saved');
    expect(door.puts.map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([[v(1), null]]);
    expect(ask).not.toHaveBeenCalled();
    // The draft read named the package the save writes.
    expect(door.reads.some((r) => r.includes('state=draft') && r.includes(`package=${PKG}`))).toBe(true);
  });

  it('a load with no pending draft pins the first save to "no draft row" (If-None-Match: *)', async () => {
    const door = measuredDoor();
    const { guard } = guardOver(door);
    await load(door, guard);
    expect(await guard.save('object', 'acme_task', { label: 'A' }, DRAFT)).toBe('saved');
    await guard.save('object', 'acme_task', { label: 'B' }, DRAFT);
    expect(door.puts.map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([
      [null, '*'],
      [v(1), null],
    ]);
  });

  it('two editors who each load and save once: the second save is refused, and the first editor\'s field survives', async () => {
    const door = measuredDoor();
    const a = guardOver(door, 'cancel');
    const b = guardOver(door, 'cancel');
    await load(door, a.guard);
    await load(door, b.guard);
    expect(await a.guard.save('object', 'acme_task', { label: 'A', pluralLabel: 'Tasks (A2)' }, DRAFT)).toBe('saved');
    await expect(b.guard.save('object', 'acme_task', { label: 'A', description: 'B' }, DRAFT)).rejects.toThrow(
      'not saved: object/acme_task',
    );
    expect(b.ask).toHaveBeenCalledWith({ type: 'object', name: 'acme_task' });
    expect(door.draftBody('object', 'acme_task', PKG)).toEqual({ label: 'A', pluralLabel: 'Tasks (A2)' });
  });

  it('the same race with both drafts pending at load: the second save is refused on the read\'s version', async () => {
    const door = measuredDoor();
    door.savedElsewhere('object', 'acme_task', PKG, { label: 'base' });
    const a = guardOver(door, 'cancel');
    const b = guardOver(door, 'cancel');
    await load(door, a.guard);
    await load(door, b.guard);
    await a.guard.save('object', 'acme_task', { label: 'A' }, DRAFT);
    await expect(b.guard.save('object', 'acme_task', { label: 'B' }, DRAFT)).rejects.toThrow('not saved');
    expect(door.puts.map((p) => p.ifMatch)).toEqual([v(1), v(1)]);
    expect(door.draftBody('object', 'acme_task', PKG)).toEqual({ label: 'A' });
  });

  it('a read that failed pins nothing: the save goes unpinned, as before', async () => {
    const door = measuredDoor();
    const { guard } = guardOver(door);
    const failing = { getDraft: vi.fn(async () => Promise.reject(new Error('network down'))) };
    const read = await readDraftForSave(failing, 'object', 'acme_task', PKG);
    expect(read).toEqual({ answer: null, pin: null });
    guard.recordRead('object', 'acme_task', PKG, read.pin);
    await guard.save('object', 'acme_task', { label: 'A' }, DRAFT);
    expect(door.puts.map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([[null, null]]);
  });

  it('a pin belongs to its address: a read recorded for another package pins nothing here', async () => {
    const door = measuredDoor();
    const { guard } = guardOver(door);
    guard.recordRead('object', 'acme_task', 'com.acme.other', { ifNoneMatch: '*' });
    await guard.save('object', 'acme_task', { label: 'A' }, DRAFT);
    expect(door.puts[0]!.ifNoneMatch).toBeNull();
  });

  it('a pin the caller carried is replaced by the held one: the two headers never leave together', async () => {
    const door = measuredDoor();
    const { guard } = guardOver(door);
    await load(door, guard);
    expect(await guard.save('object', 'acme_task', { label: 'A' }, { ...DRAFT, ifMatch: 'hmac-sha256:stray' })).toBe(
      'saved',
    );
    expect(door.puts.map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([[null, '*']]);
  });
});

describe('draftPinOf — what one draft read says (objectui#11773)', () => {
  it('reads the version through the spec\'s member: a token, a served null, no draft, a server without the member', () => {
    expect(draftPinOf({ type: 'object', name: 'x', item: {}, version: v(7) })).toEqual({ ifMatch: v(7) });
    expect(draftPinOf({ type: 'object', name: 'x', item: {}, version: null })).toEqual({ ifNoneMatch: '*' });
    expect(draftPinOf(null)).toEqual({ ifNoneMatch: '*' });
    // A server from before the read served a version (17.x): nothing to pin.
    expect(draftPinOf({ type: 'object', name: 'x', item: {} })).toBeNull();
    // Not a token by the spec's own schema: nothing to pin.
    expect(draftPinOf({ type: 'object', name: 'x', item: {}, version: 7 })).toBeNull();
  });

  it('a read that names no package of a package-bound draft serves null — which is why loads read at the save\'s package', async () => {
    const door = measuredDoor();
    door.savedElsewhere('object', 'acme_task', PKG, { label: 'draft in the package' });
    const packageless = await door.client.getDraft<{ version?: unknown }>('object', 'acme_task');
    expect(packageless?.version).toBeNull();
    const atSave = await readDraftForSave(door.client, 'object', 'acme_task', PKG);
    expect(atSave.pin).toEqual({ ifMatch: v(1) });
  });
});

describe('DraftVersionGuard — each draft save sends the version the last one received (objectui#11773)', () => {
  it('with nothing recorded, a first save sends no pin; every later save sends the previous receipt\'s version', async () => {
    const door = measuredDoor();
    const { guard, ask } = guardOver(door);
    expect(await guard.save('object', 'acme_task', { label: 'A' }, DRAFT)).toBe('saved');
    expect(await guard.save('object', 'acme_task', { label: 'B' }, DRAFT)).toBe('saved');
    expect(await guard.save('object', 'acme_task', { label: 'C' }, DRAFT)).toBe('saved');
    expect(door.puts.map((p) => p.ifMatch)).toEqual([null, v(1), v(2)]);
    expect(ask).not.toHaveBeenCalled();
  });

  it('saves sent back to back go one at a time, so the second never conflicts with the first', async () => {
    const door = measuredDoor();
    const { guard, ask } = guardOver(door);
    await load(door, guard);
    await guard.save('object', 'acme_task', { label: 'A' }, DRAFT);
    // An autosave and an explicit save (a column reorder) fired together.
    const [a, b] = await Promise.all([
      guard.save('object', 'acme_task', { label: 'B' }, DRAFT),
      guard.save('object', 'acme_task', { label: 'C' }, DRAFT),
    ]);
    expect([a, b]).toEqual(['saved', 'saved']);
    expect(ask).not.toHaveBeenCalled();
    expect(door.puts[2]!.ifMatch).toBe(v(2));
    expect(door.draftBody('object', 'acme_task', PKG)).toEqual({ label: 'C' });
  });

  it('forget(): a buffer installed with no draft read behind it holds no pin, so its next save is unpinned', async () => {
    const door = measuredDoor();
    const { guard } = guardOver(door);
    await guard.save('object', 'acme_task', { label: 'A' }, DRAFT);
    guard.forget();
    await guard.save('object', 'acme_task', { label: 'B' }, DRAFT);
    expect(door.puts.map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([
      [null, null],
      [null, null],
    ]);
  });

  it('a pin belongs to one item: a save of another item (or package) sends none, and each item keeps its own', async () => {
    const door = measuredDoor();
    const { guard } = guardOver(door);
    await guard.save('object', 'acme_task', { label: 'A' }, DRAFT);
    await guard.save('object', 'acme_note', { label: 'N' }, DRAFT);
    await guard.save('object', 'acme_task', { label: 'B' }, { mode: 'draft', packageId: 'com.acme.other' });
    await guard.save('object', 'acme_task', { label: 'C' }, DRAFT);
    expect(door.puts.map((p) => p.ifMatch)).toEqual([null, null, null, v(1)]);
  });

  it('a non-draft save passes straight through, unpinned and unrecorded', async () => {
    const door = measuredDoor();
    const { guard } = guardOver(door);
    await guard.save('permission', 'sales', { a: 1 }, {});
    await guard.save('permission', 'sales', { a: 2 }, {});
    expect(door.puts.map((p) => [p.draft, p.ifMatch, p.ifNoneMatch])).toEqual([
      [false, null, null],
      [false, null, null],
    ]);
  });
});

describe('DraftVersionGuard — a draft saved elsewhere is not overwritten in silence (objectui#11773)', () => {
  it('the stale save is refused, nothing else is sent, and "reload" hands the buffer back to the caller', async () => {
    const door = measuredDoor();
    const { guard, ask, reload } = guardOver(door, 'reload');
    await guard.save('object', 'acme_task', { label: 'mine' }, DRAFT);
    door.savedElsewhere('object', 'acme_task', PKG, { label: 'mine', description: 'theirs' });

    expect(await guard.save('object', 'acme_task', { label: 'mine, again' }, DRAFT)).toBe('reloaded');
    expect(ask).toHaveBeenCalledWith({ type: 'object', name: 'acme_task' });
    expect(reload).toHaveBeenCalledTimes(1);
    // Their field survives: the refused body was never written.
    expect(door.draftBody('object', 'acme_task', PKG)).toEqual({ label: 'mine', description: 'theirs' });
    expect(door.puts).toHaveLength(2);

    // The caller's reload re-reads the draft: the next save is pinned to THEIR version.
    await load(door, guard);
    await guard.save('object', 'acme_task', { label: 'mine', description: 'theirs', icon: 'x' }, DRAFT);
    expect(door.puts[2]!.ifMatch).toBe(v(2));
  });

  it('a save queued behind the refused one carries the replaced buffer and is dropped on "reload"', async () => {
    const door = measuredDoor();
    const { guard } = guardOver(door, 'reload');
    await guard.save('object', 'acme_task', { label: 'mine' }, DRAFT);
    door.savedElsewhere('object', 'acme_task', PKG, { label: 'theirs' });
    const [first, queued] = await Promise.all([
      guard.save('object', 'acme_task', { label: 'stale 1' }, DRAFT),
      guard.save('object', 'acme_task', { label: 'stale 2' }, DRAFT),
    ]);
    expect([first, queued]).toEqual(['reloaded', 'reloaded']);
    expect(door.puts).toHaveLength(2);
    expect(door.draftBody('object', 'acme_task', PKG)).toEqual({ label: 'theirs' });
  });

  it('"overwrite" re-sends the same body pinned to the refusal\'s currentVersion, wins, and pins the next save to its receipt', async () => {
    const door = measuredDoor();
    const { guard } = guardOver(door, 'overwrite');
    await guard.save('object', 'acme_task', { label: 'mine' }, DRAFT);
    const theirs = door.savedElsewhere('object', 'acme_task', PKG, { label: 'theirs' });

    expect(await guard.save('object', 'acme_task', { label: 'mine, kept' }, DRAFT)).toBe('saved');
    expect(door.puts.slice(1).map((p) => [p.ifMatch, p.body])).toEqual([
      [v(1), { label: 'mine, kept' }],
      [theirs, { label: 'mine, kept' }],
    ]);
    expect(door.draftBody('object', 'acme_task', PKG)).toEqual({ label: 'mine, kept' });

    await guard.save('object', 'acme_task', { label: 'next' }, DRAFT);
    // seq 1 mine, seq 2 theirs, seq 3 the overwrite.
    expect(door.puts[3]!.ifMatch).toBe(v(3));
  });

  it('"overwrite" of a draft that a publish drained re-sends with If-None-Match: * (currentVersion null)', async () => {
    const door = measuredDoor();
    const { guard } = guardOver(door, 'overwrite');
    await guard.save('object', 'acme_task', { label: 'mine' }, DRAFT);
    door.publishDraft('object', 'acme_task', PKG);

    expect(await guard.save('object', 'acme_task', { label: 'after publish' }, DRAFT)).toBe('saved');
    expect(door.puts.slice(1).map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([
      [v(1), null],
      [null, '*'],
    ]);
  });

  it('a save landing between the refusal and the confirmed overwrite is refused again and asked about, never overwritten', async () => {
    const door = measuredDoor();
    const { guard, ask } = guardOver(door, 'cancel');
    await guard.save('object', 'acme_task', { label: 'mine' }, DRAFT);
    door.savedElsewhere('object', 'acme_task', PKG, { label: 'theirs' });
    // The third editor saves while the first one's dialog is open; the author
    // overwrites, is asked again about the third save, and keeps editing.
    ask.mockImplementationOnce(async () => {
      door.savedElsewhere('object', 'acme_task', PKG, { label: 'a third editor' });
      return 'overwrite';
    });

    await expect(guard.save('object', 'acme_task', { label: 'mine, kept' }, DRAFT)).rejects.toThrow('not saved');
    expect(ask).toHaveBeenCalledTimes(2);
    expect(door.draftBody('object', 'acme_task', PKG)).toEqual({ label: 'a third editor' });
    expect(door.puts.slice(1).map((p) => p.ifMatch)).toEqual([v(1), v(2)]);
  });

  it('control: a refusal without currentVersion (a server before the field) overwrites unpinned, as it always did', async () => {
    const door = measuredDoor({ conflictCarriesCurrentVersion: false });
    const { guard } = guardOver(door, 'overwrite');
    await guard.save('object', 'acme_task', { label: 'mine' }, DRAFT);
    door.savedElsewhere('object', 'acme_task', PKG, { label: 'theirs' });
    expect(await guard.save('object', 'acme_task', { label: 'mine, kept' }, DRAFT)).toBe('saved');
    expect(door.puts.slice(1).map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([
      [v(1), null],
      [null, null],
    ]);
  });

  it('"keep editing" sends nothing, rejects, and keeps the stale pin so the next save is refused again', async () => {
    const door = measuredDoor();
    const { guard, ask } = guardOver(door, 'cancel');
    await guard.save('object', 'acme_task', { label: 'mine' }, DRAFT);
    door.savedElsewhere('object', 'acme_task', PKG, { label: 'theirs' });

    await expect(guard.save('object', 'acme_task', { label: 'stale' }, DRAFT)).rejects.toThrow(
      'not saved: object/acme_task',
    );
    await expect(guard.save('object', 'acme_task', { label: 'still stale' }, DRAFT)).rejects.toThrow(
      'not saved: object/acme_task',
    );
    expect(ask).toHaveBeenCalledTimes(2);
    expect(door.puts.slice(1).every((p) => p.ifMatch === v(1))).toBe(true);
    expect(door.draftBody('object', 'acme_task', PKG)).toEqual({ label: 'theirs' });
  });

  it('once a publish dropped the draft, a held version is refused — and the publish\'s re-read pins "no draft row" instead', async () => {
    const door = measuredDoor();
    const { guard, ask } = guardOver(door, 'cancel');
    await guard.save('object', 'acme_task', { label: 'mine' }, DRAFT);
    door.publishDraft('object', 'acme_task', PKG);

    await expect(guard.save('object', 'acme_task', { label: 'after publish' }, DRAFT)).rejects.toThrow('not saved');
    expect(ask).toHaveBeenCalledTimes(1);
    // What every editor does when the publish reload installs the buffer.
    await load(door, guard);
    expect(await guard.save('object', 'acme_task', { label: 'after publish' }, DRAFT)).toBe('saved');
    expect(door.puts.map((p) => [p.ifMatch, p.ifNoneMatch])).toEqual([
      [null, null],
      [v(1), null],
      [null, '*'],
    ]);
  });
});

describe('DraftVersionGuard — the door\'s two 409s stay apart (objectui#11773)', () => {
  it('DESTRUCTIVE_CHANGE passes through untouched, and the forced retry carries the same pin', async () => {
    const door = measuredDoor();
    const { guard, ask } = guardOver(door, 'overwrite');
    await guard.save('object', 'acme_task', { label: 'mine' }, DRAFT);

    const refusal = await guard
      .save('object', 'acme_task', { label: 'mine', dropsAField: true }, DRAFT)
      .catch((e: unknown) => e);
    expect(refusal).toMatchObject({ status: 409, code: 'DESTRUCTIVE_CHANGE' });
    expect(isDraftVersionConflict(refusal)).toBe(false);
    expect(ask).not.toHaveBeenCalled();

    // The caller's own confirmation flow re-sends with `force`.
    expect(await guard.save('object', 'acme_task', { label: 'mine', dropsAField: true }, { ...DRAFT, force: true })).toBe(
      'saved',
    );
    expect(door.puts.slice(1).map((p) => [p.force, p.ifMatch])).toEqual([
      [false, v(1)],
      [true, v(1)],
    ]);
  });

  it('isDraftVersionConflict reads the code on the parsed refusal, never the prose', async () => {
    const door = measuredDoor();
    const { guard } = guardOver(door, 'cancel');
    await guard.save('object', 'acme_task', { label: 'mine' }, DRAFT);
    door.savedElsewhere('object', 'acme_task', PKG, { label: 'theirs' });
    const raw = await door.client
      .save('object', 'acme_task', { label: 'x' }, { ...DRAFT, ifMatch: 'hmac-sha256:stale' })
      .catch((e: unknown) => e);
    expect(raw).toMatchObject({ status: 409, code: 'METADATA_CONFLICT' });
    expect(isDraftVersionConflict(raw)).toBe(true);
    expect(isDraftVersionConflict(Object.assign(new Error('has been modified since you loaded it'), { status: 409 }))).toBe(
      false,
    );
  });
});
