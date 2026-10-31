/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A `sys_comment` write answers the ids of the mentioned users the server will
 * not notify as `withheldMentions` (objectstack#27703), on the author's own
 * answer only. `create` / `update` resolve the record, so the answer's other
 * members never reached a caller; the per-call `onMentionsWithheld` listener
 * is the door to this one (objectstack#28218), and what every caller resolves
 * is unchanged.
 */
import { describe, it, expect, vi } from 'vitest';
import { ObjectStackAdapter } from './index';

function makeDS(stub: Record<string, any>) {
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    ),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { data: stub };
  return ds;
}

describe('ObjectStackAdapter create/update hand `withheldMentions` to the per-call listener (objectstack#28218)', () => {
  it('create: the listener hears the ids once, and the call still resolves the plain record', async () => {
    const create = vi.fn().mockResolvedValue({
      object: 'sys_comment',
      id: 'c1',
      record: { id: 'c1', body: 'hi @Ada @Grace' },
      withheldMentions: ['u_ada', 'u_grace'],
    });
    const ds = makeDS({ create });
    const onMentionsWithheld = vi.fn();

    const rec = await ds.create('sys_comment', { body: 'hi @Ada @Grace' }, { onMentionsWithheld });

    expect(rec).toEqual({ id: 'c1', body: 'hi @Ada @Grace' });
    expect(onMentionsWithheld).toHaveBeenCalledTimes(1);
    expect(onMentionsWithheld).toHaveBeenCalledWith(['u_ada', 'u_grace']);
    // The listener is the adapter's, never forwarded to the client call.
    expect(create).toHaveBeenCalledWith('sys_comment', { body: 'hi @Ada @Grace' });
  });

  it('update: the listener hears the ids, and `ifMatch` still reaches the client alone', async () => {
    const update = vi.fn().mockResolvedValue({
      object: 'sys_comment',
      id: 'c1',
      record: { id: 'c1', is_edited: true },
      withheldMentions: ['u_grace'],
    });
    const ds = makeDS({ update });
    const onMentionsWithheld = vi.fn();

    const rec = await ds.update('sys_comment', 'c1', { body: 'now @Grace' }, { ifMatch: 't1', onMentionsWithheld });

    expect(rec).toEqual({ id: 'c1', is_edited: true });
    expect(onMentionsWithheld).toHaveBeenCalledWith(['u_grace']);
    expect(update).toHaveBeenCalledWith('sys_comment', 'c1', { body: 'now @Grace' }, { ifMatch: 't1' });

    // Without `ifMatch` the client is called exactly as before: no options bag.
    await ds.update('sys_comment', 'c1', { body: 'again' }, { onMentionsWithheld });
    expect(update).toHaveBeenLastCalledWith('sys_comment', 'c1', { body: 'again' }, undefined);
  });

  it('control: an answer without the key, with none withheld, or not a list of ids calls nothing', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ record: { id: 'c1' } })
      .mockResolvedValueOnce({ record: { id: 'c2' }, withheldMentions: [] })
      .mockResolvedValueOnce({ record: { id: 'c3' }, withheldMentions: 'u_ada' })
      .mockResolvedValueOnce({ record: { id: 'c4' }, withheldMentions: [7, '', null] });
    const ds = makeDS({ create });
    const onMentionsWithheld = vi.fn();

    for (let i = 0; i < 4; i++) await ds.create('sys_comment', { body: 'x' }, { onMentionsWithheld });

    expect(onMentionsWithheld).not.toHaveBeenCalled();
  });

  it('a write without the listener resolves as before, and a throwing listener does not fail a stored write', async () => {
    const create = vi.fn().mockResolvedValue({ record: { id: 'c1' }, withheldMentions: ['u_ada'] });
    const ds = makeDS({ create });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(ds.create('sys_comment', { body: 'x' })).resolves.toEqual({ id: 'c1' });
    await expect(
      ds.create('sys_comment', { body: 'x' }, { onMentionsWithheld: () => { throw new Error('boom'); } }),
    ).resolves.toEqual({ id: 'c1' });
    expect(warn).toHaveBeenCalledWith('ObjectStackAdapter: withheld-mentions listener error', expect.any(Error));
    warn.mockRestore();
  });
});
