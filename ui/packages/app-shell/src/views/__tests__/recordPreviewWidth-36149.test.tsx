// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36149 — one remembered width for the side preview of every
 * object: a width the reader drags in one object's preview is the width the
 * next preview opens at, whatever its object, on both hosts that draw it (the
 * list's `ObjectViewRecordOverlay` and a record page's `RecordPageDrawerHost`).
 *
 * Control: an object that authors its drawer's width (a `navigation.size`
 * other than `auto`, or a pixel `navigation.width`) never takes the shared
 * width. It remembers only a width dragged in its own pane, under its own
 * per-object key.
 */

import * as React from 'react';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';
import { recordOverlayWidthStorageKey } from '@object-ui/components';

vi.mock('../RecordDetailView.js', () => ({
  RecordDetailView: ({ objectNameOverride, recordIdOverride }: { objectNameOverride?: string; recordIdOverride?: string }) => (
    <div data-testid="record-body">{`${objectNameOverride}/${recordIdOverride}`}</div>
  ),
}));

import { ObjectViewRecordOverlay } from '../objectViewRecordOverlay';
import { RecordPageDrawerHost } from '../recordDrawerStack';
import { RECORD_PREVIEW_WIDTH_KEY, recordPreviewWidthKey, useRecordDrawer } from '../recordDrawerContext';

const OBJECTS = [
  { name: 'crm_lead', label: 'Lead' },
  { name: 'crm_task', label: 'Task' },
  { name: 'crm_contract', label: 'Contract', navigation: { width: 720 } },
];

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const drawerWidth = () =>
  (document.querySelector('[data-record-drawer-card]') as HTMLElement | null)?.style.getPropertyValue('--ov-w').trim();

/** The list's preview of `objectName`'s record `recordId`. */
function mountListPreview(objectName: string, recordId: string, widthKey?: string) {
  return render(
    <MemoryRouter initialEntries={[`/apps/crm/${objectName}`]}>
      <Routes>
        <Route
          path="/apps/:appName/:objectName"
          element={
            <ObjectViewRecordOverlay
              navOverlay={{ isOpen: true, width: 'min(92vw, 460px)' } as any}
              mode="drawer"
              {...(widthKey ? { widthKey } : {})}
              list={<div data-testid="list" />}
              handleDrawerClose={() => {}}
              objectDef={OBJECTS.find((o) => o.name === objectName) as any}
              handleOpenAsPage={(() => {}) as any}
              drawerRoot={{ objectName, recordId }}
              drawerRestore={undefined}
              handleRootStep={() => {}}
              dataSource={{} as any}
              objects={OBJECTS as any}
              onEdit={() => {}}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** Drag the open pane's edge so it is `px` wide (the pane is right-anchored at the window's edge). */
function dragTo(px: number) {
  const handle = screen.getByRole('separator');
  act(() => {
    fireEvent.mouseDown(handle);
    fireEvent.mouseMove(window, { clientX: window.innerWidth - px });
    fireEvent.mouseUp(window);
  });
}

function OpenButton({ objectName, recordId }: { objectName: string; recordId: string }) {
  const drawer = useRecordDrawer();
  return (
    <button type="button" onClick={() => drawer?.open(objectName, recordId)}>
      {`open ${objectName}`}
    </button>
  );
}

function RecordPage() {
  const location = useLocation();
  const [, objectName, , recordId] = location.pathname.split('/').slice(2);
  return (
    <RecordPageDrawerHost
      appName="crm"
      objects={OBJECTS}
      pageObjectName={objectName}
      pageRecordId={recordId}
      pageTitle={undefined}
      renderRecord={(l) => <div data-testid="record-body">{`${l.objectName}/${l.recordId}`}</div>}
    >
      <OpenButton objectName="crm_task" recordId="T-1" />
      <OpenButton objectName="crm_contract" recordId="K-1" />
    </RecordPageDrawerHost>
  );
}

function mountRecordPage() {
  return render(
    <MemoryRouter initialEntries={['/apps/crm/crm_account/record/A-1']}>
      <Routes>
        <Route path="/apps/:appName/:objectName/record/:recordId" element={<RecordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('the side preview has one remembered width for every object (objectstack#36149)', () => {
  it("a width dragged in one object's list preview is the width another object's list preview opens at", () => {
    const first = mountListPreview('crm_lead', 'L-1');
    expect(drawerWidth()).toBe('min(92vw, 460px)');
    dragTo(640);
    expect(drawerWidth()).toBe('640px');
    expect(window.localStorage.getItem(`ov:${RECORD_PREVIEW_WIDTH_KEY}`)).toBe('640');
    first.unmount();

    mountListPreview('crm_task', 'T-1');
    expect(drawerWidth()).toBe('640px');
  });

  it("a record page's drawer opens another object's record at the width dragged in a list preview", () => {
    const first = mountListPreview('crm_lead', 'L-1');
    dragTo(600);
    first.unmount();

    mountRecordPage();
    fireEvent.click(screen.getByRole('button', { name: 'open crm_task' }));
    expect(screen.getByTestId('record-body')).toHaveTextContent('crm_task/T-1');
    expect(drawerWidth()).toBe('600px');
  });

  it("CONTROL: an object that authors its drawer's width opens at it, not at the shared width", () => {
    window.localStorage.setItem(`ov:${RECORD_PREVIEW_WIDTH_KEY}`, '600');
    mountRecordPage();
    fireEvent.click(screen.getByRole('button', { name: 'open crm_contract' }));
    expect(screen.getByTestId('record-body')).toHaveTextContent('crm_contract/K-1');
    expect(drawerWidth()).toBe('720px');
    // A drag in its own pane is remembered under its own key, never the shared one.
    dragTo(500);
    expect(window.localStorage.getItem(`ov:${recordOverlayWidthStorageKey('crm_contract')}`)).toBe('500');
    expect(window.localStorage.getItem(`ov:${RECORD_PREVIEW_WIDTH_KEY}`)).toBe('600');
  });

  it('CONTROL: the list preview of an object whose view authors a size keeps its own key', () => {
    window.localStorage.setItem(`ov:${RECORD_PREVIEW_WIDTH_KEY}`, '600');
    mountListPreview('crm_lead', 'L-1', recordPreviewWidthKey('crm_lead', { size: 'xl' }));
    expect(drawerWidth()).toBe('min(92vw, 460px)');
  });

  it('recordPreviewWidthKey: the shared key unless a size other than auto, or a width, is authored', () => {
    expect(recordPreviewWidthKey('crm_lead', undefined)).toBe(RECORD_PREVIEW_WIDTH_KEY);
    expect(recordPreviewWidthKey('crm_lead', {})).toBe(RECORD_PREVIEW_WIDTH_KEY);
    expect(recordPreviewWidthKey('crm_lead', { size: 'auto' })).toBe(RECORD_PREVIEW_WIDTH_KEY);
    expect(recordPreviewWidthKey('crm_lead', { size: 'xl' })).toBe(recordOverlayWidthStorageKey('crm_lead'));
    expect(recordPreviewWidthKey('crm_lead', { width: 720 })).toBe(recordOverlayWidthStorageKey('crm_lead'));
  });
});
