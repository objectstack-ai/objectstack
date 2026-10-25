/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6522 — `MetadataObjectsPage` keys its name lookups so that an
 * object whose name collides with `Object.prototype` is still reachable.
 *
 * Same construction defect the objectui#6489 / objectui#6240 family already
 * ruled on, in a third page. This file is `MetadataObjectsPage`; the sibling
 * `MetadataFieldsPage.fieldsMapKeying.test.tsx` holds the fields-map half.
 *
 * ## Two sites, one construction — and the consequential one is a READ
 *
 * SITE A — `handleObjectsChange`, the delete scan (the card's site).
 *   The lookup of the manager's NEW list was a plain object literal filled by
 *   assignment, and the delete scan asked `!nextByName[name]`. For an object
 *   named `constructor` that lookup answers out of `Object.prototype` and
 *   returns the `Object` function — truthy — so the object reads as "still
 *   present" and `client.reset('object', 'constructor')` never fires. The row
 *   disappears from the manager, no error is shown, the save reports success,
 *   and the object is still there after a reload. A silent no-op, not a
 *   refusal: the strongest evidence here is not the shape of the lookup but
 *   the object SURVIVING the round trip, which is what these tests assert.
 *
 * SITE B — `reload`, the raw-payload lookup keyed by object name.
 *   The same construction, one function over, failing on the write instead of
 *   the read: `byName[item.name] = item` for an object named `__proto__`
 *   invokes the prototype setter rather than creating a key. The entry never
 *   becomes an own property, so `Object.values(...)` never yields it and the
 *   object is invisible in the Object Manager — unlistable, uneditable,
 *   undeletable — while the server holds it happily. It also leaves that
 *   payload on the lookup's prototype chain, so later lookups for unrelated
 *   names (`label`, `icon`, `fields`, …) answer out of it.
 *
 * Both names are legal. Measured against the installed `@objectstack/spec`,
 * and pinned below in `the instrument` so this file does not merely assert
 * that the page handles a name the platform would have refused anyway.
 *
 * ## Why `Map` here and `Object.fromEntries` in the sibling
 *
 * The fields map in `MetadataFieldsPage` IS the serialised `fields` body of a
 * PUT, so it must remain a plain object and the family fix there is
 * `Object.fromEntries` + `Object.prototype.hasOwnProperty.call(...)` on every
 * read. Neither lookup in THIS file is ever serialised: site A is built, read
 * and discarded inside one callback, and site B holds raw payloads whose
 * VALUES are spread into a PUT body while the container itself never reaches
 * the wire. A `Map` has neither hazard structurally — a string key is just a
 * key, there is no prototype to answer out of and no setter to trip — instead
 * of requiring every future read in the file to remember a guard.
 *
 * ## ⛔ Fixture rule (objectui#6524)
 *
 * `{ __proto__: v }` in an object literal SETS THE PROTOTYPE (Annex B.3.1);
 * it does not add a key. A fixture written that way has zero own keys and
 * passes for the wrong reason. Every `__proto__` key in this file is spelled
 * `['__proto__']`, a computed key, and the rule itself is pinned below.
 * `JSON.parse` does define an own `__proto__` property, which is why the
 * server payloads this page reads (parsed bytes) carry the name honestly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { ObjectSchema } from '@objectstack/spec/data';
import { MetadataClient } from '@object-ui/data-objectstack';
import type { ObjectDefinition } from '@object-ui/types';

interface ServerItem {
  name: string;
  label: string;
  pluralLabel?: string;
  icon?: string;
  isSystem?: boolean;
  fields: Record<string, unknown>;
}

const item = (name: string, label: string): ServerItem => ({
  name,
  label,
  pluralLabel: `${label}s`,
  isSystem: false,
  fields: { name: { type: 'text', label: 'Name' } },
});

interface RecordedManagerProps {
  objects: ObjectDefinition[];
  onObjectsChange?: (objects: ObjectDefinition[]) => void;
  showSystemObjects?: boolean;
  readOnly?: boolean;
}

let managerProps: RecordedManagerProps | null = null;

vi.mock('./ObjectManager', () => ({
  ObjectManager: (props: RecordedManagerProps) => {
    managerProps = props;
    return null;
  },
}));

import { MetadataObjectsPage } from './MetadataObjectsPage';

/**
 * A server that actually holds state, so "the object survives the round trip"
 * is observable rather than inferred. GET serves the current contents, DELETE
 * removes, PUT upserts — the same three doors `MetadataClient` uses.
 */
let serverObjects: ServerItem[] = [];
let deletes: string[] = [];
let puts: Array<{ name: string; body: Record<string, unknown> }> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const nameFromUrl = (url: string): string =>
  decodeURIComponent(url.split('/api/v1/meta/object/')[1]?.split('?')[0] ?? '');

function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      const url = String(input);
      if (method === 'DELETE') {
        const name = nameFromUrl(url);
        deletes.push(name);
        serverObjects = serverObjects.filter((o) => o.name !== name);
        return json({ success: true, reset: true });
      }
      if (method === 'PUT') {
        const name = nameFromUrl(url);
        const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        puts.push({ name, body });
        serverObjects = [
          ...serverObjects.filter((o) => o.name !== name),
          body as unknown as ServerItem,
        ];
        return json({ success: true });
      }
      return json({ items: serverObjects });
    }) as unknown as typeof fetch,
  });
}

