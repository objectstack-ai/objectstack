/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9925 — `record:reference_rail` spent each entry's preview-row cap
 * with a bare `??`, and `??` rejects only `null`/`undefined`, so a value the
 * contract refuses survived as a real fetch window and reached the adapter as
 * `$top`.
 *
 * ## Why this site is in the card at all
 *
 * The card names three blocks and derives its population by CONCEPT, not by one
 * identifier. Inside this package the concept turns up at five read points, and
 * four of them already refuse a non-positive value before it reaches `$top`
 * (`record:related_list` tests the number is positive; `record:history` and
 * `record:activity` floor theirs). This entry was the one that did not, so it
 * is the one this file pins.
 *
 * ## Why "refuse it" is not this file inventing a meaning
 *
 * `@objectstack/spec` already answers what `limit: 0` means: the rail entry's
 * own member is declared a POSITIVE INTEGER on `ReferenceRailEntrySchema`
 * (`z.number().int().positive().optional()`, described there as the `$top` of
 * the one query the entry issues). So `0` is not a spelling whose meaning a
 * consumer may choose; it is a value the contract refuses.
 *
 * ## Why the silence matters more here than at the two sibling sites
 *
 * This rail degrades silently by design — a failed or empty entry renders "—"
 * rather than blanking the rail — so an entry asked for nothing draws a card
 * that looks merely empty. There is no on-screen channel to say it on, which is
 * why the diagnostic assertions below are not decoration.
 *
 * ## What the assertions are, and what each control buys
 *
 * The subject is the RELATION, never a literal: a refused value does not reach
 * `$top` and the site's own default does. Each refusal is paired with a control
 * that must NOT fire, so a rail that ignores the member entirely cannot pass
 * for a measurement and an always-on diagnostic cannot pass for a diagnosis.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { RecordContextProvider } from '@object-ui/react';

import {
  RecordReferenceRailRenderer,
  DEFAULT_REFERENCE_RAIL_LIMIT,
} from '../record-reference-rail';

/**
 * The rail gates its queries on an IntersectionObserver. Report intersecting
 * immediately so the fetch effect runs deterministically under jsdom.
 */
class ImmediateIO {
  constructor(private cb: (records: { isIntersecting: boolean }[]) => void) {}
  observe() { this.cb([{ isIntersecting: true }]); }
  disconnect() {}
  unobserve() {}
}

/** The three values `??` and the resolver DISAGREE about. */
const REFUSED = [0, -5, 2.5];

const makeDataSource = () => ({
  find: vi.fn(async () => ({ data: [{ id: 'c1', name: 'Ada' }], total: 1 })),
});

const railWith = (limit: unknown) => ({
  hideEmpty: false,
  entries: [
    {
      objectName: 'contact',
      relationshipField: 'account_id',
      title: 'Contacts',
      ...(limit === undefined ? {} : { limit }),
    },
  ],
});

const renderRail = (schema: Record<string, unknown>, dataSource: any) =>
  render(
    <MemoryRouter>
      <RecordContextProvider objectName="account" recordId="A1" dataSource={dataSource as any}>
        <RecordReferenceRailRenderer schema={schema as any} />
      </RecordContextProvider>
    </MemoryRouter>,
  );

const tops = async (ds: ReturnType<typeof makeDataSource>) => {
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  return ds.find.mock.calls.map((c: any[]) => (c[1] as any)?.$top);
};

