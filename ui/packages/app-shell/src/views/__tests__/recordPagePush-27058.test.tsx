// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27058, Target 8 — one level down on a phone. A related row or a
 * lookup on a record page pushes its record as a page over the current one:
 *
 *  - the bridge navigates to the record route with the `?from=` trail
 *    extended and the history state `recordPagePushState` builds — the parent
 *    page as the way back, the related list's rows as the ↓ ↑ set (a lookup
 *    has none), and the pushed marker; no drawer opens;
 *  - going back to the parent restores where it was scrolled
 *    (`useRecordPageScrollMemory`), and a fresh visit to it does not;
 *  - control: at 1440 px with no drawer host the bridge navigates as before,
 *    with no pushed state.
 *
 * Plus the phone header's rule (`phoneRecordHeader`, Target 4): the subtitle
 * is the first two declared text highlights, the strip at most four more.
 *
 * The bridge cases mount the real `RelatedRecordActionsBridge` with a probe
 * standing in for the related list and the lookup, which reach it through the
 * published `RelatedRecordActionsContext` (the `recordDrawerStack-26679`
 * harness).
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import '@testing-library/jest-dom';
import { useRelatedRecordActions } from '@object-ui/react';

import { RelatedRecordActionsBridge } from '../RelatedRecordActionsBridge';
import { RECORD_PAGE_PUSHED_STATE, isRecordPagePushed, recordPagePushState, useRecordPageScrollMemory } from '../recordPagePush';
import { phoneRecordHeader, PHONE_HIGHLIGHTS_MAX } from '../recordPhoneHeader';
import { decodeRecordTrail } from '../../urlParams';

const APP = 'hotcrm';
const OBJECTS = [
  { name: 'crm_lead', label: 'Lead' },
  { name: 'crm_task', label: 'Task' },
  { name: 'sys_user', label: 'User' },
];
const TASKS = ['T-1', 'T-2'];
const PARENT = `/apps/${APP}/crm_lead/record/L-1`;

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
}

afterEach(() => {
  cleanup();
  setWidth(1440);
});

function RouterLocation() {
  const location = useLocation();
  return (
    <>
      <output data-testid="router-location">{`${location.pathname}${location.search}`}</output>
      <output data-testid="router-state">{JSON.stringify(location.state ?? null)}</output>
    </>
  );
}

function Probe() {
  const actions = useRelatedRecordActions();
  const tasks = actions?.resolve({ objectName: 'crm_task', relationshipField: 'lead', parentId: 'L-1' });
  return (
    <>
      <button type="button" onClick={() => tasks?.onView?.('T-1', { id: 'T-1' }, TASKS)}>
        open task row
      </button>
      <button type="button" onClick={() => actions?.openRecord?.('sys_user', 'U-1')}>
        open owner lookup
      </button>
    </>
  );
}

function mountParent() {
  render(
    <MemoryRouter initialEntries={[`${PARENT}?tab=related`]}>
      <Routes>
        <Route
          path="/apps/:appName/:objectName/record/:recordId"
          element={
            <RelatedRecordActionsBridge
              appName={APP}
              objects={OBJECTS}
              dataSource={null}
              parentObjectName="crm_lead"
              parentRecordId="L-1"
              parentTitle="Mira Costa"
            >
              <Probe />
            </RelatedRecordActionsBridge>
          }
        />
      </Routes>
      <RouterLocation />
    </MemoryRouter>,
  );
}

const routerLocation = () => screen.getByTestId('router-location').textContent ?? '';
const routerState = () => JSON.parse(screen.getByTestId('router-state').textContent ?? 'null');

describe('a related row or a lookup on a phone pushes its record as a page (objectstack#27058)', () => {
  it('a related row: the record route under the extended trail, the parent as its way back, the list\'s rows as ↓ ↑', () => {
    setWidth(390);
    mountParent();
    fireEvent.click(screen.getByText('open task row'));
    const url = new URL(routerLocation(), 'http://x');
    expect(url.pathname).toBe(`/apps/${APP}/crm_task/record/T-1`);
    expect(decodeRecordTrail(url.searchParams.get('from'))).toEqual([{ o: 'crm_lead', i: 'L-1', t: 'Mira Costa' }]);
    expect(routerState()).toEqual({
      from: { pathname: `${PARENT}?tab=related`, label: 'Mira Costa', siblings: TASKS },
      [RECORD_PAGE_PUSHED_STATE]: true,
    });
  });

  it('a lookup: pushed the same way, with no sibling set', () => {
    setWidth(390);
    mountParent();
    fireEvent.click(screen.getByText('open owner lookup'));
    expect(new URL(routerLocation(), 'http://x').pathname).toBe(`/apps/${APP}/sys_user/record/U-1`);
    expect(routerState()).toEqual({
      from: { pathname: `${PARENT}?tab=related`, label: 'Mira Costa' },
      [RECORD_PAGE_PUSHED_STATE]: true,
    });
  });

  it('control: at 1440 px with no drawer host the bridge navigates as before, with no pushed state', () => {
    setWidth(1440);
    mountParent();
    fireEvent.click(screen.getByText('open task row'));
    expect(new URL(routerLocation(), 'http://x').pathname).toBe(`/apps/${APP}/crm_task/record/T-1`);
    expect(routerState()).toBeNull();
  });

  it('recordPagePushState / isRecordPagePushed', () => {
    const state = recordPagePushState({ pathname: '/a', search: '?b=1' }, undefined, [1, 2]);
    expect(state).toEqual({ from: { pathname: '/a?b=1', siblings: ['1', '2'] }, [RECORD_PAGE_PUSHED_STATE]: true });
    expect(isRecordPagePushed(state)).toBe(true);
    expect(isRecordPagePushed({ from: { pathname: '/a' } })).toBe(false);
    expect(isRecordPagePushed(null)).toBe(false);
  });
});