const shownError = (): string | null =>
  screen.queryByTestId('metadata-objects-page-error')?.textContent ?? null;

/** Render against the current `serverObjects` and wait for the first paint. */
async function renderPage(expectedRows: number) {
  render(<MetadataObjectsPage client={realClient()} />);
  await waitFor(() => expect(managerProps).not.toBeNull());
  await waitFor(() => expect(managerProps!.objects).toHaveLength(expectedRows));
}

/** Remove one row through the manager, exactly as `ObjectManager` would. */
async function deleteThroughManager(name: string) {
  const next = managerProps!.objects.filter((o) => o.name !== name);
  await act(async () => {
    managerProps!.onObjectsChange!(next);
  });
}

const namesOnServer = (): string[] => serverObjects.map((o) => o.name).sort();
const namesInManager = (): string[] => managerProps!.objects.map((o) => o.name).sort();

beforeEach(() => {
  serverObjects = [];
  deletes = [];
  puts = [];
  managerProps = null;
});

afterEach(() => {
  managerProps = null;
});

const parsesAsObjectName = (name: string): boolean =>
  ObjectSchema.safeParse({
    name,
    label: 'C',
    fields: { n: { type: 'text', label: 'N' } },
  }).success;

describe('the instrument', () => {
  it('the spec ACCEPTS both prototype-colliding names, so this is the page`s problem to solve', () => {
    // Without this, every case below could be dismissed as "the platform would
    // have refused that name anyway". It would not: measured against the
    // installed `@objectstack/spec` 17.2.0.
    expect(parsesAsObjectName('constructor')).toBe(true);
    expect(parsesAsObjectName('__proto__')).toBe(true);
  });

  it('and those two are the WHOLE reachable set — the rest of the prototype is refused by name', () => {
    // Why the cases below stop at two names rather than sweeping the whole
    // prototype. `ObjectSchema` pins object names to /^[a-z_][a-z0-9_]*$/, and
    // every other own name on `Object.prototype` carries a capital
    // (`toString`, `hasOwnProperty`, `valueOf`, `__defineGetter__`, …), so it
    // can never be stored in the first place. This is a measurement, not an
    // assumption: if the spec ever loosens that pattern, or a future engine
    // adds a lowercase member, this test reds and names what the page's
    // lookups newly have to survive.
    const reachable = Object.getOwnPropertyNames(Object.prototype)
      .filter(parsesAsObjectName)
      .sort();
    expect(reachable).toEqual(['__proto__', 'constructor']);
    expect(parsesAsObjectName('toString')).toBe(false);
  });
});

