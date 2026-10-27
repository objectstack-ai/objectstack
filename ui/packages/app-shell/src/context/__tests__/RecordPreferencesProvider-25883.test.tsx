/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25883 (item 2) — the console keeps a reader's "show empty
 * fields" choice per object in the `ui.record.<object>` `sys_user_preference`
 * row, and hands it to the record page through `@object-ui/react`'s
 * `RecordPagePreferencesProvider`.
 *
 *   1. With the record-state family attached, a record page's toggle survives
 *      a remount, holds for the object's other sections, leaves another object
 *      alone, and writes `ui.record.<object>`.
 *   2. The stored rows are the user's state: the page opens on them.
 *   3. With no family attached (no signed-in user, a host without the bridge)
 *      there is no store, and the section keeps its own in-memory toggle.
 *   4. A choice made before the read answers is kept over the stored row; a
 *      user switch drops the previous user's choices.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import { useRecordPagePreferences } from '@object-ui/react';
import { DetailSection } from '@object-ui/plugin-detail';
import type { DetailViewSection } from '@object-ui/types';
import { UserStateAdaptersProvider, useAttachRecordStateFamily } from '../UserStateAdapters';
import {
  RECORD_PREFERENCE_PREFIX,
  RecordPreferencesProvider,
  recordPreferenceKey,
  sanitizeRecordPreference,
} from '../RecordPreferencesProvider';

afterEach(() => cleanup());

/** A record-state family recording its traffic; `rows` is the user's stored rows. */
function makeFamily(rows: Record<string, unknown> = {}, opts: { held?: boolean } = {}) {
  let release: () => void = () => {};
  const gate = opts.held ? new Promise<void>((r) => (release = r)) : Promise.resolve();
  const family = {
    prefix: RECORD_PREFERENCE_PREFIX,
    load: vi.fn(async () => {
      await gate;
      return structuredClone(rows) as Record<string, any>;
    }),
    save: vi.fn(async (_key: string, _value: unknown) => {}),
  };
  return { family, release: () => release() };
}

function AttachFamily({ family }: { family: unknown }) {
  const attach = useAttachRecordStateFamily();
  useEffect(() => {
    attach(family as never);
    return () => attach(null);
  }, [attach, family]);
  return null;
}

function Providers({ family, children }: { family: unknown; children: ReactNode }) {
  return (
    <UserStateAdaptersProvider>
      {family ? <AttachFamily family={family} /> : null}
      <RecordPreferencesProvider>{children}</RecordPreferencesProvider>
    </UserStateAdaptersProvider>
  );
}

const section = (title: string): DetailViewSection => ({
  title,
  fields: [
    { name: 'name', label: `${title} Name` },
    { name: 'stage', label: `${title} Stage` },
    { name: 'next_step', label: `${title} Next Step` },
    { name: 'lead_source', label: `${title} Lead Source` },
  ],
});
const RECORD = { name: 'Big Deal', stage: 'Proposal', next_step: null, lead_source: '' };

const Section = ({ title, objectName }: { title: string; objectName: string }) => (
  <div data-testid={title}>
    <DetailSection section={section(title)} data={RECORD} objectName={objectName} />
  </div>
);
const inSection = (title: string) => within(screen.getByTestId(title));
const emptyShown = (title: string) => inSection(title).queryByText(`${title} Next Step`) !== null;
const showButton = (title: string) => inSection(title).getByRole('button', { name: /show 2 empty fields/i });