/** A page whose scroller is remembered, with a way to another page and back. */
function ScrollPage() {
  const [scroller, setScroller] = React.useState<HTMLDivElement | null>(null);
  useRecordPageScrollMemory(scroller, true);
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <div ref={setScroller} data-testid="scroller" />
      <output data-testid="page">{location.pathname}</output>
      <button type="button" onClick={() => navigate('/child')}>push</button>
      <button type="button" onClick={() => navigate(-1)}>back</button>
      <button type="button" onClick={() => navigate('/parent')}>fresh</button>
    </>
  );
}

describe('going back to a page restores where it was scrolled (objectstack#27058)', () => {
  it('back restores the parent\'s position; a fresh visit to it starts at the top', async () => {
    render(
      <MemoryRouter initialEntries={['/parent']}>
        <Routes>
          <Route path="*" element={<ScrollPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const scroller = () => screen.getByTestId('scroller');
    scroller().scrollTop = 286;
    fireEvent.scroll(scroller());

    fireEvent.click(screen.getByText('push'));
    expect(screen.getByTestId('page').textContent).toBe('/child');
    scroller().scrollTop = 0;
    fireEvent.scroll(scroller());

    await act(async () => {
      fireEvent.click(screen.getByText('back'));
    });
    expect(screen.getByTestId('page').textContent).toBe('/parent');
    expect(scroller().scrollTop).toBe(286);

    // A new entry for the same page is a new visit: nothing to restore.
    await act(async () => {
      fireEvent.click(screen.getByText('push'));
    });
    scroller().scrollTop = 0;
    await act(async () => {
      fireEvent.click(screen.getByText('fresh'));
    });
    expect(screen.getByTestId('page').textContent).toBe('/parent');
    expect(scroller().scrollTop).toBe(0);
  });
});

describe('the phone header of a default record page (objectstack#27058, Target 4)', () => {
  const def = {
    fields: {
      company: { type: 'text' },
      title: { type: 'text' },
      email: { type: 'email' },
      status: { type: 'select' },
      phone: { type: 'phone' },
      city: { type: 'text' },
      website: { type: 'url' },
    },
  };
  const declared = ['company', 'email', 'title', 'status', 'phone', 'city', 'website'];

  it('the subtitle is the first two declared text highlights, the strip at most four more', () => {
    const header = phoneRecordHeader(def, declared, { company: 'Atlas Construction', title: ' Director of Sales ' });
    expect(header.subtitle).toBe('Atlas Construction · Director of Sales');
    expect(header.highlightFields).toEqual(['email', 'status', 'phone', 'city']);
    expect(header.highlightFields).toHaveLength(PHONE_HIGHLIGHTS_MAX);
  });

  it('a value the reader cannot see adds nothing, and the separator joins only what is there', () => {
    expect(phoneRecordHeader(def, declared, { title: 'Director of Sales' }).subtitle).toBe('Director of Sales');
    expect(phoneRecordHeader(def, declared, {}).subtitle).toBe('');
  });

  it('the array form of an object\'s fields reads the same', () => {
    const arrayDef = { fields: [{ name: 'company', type: 'text' }, { name: 'email', type: 'email' }] };
    expect(phoneRecordHeader(arrayDef, ['email', 'company'], { company: 'Atlas' })).toEqual({
      subtitle: 'Atlas',
      highlightFields: ['email'],
    });
  });

  it('no declared highlights: no subtitle, and the strip is derived as on any width', () => {
    const header = phoneRecordHeader(def, undefined, { company: 'Atlas' });
    expect(header.subtitle).toBe('');
    expect(header.highlightFields.length).toBeLessThanOrEqual(PHONE_HIGHLIGHTS_MAX);
  });
});
