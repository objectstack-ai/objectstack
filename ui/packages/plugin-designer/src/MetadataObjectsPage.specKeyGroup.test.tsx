/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6223 — the Object Manager's grouping stays a DISPLAY category and
 * never reaches `PUT /api/v1/meta/object/:name`.
 *
 * Surfaced by the key-level parity gate built for objectui#5761
 * (`scripts/check-designer-field-key-parity.mjs`) once objectui#6223 gave it a
 * second oracle. `ServerObjectSchema` is one of that gate's object-level `wire`
 * shapes: `handleObjectsChange` merges the manager's edits onto the raw server
 * document and PUTs the result.
 *
 * `group` is not in `ObjectSchema`'s 42-key accept set. Measured against the
 * installed `@objectstack/spec` 17.2.0:
 *
 *   ObjectSchema.safeParse({ ...base, group: 'Sales' })  => success = false
 *     unrecognized_keys keys=["group"]
 *   ObjectSchema.safeParse({ ...base, isSystem: true })  => success = true  (control)
 *
 * The object-level `isSystem` control matters twice over: it is what proves
 * this is a key-by-key result, and it is the key this file now DERIVES the
 * display group from.
 *
 * ## Two halves, and the second is why a write-only fix would not do
 *
 *   WRITE — the merged save-back carried `group` verbatim, so a designer save
 *           put a key the schema refuses on the wire.
 *   SPREAD — `merged` is built by spreading the raw server document, so an
 *           object that already had `group` stored from before this fix would
 *           spread it straight back out and stay permanently unsaveable. Not
 *           writing the key is not the same as removing it, and the second case
 *           below is the one that distinguishes them.
 *
 * ## Assertions are on captured PUT bytes
 *
 * `undefined` is a key zod's strict object COUNTS and `JSON.stringify` DROPS,
 * so an assertion on the object handed to the client and an assertion on the
 * wire disagree on exactly the case this card cares about.
 *
 * This file names neither `sortOrder` nor `relationships` anywhere: those two
 * keys are resolved in `MetadataService` and pinned in its own sibling file, so
 * reverting one key's resolution reds only that key's assertions.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { ObjectSchema } from '@objectstack/spec/data';
import { MetadataClient } from '@object-ui/data-objectstack';
import type { ObjectDefinition } from '@object-ui/types';

/**
 * Two objects as the server holds them.
 *
 *   `account` is what a SPEC-PARSED server sends: no `group`, because the
 *   schema refuses the key and so it was never stored.
 *   `legacy_widget` carries a `group` a pre-fix designer build could have left
 *   behind. The merge spreads the previous document verbatim, so without the
 *   strip this key rides straight back out to the route that rejects it.
 */
const ACCOUNT = {
  name: 'account',
  label: 'Account',
  pluralLabel: 'Accounts',
  icon: 'Building',
  isSystem: false,
  fields: { name: { type: 'text', label: 'Name' } },
};

const LEGACY = {
  name: 'legacy_widget',
  label: 'Legacy Widget',
  group: 'Integration',
  isSystem: false,
  fields: { name: { type: 'text', label: 'Name' } },
};

/** A system object, so both derived categories are exercised on real data. */
const SYS_USER = {
  name: 'sys_user',
  label: 'User',
  isSystem: true,
  fields: { name: { type: 'text', label: 'Name' } },
};

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

let puts: Array<Record<string, unknown>> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function realClient(): MetadataClient {
  return new MetadataClient({
    baseUrl: 'http://localhost:3000',
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'PUT') {
        puts.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
        return json({ success: true });
      }
      void input;
      return json({ items: [ACCOUNT, LEGACY, SYS_USER] });
    }) as unknown as typeof fetch,
  });
}

async function renderPage() {
  render(<MetadataObjectsPage client={realClient()} />);
  await waitFor(() => expect(managerProps).not.toBeNull());
  await waitFor(() => expect(managerProps!.objects).toHaveLength(3));
}

/** Edit one object through the manager and wait for the resulting PUT. */
async function editObject(name: string, patch: Partial<ObjectDefinition>) {
  const next = managerProps!.objects.map((o) => (o.name === name ? { ...o, ...patch } : o));
  await act(async () => {
    managerProps!.onObjectsChange!(next);
  });
  await waitFor(() => expect(puts.length).toBeGreaterThan(0));
  return puts[puts.length - 1];
}

const unrecognizedKeys = (result: ReturnType<typeof ObjectSchema.safeParse>): string[] =>
  result.success
    ? []
    : result.error.issues
        .filter((i) => i.code === 'unrecognized_keys')
        .flatMap((i) => (i as unknown as { keys: string[] }).keys);