describe('the mechanic — plain JavaScript, before any claim about the page', () => {
  it('a plain-object lookup answers out of `Object.prototype`; a `Map` does not', () => {
    // SITE A in one assertion. Nothing named `constructor` was ever put in.
    const assigned: Record<string, unknown> = {};
    assigned['account'] = { name: 'account' };
    expect(Boolean(assigned['constructor'])).toBe(true);
    expect(Boolean(assigned['toString'])).toBe(true);

    const built = new Map<string, unknown>([['account', { name: 'account' }]]);
    expect(built.has('constructor')).toBe(false);
    expect(built.has('toString')).toBe(false);
  });

  it('assigning `__proto__` sets the prototype instead of adding a key — and then answers for OTHER names', () => {
    // SITE B in one assertion: the entry never becomes a key (so it is never
    // yielded by `Object.values`), and it poisons unrelated lookups.
    const assigned: Record<string, unknown> = {};
    assigned['__proto__'] = { name: '__proto__', label: 'Proto' };
    expect(Object.keys(assigned)).toEqual([]);
    expect(Object.values(assigned)).toEqual([]);
    expect(assigned['label']).toBe('Proto');

    const built = new Map<string, unknown>([
      ['__proto__', { name: '__proto__', label: 'Proto' }],
    ]);
    expect([...built.keys()]).toEqual(['__proto__']);
    expect(built.get('label')).toBeUndefined();
  });

  it('is a fixture rule too: `{ __proto__: v }` in a LITERAL sets the prototype, it does not add a key', () => {
    // objectui#6524. Why every `__proto__` key in this file is computed. A
    // fixture written the plain way carries zero own keys and passes for the
    // wrong reason — the assertion would be about `{}`.
    const plain = { __proto__: { name: '__proto__', label: 'P' } } as Record<string, unknown>;
    expect(Object.keys(plain)).toEqual([]);
    const computed = { ['__proto__']: { name: '__proto__', label: 'P' } } as Record<string, unknown>;
    expect(Object.keys(computed)).toEqual(['__proto__']);
    // And why payloads parsed from the wire read honestly: `JSON.parse`
    // defines an own property rather than invoking the setter.
    expect(Object.keys(JSON.parse('{"__proto__":{"label":"P"}}'))).toEqual(['__proto__']);
  });
});

describe('objectui#6522 · SITE A — the delete scan issues the DELETE for a prototype-named object', () => {
  it('C0 (control): an ordinary object is deleted and is gone after the reload', async () => {
    // Green before and after this card. Its job is to prove the cases below
    // are about the lookup keying and not about deletes having stopped.
    serverObjects = [item('account', 'Account'), item('contact', 'Contact')];
    await renderPage(2);

    await deleteThroughManager('contact');

    // Outcome first, mechanism second — the order every case in this group
    // uses, so a regression fails on the user-visible fact rather than on the
    // request log.
    expect(shownError()).toBeNull();
    await waitFor(() => expect(namesInManager()).toEqual(['account']));
    expect(namesOnServer()).toEqual(['account']);
    expect(deletes).toEqual(['contact']);
  });

  it('H1: an object named `constructor` is really deleted — it does NOT survive the reload', async () => {
    // THE case this card exists for, and the realistic one: an ordinary
    // lowercase identifier a business object could plausibly be called.
    //
    // Before the fix `!nextByName['constructor']` answered out of
    // `Object.prototype` with the `Object` function — truthy — so `reset` was
    // never called. The row vanished from the manager, NO error was shown,
    // and the object came straight back on the next load.
    serverObjects = [item('account', 'Account'), item('constructor', 'Constructor')];
    await renderPage(2);

    await deleteThroughManager('constructor');

    // The silence first: whatever happened, the page reported success.
    expect(shownError()).toBeNull();
    // THE silent-no-op assertion, and the one that reds without the fix: the
    // object is still listed after the reload. It was never a refusal that
    // stopped the delete — nothing was shown, the row just came back.
    await waitFor(() => expect(namesInManager()).toEqual(['account']));
    expect(namesOnServer()).toEqual(['account']);
    // Only then the mechanism that produced it.
    expect(deletes).toEqual(['constructor']);
  });

  it('H2: an object named `__proto__` is really deleted — it does NOT survive the reload', async () => {
    // Needs both sites correct: site B must key it as an own property for it
    // to be listed at all, and site A must not read it back off the prototype.
    serverObjects = [item('account', 'Account'), item('__proto__', 'Proto')];
    await renderPage(2);

    await deleteThroughManager('__proto__');

    expect(shownError()).toBeNull();
    await waitFor(() => expect(namesInManager()).toEqual(['account']));
    expect(namesOnServer()).toEqual(['account']);
    expect(deletes).toEqual(['__proto__']);
  });

  it('the deletes above are the only writes — no object is resurrected by a stray save', async () => {
    // Falsification for the whole group: a page that PUT every row on every
    // change would keep `namesOnServer()` correct for the wrong reason.
    serverObjects = [item('account', 'Account'), item('constructor', 'Constructor')];
    await renderPage(2);

    await deleteThroughManager('constructor');

    expect(puts).toEqual([]);
  });
});