let warnings: string[] = [];
beforeEach(() => {
  warnings = [];
  vi.stubGlobal('IntersectionObserver', ImmediateIO as unknown as typeof IntersectionObserver);
  vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(' '));
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rowCapWarnings = () => warnings.filter((w) => w.includes('RecordReferenceRail row cap'));

describe('record:reference_rail — a row cap the contract refuses never reaches the wire (objectui#9925)', () => {
  it.each(REFUSED)('never sends `$top: %s`', async (bad) => {
    const ds = makeDataSource();
    renderRail(railWith(bad), ds);

    const sent = await tops(ds);
    expect(sent.length).toBeGreaterThan(0);
    expect(sent, `the authored ${bad} reached the wire`).not.toContain(bad);
    for (const top of sent) {
      expect(typeof top).toBe('number');
      expect(Number.isInteger(top)).toBe(true);
      expect(top).toBeGreaterThan(0);
    }
  });

  it.each(REFUSED)('falls back to this entry’s OWN default instead of %s', async (bad) => {
    const ds = makeDataSource();
    renderRail(railWith(bad), ds);

    const sent = await tops(ds);
    // The relation, not the literal: whatever this site documents as its
    // default is what a refused declaration falls back to.
    for (const top of sent) expect(top).toBe(DEFAULT_REFERENCE_RAIL_LIMIT);
  });

  it('CONTROL — a legitimate authored limit still reaches `$top` unchanged', async () => {
    const ds = makeDataSource();
    renderRail(railWith(7), ds);

    const sent = await tops(ds);
    // Without this row, "never 0" is satisfied by a rail that ignores the
    // member entirely and always sends its own default.
    expect(sent).toContain(7);
    expect(sent).not.toContain(DEFAULT_REFERENCE_RAIL_LIMIT);
  });

  it('CONTROL — declaring no limit at all still sends the default', async () => {
    const ds = makeDataSource();
    renderRail(railWith(undefined), ds);

    const sent = await tops(ds);
    expect(sent).toContain(DEFAULT_REFERENCE_RAIL_LIMIT);
  });

  it('CONTROL — the entry’s parent scope still arrives when its limit is refused', async () => {
    // ⛔ No capability removed: refusing one member must not cost the query the
    // entry exists to issue.
    const ds = makeDataSource();
    renderRail(railWith(0), ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    const [object, params] = ds.find.mock.calls[0] as unknown as [string, any];
    expect(object).toBe('contact');
    expect(params.$filter).toEqual({ account_id: 'A1' });
    expect(params.$count).toBe(true);
  });

  it('refuses ONE entry without disarming its neighbour', async () => {
    // A rail is a list, and the resolver runs per entry: a refused entry must
    // not take the legitimate one's window with it, in either direction.
    const ds = makeDataSource();
    renderRail(
      {
        hideEmpty: false,
        entries: [
          { objectName: 'contact', relationshipField: 'account_id', limit: 0 },
          { objectName: 'task', relationshipField: 'account_id', limit: 7 },
        ],
      },
      ds,
    );

    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(2));
    const byObject = new Map(
      ds.find.mock.calls.map((c: any[]) => [c[0] as string, (c[1] as any)?.$top]),
    );
    expect(byObject.get('contact')).toBe(DEFAULT_REFERENCE_RAIL_LIMIT);
    expect(byObject.get('task')).toBe(7);
  });

  // ── THE DIAGNOSTIC ───────────────────────────────────────────────────────
  it.each(REFUSED)('says so, naming the block, the entry’s object and the value %s', async (bad) => {
    const ds = makeDataSource();
    renderRail(railWith(bad), ds);

    await waitFor(() => expect(rowCapWarnings().length).toBeGreaterThan(0));
    const message = rowCapWarnings()[0];
    // This rail is silent on screen by construction, so substituting a number
    // the author never wrote would otherwise be entirely unobservable.
    expect(message).toContain('record:reference_rail');
    expect(message).toContain('contact');
    expect(message).toContain('limit');
    expect(message).toContain(String(bad));
  });

  it('fires exactly ONCE for one declaration, across re-renders', async () => {
    const ds = makeDataSource();
    const { rerender } = renderRail(railWith(0), ds);

    await waitFor(() => expect(rowCapWarnings().length).toBeGreaterThan(0));
    // A fresh schema OBJECT carrying the same declaration. The effect is keyed
    // on the declaration's CONTENT and deduped per (object, value), so this
    // must say nothing more.
    rerender(
      <MemoryRouter>
        <RecordContextProvider objectName="account" recordId="A1" dataSource={ds as any}>
          <RecordReferenceRailRenderer schema={railWith(0) as any} />
        </RecordContextProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(rowCapWarnings()).toHaveLength(1);
  });

  it('stays silent about an entry it has already named when a NEIGHBOUR is added', async () => {
    // The dedupe is not the effect's dependency key: adding a second entry
    // genuinely changes the declaration, so the effect re-runs and walks the
    // list again. Without a per-(object, value) memory the untouched first
    // entry would be named a second time — one authoring change, two warnings
    // about a value that did not move.
    const ds = makeDataSource();
    const { rerender } = renderRail(railWith(0), ds);
    await waitFor(() => expect(rowCapWarnings().length).toBe(1));

    rerender(
      <MemoryRouter>
        <RecordContextProvider objectName="account" recordId="A1" dataSource={ds as any}>
          <RecordReferenceRailRenderer
            schema={{
              hideEmpty: false,
              entries: [
                { objectName: 'contact', relationshipField: 'account_id', limit: 0 },
                { objectName: 'task', relationshipField: 'account_id', limit: 7 },
              ],
            } as any}
          />
        </RecordContextProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalledTimes(3));
    expect(
      rowCapWarnings(),
      'the untouched first entry was named again when its neighbour arrived',
    ).toHaveLength(1);
  });

  it('CONTROL — a legitimate limit produces no such diagnostic', async () => {
    const ds = makeDataSource();
    renderRail(railWith(7), ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    // An always-on marker states nothing.
    expect(rowCapWarnings()).toHaveLength(0);
  });

  it('CONTROL — declaring no limit at all produces no diagnostic', async () => {
    const ds = makeDataSource();
    renderRail(railWith(undefined), ds);

    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(rowCapWarnings()).toHaveLength(0);
  });
});