beforeEach(() => {
  puts = [];
  managerProps = null;
});

afterEach(() => {
  managerProps = null;
});

describe('the instrument', () => {
  it('is the installed spec schema and it is STRICT — unknown keys are refused, not stripped', () => {
    const base = { name: 'account', label: 'Account', fields: { n: { type: 'text', label: 'N' } } };
    const result = ObjectSchema.safeParse({ ...base, zzzDefinitelyNotAKey: 1 });
    expect(result.success).toBe(false);
    expect(unrecognizedKeys(result)).toContain('zzzDefinitelyNotAKey');
  });

  it('refuses `group` by name and accepts `isSystem` — the two states this file distinguishes', () => {
    const base = { name: 'account', label: 'Account', fields: { n: { type: 'text', label: 'N' } } };
    expect(unrecognizedKeys(ObjectSchema.safeParse({ ...base, group: 'Sales' }))).toEqual(['group']);
    expect(ObjectSchema.safeParse({ ...base, isSystem: true }).success).toBe(true);
  });
});

describe('objectui#6223 · the grouping control still works — it is DERIVED, not round-tripped', () => {
  it('hands a group down to the manager for every object, from the key the spec DOES accept', async () => {
    await renderPage();
    const account = managerProps!.objects.find((o) => o.name === 'account')!;
    // Before this fix the page read `raw.group` — a key `ObjectSchema` refuses,
    // so the server never stored one and this rendered EMPTY on every row.
    expect(account.group).toBe('Custom Objects');
    expect(account.isSystem).toBe(false);
  });

  it('derives the system category too, so BOTH values are reachable and neither is a constant', async () => {
    // Falsification for the case above: a hardcoded 'Custom Objects' would
    // satisfy it. This one shows the derivation actually reads the object, and
    // reads it from `isSystem` — a key `ObjectSchema` accepts, so the server
    // really does send it.
    await renderPage();
    const sys = managerProps!.objects.find((o) => o.name === 'sys_user')!;
    const custom = managerProps!.objects.find((o) => o.name === 'account')!;
    expect(sys.group).toBe('System Objects');
    expect(custom.group).toBe('Custom Objects');
    expect(sys.isSystem).toBe(true);
  });

  it('ignores a legacy stored `group` on the way IN as well — the derived value wins', async () => {
    // `legacy_widget` has `group: 'Integration'` stored. Reading it back would
    // re-admit a key the schema refuses into the UI model, and from there into
    // the next save. The derivation is unconditional for exactly that reason.
    await renderPage();
    const legacy = managerProps!.objects.find((o) => o.name === 'legacy_widget')!;
    expect(legacy.group).toBe('Custom Objects');
    expect(legacy.group).not.toBe('Integration');
  });
});

describe('objectui#6223 · WRITE — the merged save-back carries no `group`', () => {
  it('does not put `group` on the wire when the manager edits an object', async () => {
    await renderPage();
    const put = await editObject('account', { label: 'Customer Account' });
    expect('group' in put).toBe(false);
    // Falsification: the edit really was saved, and the rest of the document
    // survived the merge.
    expect(put.label).toBe('Customer Account');
    expect(put.name).toBe('account');
    expect(put.pluralLabel).toBe('Accounts');
    expect(put.fields).toBeDefined();
  });

  it('and `ObjectSchema` reports no refused key at all in that body', async () => {
    await renderPage();
    const put = await editObject('account', { label: 'Customer Account' });
    expect(unrecognizedKeys(ObjectSchema.safeParse(put))).toEqual([]);
  });
});

describe('objectui#6223 · SPREAD — a `group` already stored on the server is stripped, not re-sent', () => {
  it('drops a legacy stored `group` instead of spreading it back out', async () => {
    // The half a write-only fix would miss. `merged` is built from `...base`,
    // the raw server document, so an object saved by a pre-fix build would keep
    // failing forever: every later save re-sent the stored key.
    await renderPage();
    const put = await editObject('legacy_widget', { label: 'Renamed Widget' });
    expect('group' in put).toBe(false);
    expect(put.label).toBe('Renamed Widget');
    expect(unrecognizedKeys(ObjectSchema.safeParse(put))).toEqual([]);
  });

  it('the fixture really did carry the key — otherwise the case above proves nothing', () => {
    // Non-vacuity: if `LEGACY` ever lost its `group` the assertion above would
    // stay green while testing nothing at all.
    expect(LEGACY.group).toBe('Integration');
    expect(
      unrecognizedKeys(ObjectSchema.safeParse({ ...LEGACY, label: 'Renamed Widget' })),
    ).toEqual(['group']);
  });
});