describe('objectui#6522 · SITE B — the raw-payload lookup keys every server object as an own entry', () => {
  it('an object named `__proto__` served by the server actually reaches the manager', async () => {
    // The second construction in this file, failing on the WRITE. Built by
    // assignment, `byName['__proto__'] = item` invoked the prototype setter,
    // so `Object.values(...)` never yielded it: the object was invisible in
    // the Object Manager while the server held it.
    serverObjects = [item('account', 'Account'), item('__proto__', 'Proto')];
    await renderPage(2);

    expect(namesInManager()).toEqual(['__proto__', 'account']);
    const proto = managerProps!.objects.find((o) => o.name === '__proto__')!;
    expect(proto.label).toBe('Proto');
    // Derived like every other row — it is a first-class object, not a stub.
    expect(proto.group).toBe('Custom Objects');
    expect(proto.fieldCount).toBe(1);
  });

  it('non-vacuity: the fixture really is what the server sent, own key and all', () => {
    // If the `__proto__` fixture ever lost its name the case above would stay
    // green while testing nothing. Parsed bytes, so the key is honest.
    const [, proto] = JSON.parse(
      JSON.stringify([item('account', 'Account'), item('__proto__', 'Proto')]),
    ) as ServerItem[];
    expect(proto.name).toBe('__proto__');
    // …and the name really is one blind assignment drops: this is the exact
    // construction the page used, run on the exact fixture.
    const dropped: Record<string, unknown> = {};
    dropped[proto.name] = proto;
    expect(Object.keys(dropped)).toEqual([]);
  });

  it('an object named `constructor` round-trips an edit onto its OWN payload', async () => {
    // The read half of site B: `prev[updated.name]` is what the save-back
    // merges onto. Off a plain object literal a name that is not an own key
    // answers with an inherited value instead of `undefined`, so the merge
    // base and the redundant-save guard both consult the wrong thing.
    serverObjects = [item('constructor', 'Constructor')];
    await renderPage(1);

    const next = managerProps!.objects.map((o) => ({ ...o, label: 'Renamed' }));
    await act(async () => {
      managerProps!.onObjectsChange!(next);
    });
    await waitFor(() => expect(puts).toHaveLength(1));

    expect(puts[0].name).toBe('constructor');
    expect(puts[0].body.label).toBe('Renamed');
    // The rest of the server document survived the merge — proof the base was
    // the real payload rather than something off the prototype chain.
    expect(puts[0].body.pluralLabel).toBe('Constructors');
    expect(puts[0].body.fields).toBeDefined();
    // COMPLETION ANCHOR (objectui#8690). The emptiness below is only worth
    // reading once `handleObjectsChange` has run to the END: `reload()` is its
    // last statement, so the manager receiving the re-read list is the signal
    // that every write the handler was going to make has been made. Waiting on
    // `puts` instead dates the absence to the FIRST write, which covers the
    // delete scan only because that scan happens to run before the save loop —
    // a property of the page, not one this file asserts. Measured: with a stray
    // `reset` issued after the saves, the `puts` wait leaves the delete log
    // green while C0/H1/H2 above — which already anchor on the reload — go red.
    // `label` and not `name` because the name is unchanged by a rename: only
    // the relabelled row is a value the pre-reload state cannot answer with.
    await waitFor(() => expect(managerProps!.objects.map((o) => o.label)).toEqual(['Renamed']));
    expect(deletes).toEqual([]);
    expect(shownError()).toBeNull();
  });
});
