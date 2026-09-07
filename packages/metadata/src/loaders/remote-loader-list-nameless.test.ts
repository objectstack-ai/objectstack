// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15037 — `RemoteLoader.list()` declares `Promise<string[]>` and maps a
 * nameless body straight through, so `listNames()` can hand a caller a literal
 * `undefined` where the type says a `string`.
 *
 * ---------------------------------------------------------------------------
 * The defect (measured on `origin/main` @ 9c3fda5fb, this fixture)
 * ---------------------------------------------------------------------------
 *     async list(type: string): Promise<string[]> {
 *       const items = await this.loadMany<{ name: string }>(type);
 *       return items.map(i => i.name);
 *     }
 *
 * The type argument `{ name: string }` is an ASSERTION about bodies that
 * arrived over HTTP; nothing checks it. A body with no top-level `name` yields
 * `i.name === undefined`, and that `undefined` is pushed into an array the
 * signature declares as `string[]` — a runtime violation of a declared type,
 * not merely an untidy entry. `MetadataManager.listNames()` unions loader
 * `list()` output unfiltered (`result.forEach(item => names.add(item))`), so
 * the violation reaches consumers, which then use the value as an object key,
 * lower-case it, or feed it back to a by-name `load()`.
 *
 * ---------------------------------------------------------------------------
 * The direction, and why it was not this seat's to choose
 * ---------------------------------------------------------------------------
 * Three of the four sibling loaders in this directory had already answered it,
 * and `RemoteLoader` was the only one with no guard at all:
 *
 *   DatabaseLoader   `rows.map(row => row.name as string)`
 *                    `.filter(name => typeof name === 'string')`  — guarded
 *   MemoryLoader     `Array.from(typeStore.keys())`               — store keys
 *   FilesystemLoader narrowed by #14486 to names `findFile()` resolves
 *   RemoteLoader     `items.map(i => i.name)`                     — unguarded
 *
 * So the repair is `DatabaseLoader`'s guard, one file away: same directory,
 * same method name, same "cast then map" spelling, one `.filter()` behind it.
 * "Refuse loudly" was NOT taken, and that is a landed decision rather than a
 * preference — `DatabaseLoader`'s guard is a silent `.filter()`, and
 * `FilesystemLoader`'s narrowing carries a maintainer ruling (via the director
 * seat on #14486, 2026-09-02, direction A, with B explicitly refused) whose
 * own reasoning is this card's:
 *
 *   「A name in the list that `get()` answers `null` for is the silent failure
 *    an author reads as their own typo, so they retry the same word: the list
 *    and the door now agree instead.」
 *
 * An `undefined` in `listNames()` is the extreme form of a name the door can
 * never answer.
 *
 * ⛔ What is deliberately NOT copied: `MemoryLoader`'s structural fix (return
 * the store key) and #14205's keying rule ("identity is the key the store
 * holds an item under, not `body.name`"). This loader reads over HTTP and has
 * no store key to fall back on, so `body.name` is all it has. The guard SHAPE
 * is what transfers; the family's keying rule cannot be satisfied here.
 *
 * ---------------------------------------------------------------------------
 * Why the double is a `fetch`, not a hand-written loader
 * ---------------------------------------------------------------------------
 * Every case below drives the REAL `RemoteLoader` and, on the manager face, a
 * REAL `MetadataManager`. The only thing stubbed is the wire — a `fetch` that
 * serves the collection and answers the by-name door — so the code under test
 * is this loader's own `list()`/`loadMany()`/`load()`, not a verdict handed in
 * by a mock.
 *
 * `CONTROL:` cases pin what must NOT move: the well-formed body stays listed
 * and stays loadable, so a guard that dropped everything would fail here too.
 * `RECORD:` pins behaviour this repair deliberately leaves alone.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { MetadataManager } from '../metadata-manager.js';
import { RemoteLoader } from './remote-loader.js';

const BASE = 'https://metadata.invalid/api';
const TYPE = 'object';

/** One well-formed body, and the two shapes that violate the asserted cast. */
const NAMED = { name: 'account', label: 'Account' };
const NAMELESS = { label: 'Nameless' };
const NUMERIC_NAME = { name: 42, label: 'Numeric' };

const BODIES: Array<Record<string, unknown>> = [NAMED, NAMELESS, NUMERIC_NAME];

/** Exactly the bodies whose top-level `name` is a string. */
const LISTABLE = ['account'];

/**
 * The remote, minimally: `GET /{type}` serves the collection, `GET|HEAD
 * /{type}/{name}` is the by-name door and answers only for a body whose
 * top-level `name` equals that segment. That door is what makes
 * `listNames()`/`get()` comparable — it is the remote analogue of
 * `findFile()`.
 */
function serveRemote(bodies: Array<Record<string, unknown>>) {
  const collection = `${BASE}/${TYPE}`;

  return vi.fn(async (input: unknown, init?: { method?: string }) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });

    if (url === collection) {
      return method === 'HEAD' ? new Response(null, { status: 200 }) : json(bodies);
    }

    if (url.startsWith(`${collection}/`)) {
      const segment = url.slice(collection.length + 1);
      const hit = bodies.find(body => body.name === segment);
      if (!hit) return new Response(null, { status: 404 });
      return method === 'HEAD' ? new Response(null, { status: 200 }) : json(hit);
    }

    return new Response(null, { status: 404 });
  });
}

