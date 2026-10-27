/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#25883 (item 2) — "Show N empty fields" is one remembered choice
 * per user and object.
 *
 * A reader who opened a section's empty-field row on an opportunity found it
 * folded again in every other section, after a reload, and on the next
 * opportunity: the choice lived in each section's own component state. Under a
 * host's record-page preference store (`RecordPagePreferencesProvider`; the
 * Console keeps it in the `ui.record.<object>` `sys_user_preference` row), the
 * section reads and writes the store's choice for its object instead:
 *
 *   1. toggled, unmounted and mounted again, the section still shows its empty
 *      fields;
 *   2. the choice holds for every section of that object's page;
 *   3. another object's sections are unaffected;
 *   4. the store receives the choice per object, both ways;
 *   5. with no store (no host, no signed-in user) the toggle is what it was:
 *      per section, gone on unmount.
 */

import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import {
  RecordPagePreferencesProvider,
  type RecordPagePreference,
  type RecordPagePreferencesStore,
} from '@object-ui/react';
import type { DetailViewSection } from '@object-ui/types';
import { DetailSection } from '../DetailSection';

afterEach(() => cleanup());

/** Four declared rows, two of them empty: the section folds the two. */
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

/** An in-memory store, the shape a host hands down; `writes` records every update. */
function memoryStore(initial: Record<string, RecordPagePreference> = {}) {
  const state: Record<string, RecordPagePreference> = { ...initial };
  const writes: Array<[string, RecordPagePreference]> = [];
  const listeners = new Set<() => void>();
  const store: RecordPagePreferencesStore = {
    get: (objectName) => state[objectName] ?? {},
    update: (objectName, patch) => {
      writes.push([objectName, patch]);
      state[objectName] = { ...(state[objectName] ?? {}), ...patch };
      listeners.forEach((l) => l());
    },
  };
  return { store, writes, listeners };
}

/** A host that re-renders its subtree when its store changes, as a real provider does. */
function Host({ mem, children }: { mem: ReturnType<typeof memoryStore>; children: React.ReactNode }) {
  const [version, setVersion] = React.useState(0);
  React.useEffect(() => {
    const l = () => setVersion((v) => v + 1);
    mem.listeners.add(l);
    return () => {
      mem.listeners.delete(l);
    };
  }, [mem]);
  // A new value per change, so context consumers see it.
  const value = React.useMemo<RecordPagePreferencesStore>(
    () => ({ get: (o) => mem.store.get(o), update: (o, p) => mem.store.update(o, p) }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is the change signal
    [mem, version],
  );
  return <RecordPagePreferencesProvider value={value}>{children}</RecordPagePreferencesProvider>;
}

const Section = ({ title, objectName }: { title: string; objectName: string }) => (
  <div data-testid={title}>
    <DetailSection section={section(title)} data={RECORD} objectName={objectName} />
  </div>
);

const inSection = (title: string) => within(screen.getByTestId(title));
const emptyShown = (title: string) => inSection(title).queryByText(`${title} Next Step`) !== null;
const showButton = (title: string) => inSection(title).getByRole('button', { name: /show 2 empty fields/i });

describe('the empty-field toggle is one remembered choice per object (objectstack#25883)', () => {
  it('toggled, unmounted and mounted again, the section still shows its empty fields', () => {
    const mem = memoryStore();
    const first = render(
      <Host mem={mem}>
        <Section title="Details" objectName="opportunity" />
      </Host>,
    );
    expect(emptyShown('Details')).toBe(false);
    fireEvent.click(showButton('Details'));
    expect(emptyShown('Details')).toBe(true);
    first.unmount();

    render(
      <Host mem={mem}>
        <Section title="Details" objectName="opportunity" />
      </Host>,
    );
    expect(emptyShown('Details')).toBe(true);
    expect(inSection('Details').getByRole('button', { name: /hide empty fields/i })).toBeTruthy();
  });

  it('one choice holds for every section of the object, and another object is unaffected', () => {
    const mem = memoryStore();
    render(
      <Host mem={mem}>
        <Section title="Details" objectName="opportunity" />
        <Section title="Pipeline" objectName="opportunity" />
        <Section title="Company" objectName="account" />
      </Host>,
    );
    fireEvent.click(showButton('Details'));
    expect(emptyShown('Details')).toBe(true);
    expect(emptyShown('Pipeline')).toBe(true);
    expect(emptyShown('Company')).toBe(false);
    expect(showButton('Company')).toBeTruthy();
  });

  it('the store receives the choice for the object, shown and then hidden', () => {
    const mem = memoryStore();
    render(
      <Host mem={mem}>
        <Section title="Details" objectName="opportunity" />
      </Host>,
    );
    fireEvent.click(showButton('Details'));
    fireEvent.click(inSection('Details').getByRole('button', { name: /hide empty fields/i }));
    expect(mem.writes).toEqual([
      ['opportunity', { showEmptyFields: true }],
      ['opportunity', { showEmptyFields: false }],
    ]);
    expect(emptyShown('Details')).toBe(false);
  });

  it('a stored choice opens the page with the empty fields shown', () => {
    const mem = memoryStore({ opportunity: { showEmptyFields: true } });
    render(
      <Host mem={mem}>
        <Section title="Details" objectName="opportunity" />
      </Host>,
    );
    expect(emptyShown('Details')).toBe(true);
    expect(mem.writes).toEqual([]);
  });

  it('with no store, the toggle stays per section and is gone on unmount', () => {
    const first = render(
      <>
        <Section title="Details" objectName="opportunity" />
        <Section title="Pipeline" objectName="opportunity" />
      </>,
    );
    fireEvent.click(showButton('Details'));
    expect(emptyShown('Details')).toBe(true);
    expect(emptyShown('Pipeline')).toBe(false);
    first.unmount();

    render(<Section title="Details" objectName="opportunity" />);
    expect(emptyShown('Details')).toBe(false);
  });

  it('a section with no object name keeps its own toggle under a store', () => {
    const mem = memoryStore();
    render(
      <Host mem={mem}>
        <div data-testid="Loose">
          <DetailSection section={section('Loose')} data={RECORD} />
        </div>
      </Host>,
    );
    fireEvent.click(showButton('Loose'));
    expect(emptyShown('Loose')).toBe(true);
    expect(mem.writes).toEqual([]);
  });
});
