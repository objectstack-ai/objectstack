/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#3774, second half — the batch read must not answer "I don't know"
 * with a value that looks authoritative.
 *
 * `loadViewOverrides` prefers the adapter's one-request `listViewOverrides`
 * and falls back to a per-view `getView`. Which branch runs depends entirely
 * on how the batch call ANSWERS, and the two answers below are different facts:
 *
 *   resolves (even to `{}`)  → authoritative "this is what exists" → take it,
 *                              skip N GETs. That IS the batch optimization.
 *   rejects                  → "could not tell" → fall through to per-view.
 *
 * `@object-ui/data-objectstack` used to `catch {}` its own failures into `{}`,
 * collapsing the second case into the first. The fallback below was therefore
 * unreachable code on that adapter — which is why the wrong-namespace read
 * (fixed in the same PR) surfaced as a silent "settings didn't save" instead of
 * an error the fallback could recover from.
 *
 * REVERSE VERIFICATION — direction predicted before running, both observed:
 *   • restore the adapter's swallow (`catch { return {} }` in
 *     `listViewOverrides`) → the adapter suite's "a FAILING enumeration
 *     rejects" pin goes RED, and the fall-through case here stays green while
 *     being unreachable in production — which is exactly why the adapter-side
 *     pin has to exist and this file alone is not enough.
 *   • re-inline an unconditional `return map` (dropping the `catch`) here →
 *     'falls through to per-view getView when the batch read REJECTS' goes RED.
 */

import { describe, it, expect, vi } from 'vitest';
import { loadViewOverrides } from './ObjectView';

const IDS = ['crm_lead.all', 'crm_lead.pipeline'];

const OVERRIDE = { name: 'crm_lead.all', object: 'crm_lead', density: 'compact' };

describe('loadViewOverrides — batch first (#3774)', () => {
  it('uses the batch result and skips the per-view reads entirely', async () => {
    const getView = vi.fn(async () => ({ never: true }));
    const dataSource = {
      listViewOverrides: vi.fn(async () => ({ 'crm_lead.all': OVERRIDE })),
      getView,
    };

    const map = await loadViewOverrides(dataSource, 'crm_lead', IDS);

    expect(map).toEqual({ 'crm_lead.all': OVERRIDE });
    expect(dataSource.listViewOverrides).toHaveBeenCalledWith('crm_lead');
    expect(getView).not.toHaveBeenCalled();
  });

  it('an EMPTY successful batch is authoritative — it still returns early', async () => {
    const getView = vi.fn(async () => ({ density: 'comfortable' }));
    const dataSource = { listViewOverrides: vi.fn(async () => ({})), getView };

    const map = await loadViewOverrides(dataSource, 'crm_lead', IDS);

    // "No overrides exist" is a real answer. Re-probing per view here would
    // reinstate the 404 flurry the batch call exists to remove.
    expect(map).toEqual({});
    expect(getView).not.toHaveBeenCalled();
  });

  it('keeps only the ids the caller asked about', async () => {
    const dataSource = {
      listViewOverrides: vi.fn(async () => ({
        'crm_lead.all': OVERRIDE,
        'crm_lead.retired': { name: 'crm_lead.retired' },
      })),
      getView: vi.fn(),
    };

    expect(Object.keys(await loadViewOverrides(dataSource, 'crm_lead', IDS))).toEqual(['crm_lead.all']);
  });
});

describe('loadViewOverrides — the fallback must stay reachable (#3774)', () => {
  it('falls through to per-view getView when the batch read REJECTS', async () => {
    const dataSource = {
      listViewOverrides: vi.fn(async () => { throw new Error('503 metadata store unavailable'); }),
      getView: vi.fn(async (_o: string, id: string) =>
        id === 'crm_lead.all' ? OVERRIDE : null),
    };

    const map = await loadViewOverrides(dataSource, 'crm_lead', IDS);

    // The point of the whole issue: a failed batch read recovers, it does not
    // silently render as "the user never customized anything".
    expect(map).toEqual({ 'crm_lead.all': OVERRIDE });
    expect(dataSource.getView).toHaveBeenCalledTimes(IDS.length);
  });

  it('falls through when the batch read resolves to a non-object', async () => {
    const dataSource = {
      listViewOverrides: vi.fn(async () => null),
      getView: vi.fn(async () => OVERRIDE),
    };

    expect(await loadViewOverrides(dataSource, 'crm_lead', IDS)).toEqual({
      'crm_lead.all': OVERRIDE,
      'crm_lead.pipeline': OVERRIDE,
    });
  });

  it('survives a per-view read failing on its own', async () => {
    const dataSource = {
      getView: vi.fn(async (_o: string, id: string) => {
        if (id === 'crm_lead.pipeline') throw new Error('404');
        return OVERRIDE;
      }),
    };

    expect(await loadViewOverrides(dataSource, 'crm_lead', IDS)).toEqual({ 'crm_lead.all': OVERRIDE });
  });
});

describe('loadViewOverrides — adapters without the batch method (#3774)', () => {
  it('an adapter exposing only getView is unaffected', async () => {
    const dataSource = { getView: vi.fn(async () => OVERRIDE) };

    expect(await loadViewOverrides(dataSource, 'crm_lead', IDS)).toEqual({
      'crm_lead.all': OVERRIDE,
      'crm_lead.pipeline': OVERRIDE,
    });
    expect(dataSource.getView).toHaveBeenCalledTimes(IDS.length);
  });

  it('an adapter with neither method yields an empty map instead of throwing', async () => {
    expect(await loadViewOverrides({}, 'crm_lead', IDS)).toEqual({});
    expect(await loadViewOverrides(undefined, 'crm_lead', IDS)).toEqual({});
  });
});
