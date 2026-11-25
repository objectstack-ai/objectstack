/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35484 / objectstack#35483 — a record page drawn as written (an
 * authored page with two `record:details` nodes, or a synthesized page that
 * falls back to its `page:tabs` strip) draws the approval band ONCE, as the
 * laid-out page does since objectstack#35253. The host wraps such a page in
 * `ApprovalBandOnceScope`; the first details body that reaches the band's
 * place draws it. The lock rule is untouched: a `lockRecord: false` approval
 * still reads editable, and a first node that draws no band leaves the band
 * to the next. Measured on the body the `record:details` block mounts
 * (`showHeader: false`, inline edit on); the host wiring is pinned in
 * `app-shell/src/views/RecordDetailView.recordOpenRequests-12701.test.tsx`
 * (an authored page, drawn by the same host branch as the tabs fallback).
 * The second describe draws the synthesized page's `page:tabs` fallback
 * through the real renderers (objectstack#35483).
 */

import * as React from 'react';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { InlineEditProvider, RecordContextProvider, SchemaRenderer } from '@object-ui/react';
import '../index';
import { DetailView } from '../DetailView';
import { ApprovalBandOnceScope } from '../defaultRecordPage';
import { buildDefaultPageColumns } from '../synth/recordPageColumns';
import { buildDefaultPageSchema } from '../synth/buildDefaultPageSchema';

/** `useRecordEditable`'s explain probe, answered with its fail-open 501 (the binding suites do the same). */
vi.stubGlobal('fetch', (async () => new Response(null, { status: 501 })) as unknown as typeof globalThis.fetch);

afterEach(cleanup);

const Body = ({ id, showHeader = false }: { id: string; showHeader?: boolean }) => (
  <section data-body={id}>
    <DetailView
      schema={{ type: 'detail-view', objectName: 'quote', showHeader, data: { id: 'Q1', name: 'Q-1' }, sections: [] } as any}
      inlineEdit
      recordFromHost
    />
  </section>
);

const page = (approval: { locked?: boolean; approvalPending?: boolean; canEdit?: boolean }, bodies: React.ReactNode, scoped = true) =>
  render(
    <InlineEditProvider canEdit={approval.canEdit ?? false} locked={approval.locked} approvalPending={approval.approvalPending}>
      {scoped ? <ApprovalBandOnceScope>{bodies}</ApprovalBandOnceScope> : bodies}
    </InlineEditProvider>,
  );

const chipsIn = (container: HTMLElement, text: string) =>
  Array.from(container.querySelectorAll('[data-body]')).filter((body) => body.textContent?.includes(text)).map((b) => b.getAttribute('data-body'));

describe('one approval band on a page drawn as written (objectstack#35484, objectstack#35483)', () => {
  it('two details nodes, a locked record: "Locked for approval" once, on the first node', () => {
    const { container } = page({ locked: true }, <><Body id="a" /><Body id="b" /></>);
    expect(screen.getAllByText('Locked for approval')).toHaveLength(1);
    expect(chipsIn(container, 'Locked for approval')).toEqual(['a']);
  });

  it('CONTROL: the same two nodes outside the scope draw it twice (the defect)', () => {
    page({ locked: true }, <><Body id="a" /><Body id="b" /></>, false);
    expect(screen.getAllByText('Locked for approval')).toHaveLength(2);
  });

  it('CONTROL: one details node under the scope still draws its one band', () => {
    page({ locked: true }, <Body id="a" />);
    expect(screen.getAllByText('Locked for approval')).toHaveLength(1);
  });

  it('a `lockRecord: false` approval reads editable, once — never locked', () => {
    page({ approvalPending: true, locked: false, canEdit: true }, <><Body id="a" /><Body id="b" /></>);
    expect(screen.queryByText('Locked for approval')).toBeNull();
    expect(screen.getAllByText('In approval · editable')).toHaveLength(1);
  });

  it('a first node that draws no band leaves the band to the next node', () => {
    const { container } = page({ locked: true }, <><Body id="a" showHeader /><Body id="b" /><Body id="c" /></>);
    expect(chipsIn(container, 'Locked for approval')).toEqual(['b']);
  });

  it('when the first node leaves, the next one takes the band', () => {
    const { container, rerender } = page({ locked: true }, <><Body id="a" /><Body id="b" /></>);
    expect(chipsIn(container, 'Locked for approval')).toEqual(['a']);
    rerender(
      <InlineEditProvider canEdit={false} locked>
        <ApprovalBandOnceScope>
          <Body id="b" />
        </ApprovalBandOnceScope>
      </InlineEditProvider>,
    );
    // A fresh scope mounts here (the provider tree changed shape), so the
    // remaining node is the first.
    expect(chipsIn(container, 'Locked for approval')).toEqual(['b']);
  });

  it('CONTROL: no approval running draws no band and no stray mark text', () => {
    const { container } = page({}, <><Body id="a" /><Body id="b" /></>);
    expect(screen.queryByText('Locked for approval')).toBeNull();
    expect(container.querySelectorAll('[data-approval-band-mark]').length).toBe(2);
  });
});

/**
 * objectstack#35483 — the synthesized page that falls back to its `page:tabs`
 * strip. `buildDefaultPageColumns` lays out every page the synthesizer writes
 * on its own; a slotted page that places a `page:tabs` node in a strip slot
 * (`highlights` here) carries two strips, which the partition cannot read, so
 * the host draws the page as written, inside `ApprovalBandOnceScope`. Split
 * around a body table, its 概览 tab holds two `record:details` parts: drawn by
 * the real `record:details` and `page:tabs` renderers, the band is drawn once.
 */
describe('one approval band on the synthesized page\'s page:tabs fallback (objectstack#35483)', () => {
  const quote = {
    name: 'quote',
    fields: {
      name: { type: 'text', label: 'Name', group: 'basic' },
      terms: { type: 'textarea', label: 'Terms', group: 'terms' },
    },
    fieldGroups: [{ key: 'basic' }, { key: 'lines', relatedList: 'quote_line_item' }, { key: 'terms' }],
  };
  const SECTIONS = [
    { name: 'basic', label: 'Basic', fields: ['name'] },
    { name: 'terms', label: 'Terms', fields: ['terms'] },
  ];
  const LINES = { objectName: 'quote_line_item', relationshipField: 'quote', title: 'Lines', isPrimary: true };
  const STRIP_TABS = { type: 'page:tabs', properties: { items: [{ label: 'Extra', value: 'extra', children: [] }] } };
  const fallback = (related: unknown[]) =>
    buildDefaultPageSchema(quote as any, { sections: SECTIONS as any, related: related as any, slots: { highlights: [STRIP_TABS] } as any });
  const overviewOf = (page: any) => page.regions[0].components.filter((n: any) => n.type === 'page:tabs').at(-1).properties.items[0].children;
  const DATA = { id: 'Q1', name: 'Q-1', terms: 'net 30' };
  const drawLocked = (page: unknown, scoped = true) =>
    render(
      <InlineEditProvider canEdit={false} locked>
        <RecordContextProvider
          objectName="quote"
          recordId="Q1"
          data={DATA}
          objectSchema={quote as any}
          dataSource={{ find: async () => [], findOne: async () => DATA } as any}
        >
          {scoped ? <ApprovalBandOnceScope><SchemaRenderer schema={page as any} /></ApprovalBandOnceScope> : <SchemaRenderer schema={page as any} />}
        </RecordContextProvider>
      </InlineEditProvider>,
    );
  const marks = () => document.querySelectorAll('[data-approval-band-mark]');

  it('the page cannot be laid out, and its overview holds two details parts around the body table', () => {
    const page = fallback([LINES]);
    expect(buildDefaultPageColumns(page)).toBeNull();
    expect(overviewOf(page).map((n: any) => n.type)).toEqual(['record:details', 'record:related_list', 'record:details']);
  });

  it('two details parts under the host scope: "Locked for approval" once', async () => {
    drawLocked(fallback([LINES]));
    await waitFor(() => expect(marks()).toHaveLength(2));
    expect(screen.getAllByText('Locked for approval')).toHaveLength(1);
  });

  it('CONTROL: the same page outside the scope draws it on each part (what the scope holds)', async () => {
    drawLocked(fallback([LINES]), false);
    await waitFor(() => expect(screen.getAllByText('Locked for approval')).toHaveLength(2));
  });

  it('CONTROL: one details part on the fallback page draws its one band', async () => {
    const page = fallback([]);
    expect(buildDefaultPageColumns(page)).toBeNull();
    expect(overviewOf(page).map((n: any) => n.type)).toEqual(['record:details']);
    drawLocked(page);
    await waitFor(() => expect(marks()).toHaveLength(1));
    expect(screen.getAllByText('Locked for approval')).toHaveLength(1);
  });
});