describe('RecordPreferencesProvider — the record page remembers "show empty fields" (objectstack#25883)', () => {
  it('toggle, remount, still shown; the other sections of the object follow; another object is unaffected', async () => {
    const { family } = makeFamily();
    const page = () => (
      <Providers family={family}>
        <Section title="Details" objectName="opportunity" />
        <Section title="Pipeline" objectName="opportunity" />
        <Section title="Company" objectName="account" />
      </Providers>
    );
    const first = render(page());
    await waitFor(() => expect(family.load).toHaveBeenCalledTimes(1));
    await act(async () => {});

    fireEvent.click(showButton('Details'));
    expect(emptyShown('Details')).toBe(true);
    expect(emptyShown('Pipeline')).toBe(true);
    expect(emptyShown('Company')).toBe(false);
    expect(family.save).toHaveBeenCalledTimes(1);
    expect(family.save).toHaveBeenCalledWith('ui.record.opportunity', { showEmptyFields: true });

    // A reload: the family loads what was written.
    first.unmount();
    const reloaded = makeFamily({ [recordPreferenceKey('opportunity')]: family.save.mock.calls[0][1] });
    render(
      <Providers family={reloaded.family}>
        <Section title="Details" objectName="opportunity" />
        <Section title="Company" objectName="account" />
      </Providers>,
    );
    await waitFor(() => expect(emptyShown('Details')).toBe(true));
    expect(emptyShown('Company')).toBe(false);
  });

  it('with no family attached there is no store, and the toggle stays the section\'s own', async () => {
    const { result } = renderHook(() => useRecordPagePreferences(), {
      wrapper: ({ children }) => <Providers family={null}>{children}</Providers>,
    });
    expect(result.current).toBeNull();
    cleanup();

    const first = render(
      <Providers family={null}>
        <Section title="Details" objectName="opportunity" />
        <Section title="Pipeline" objectName="opportunity" />
      </Providers>,
    );
    fireEvent.click(showButton('Details'));
    expect(emptyShown('Details')).toBe(true);
    expect(emptyShown('Pipeline')).toBe(false);
    first.unmount();
    render(
      <Providers family={null}>
        <Section title="Details" objectName="opportunity" />
      </Providers>,
    );
    expect(emptyShown('Details')).toBe(false);
  });

  it('reads only its own family\'s rows, sanitized', async () => {
    const { family } = makeFamily({
      'ui.record.account': { showEmptyFields: true, stray: 1 },
      'ui.record.contact': { showEmptyFields: 'yes' },
      'ui.list.account': { showEmptyFields: false },
    });
    const { result } = renderHook(() => useRecordPagePreferences(), {
      wrapper: ({ children }) => <Providers family={family}>{children}</Providers>,
    });
    await waitFor(() => expect(result.current?.get('account')).toEqual({ showEmptyFields: true }));
    expect(result.current?.get('contact')).toEqual({});
    expect(result.current?.get('lead')).toEqual({});
    expect(sanitizeRecordPreference(['x'])).toEqual({});
  });

  it('a choice made before the read answers is kept over the stored row', async () => {
    const { family, release } = makeFamily({ 'ui.record.account': { showEmptyFields: true } }, { held: true });
    const { result } = renderHook(() => useRecordPagePreferences(), {
      wrapper: ({ children }) => <Providers family={family}>{children}</Providers>,
    });
    await waitFor(() => expect(result.current).not.toBeNull());
    act(() => result.current?.update('account', { showEmptyFields: false }));
    await act(async () => release());
    await waitFor(() => expect(family.load).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current?.get('account')).toEqual({ showEmptyFields: false });
    expect(family.save).toHaveBeenCalledWith('ui.record.account', { showEmptyFields: false });
  });

  it('a user switch drops the previous user\'s choices and reads the new user\'s rows', async () => {
    const u1 = makeFamily({ 'ui.record.account': { showEmptyFields: true } });
    const u2 = makeFamily({});
    let current: unknown = u1.family;
    const { result, rerender } = renderHook(() => useRecordPagePreferences(), {
      wrapper: ({ children }) => <Providers family={current}>{children}</Providers>,
    });
    await waitFor(() => expect(result.current?.get('account')).toEqual({ showEmptyFields: true }));
    current = u2.family;
    rerender();
    await waitFor(() => expect(u2.family.load).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(result.current?.get('account')).toEqual({});
  });
});
