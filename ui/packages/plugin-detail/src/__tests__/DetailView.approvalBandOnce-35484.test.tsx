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
 * `app-shell/src/views/RecordDetailView.approvalBandOnce-35484.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { InlineEditProvider } from '@object-ui/react';
import { DetailView } from '../DetailView';
import { ApprovalBandOnceScope } from '../defaultRecordPage';

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