function loader(bodies: Array<Record<string, unknown>> = BODIES): RemoteLoader {
  vi.stubGlobal('fetch', serveRemote(bodies));
  return new RemoteLoader(BASE);
}

/** A cold manager — empty registry, one remote loader answering. */
function coldManager(bodies: Array<Record<string, unknown>> = BODIES): MetadataManager {
  const manager = new MetadataManager({ formats: ['json'], loaders: [] });
  manager.registerLoader(loader(bodies));
  return manager;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('#15037 RemoteLoader.list() keeps the `string[]` its signature declares', () => {
  it('EVERY listed name is a string — the declared-type violation itself', async () => {
    // The claim the signature makes, asserted directly. Before the guard this
    // answered `['account', undefined, 42]` against a `Promise<string[]>`.
    for (const name of await loader().list(TYPE)) {
      expect(typeof name).toBe('string');
    }
  });

  it('a body with no top-level `name` is no longer listed as `undefined`', async () => {
    const listed = await loader().list(TYPE);

    expect(listed).not.toContain(undefined);
    expect(listed.sort()).toEqual(LISTABLE);
  });

  it('a non-string `name` is dropped too — the guard is `typeof`, not truthiness', async () => {
    // `DatabaseLoader`'s predicate is `typeof name === 'string'`, so it rejects
    // every shape the cast lied about, not just the missing one. A body whose
    // `name` is a number violates `Promise<string[]>` exactly as hard.
    expect(await loader().list(TYPE)).not.toContain(42 as unknown as string);
  });

  it('EVERY listed name resolves through exists(), stat() and load()', async () => {
    // The list-and-door agreement, on this loader's own face.
    const remote = loader();

    for (const name of await remote.list(TYPE)) {
      expect(await remote.exists(TYPE, name)).toBe(true);
      expect(await remote.stat(TYPE, name)).not.toBeNull();
      expect((await remote.load(TYPE, name)).data).not.toBeNull();
    }
  });

  it('CONTROL: the well-formed body is still listed and still loadable', async () => {
    // A guard that dropped everything would satisfy every case above. This is
    // what stops that: the named body must survive untouched.
    const remote = loader();

    expect(await remote.list(TYPE)).toContain('account');
    expect((await remote.load(TYPE, 'account')).data).toEqual(NAMED);
  });

  it('CONTROL: a collection of only well-formed bodies is unchanged by the guard', async () => {
    expect((await loader([NAMED, { name: 'contact' }]).list(TYPE)).sort()).toEqual([
      'account',
      'contact',
    ]);
  });

  it('CONTROL: an empty collection still lists nothing', async () => {
    expect(await loader([]).list(TYPE)).toEqual([]);
  });
});

describe('#15037 the repair reaches MetadataManager', () => {
  it('listNames() and get() give the same answer for every name', async () => {
    // The #14486 shape, reused on the `RemoteLoader` face as triage asked.
    // Before the guard, `listNames()` carried `undefined`, and `get()` for it
    // fetched `.../object/undefined` and answered `undefined` — the list and
    // the door disagreeing, which is the failure an author reads as their own
    // typo.
    const manager = coldManager();

    for (const name of await manager.listNames(TYPE)) {
      expect(await manager.get(TYPE, name)).toBeDefined();
    }
  });

  it('listNames() no longer forwards a literal `undefined` to consumers', async () => {
    const names = await coldManager().listNames(TYPE);

    expect(names).not.toContain(undefined);
    expect(names.every(name => typeof name === 'string')).toBe(true);
    expect(names.sort()).toEqual(LISTABLE);
  });

  it('CONTROL: listNames() still reports the well-formed body, and get() resolves it', async () => {
    const manager = coldManager();

    expect(await manager.listNames(TYPE)).toContain('account');
    expect(await manager.get(TYPE, 'account')).toEqual(NAMED);
  });
});

describe('#15037 RECORD: what this repair deliberately leaves alone', () => {
  it('RECORD: loadMany() still returns the bodies list() no longer names', async () => {
    // The guard narrows `list()` only. Filtering the body read would change
    // what `MetadataManager.loadMany()` aggregates — a different direction
    // (#14341/#14205 fixed items going MISSING; this card is about one
    // APPEARING as `undefined`) and not this card's. `loadMany` keys nothing,
    // so a nameless body is still legitimately served there.
    const bodies = await loader().loadMany<Record<string, unknown>>(TYPE);

    expect(bodies).toHaveLength(3);
    expect(bodies).toContainEqual(NAMELESS);
  });

  it('RECORD: the by-name door cannot reach a nameless body, before or after', async () => {
    // `RemoteLoader` reads over HTTP and holds no store key, so there is no
    // identity to list a nameless body under. #14205's keying rule cannot be
    // satisfied here; the list is narrowed to agree with the door instead.
    expect((await loader().load(TYPE, 'Nameless')).data).toBeNull();
  });
});
