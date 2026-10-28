/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * objectstack#26613 — a `page:tabs` panel's count channel.
 *
 * A tab holding `list-view` blocks is badged with the number of records those
 * blocks' own queries matched: each block reports through
 * `usePageTabCountReporter`, and the badge shows the sum. So the tab can be
 * badged before it is opened, such a tab is mounted while inactive (hidden by
 * its `data-state`); a tab with an authored `count`, or with no list block,
 * keeps mounting on open only.
 *
 * The `list-view` here is a stand-in that reports the count it is handed, so
 * this file pins the strip's half of the channel alone; the real block's half
 * is pinned in plugin-list (`ListViewBlock.cappedPageBlock-26613.test.tsx`).
 *
 * What is pinned:
 *  (a) each tab's badge is its blocks' reported counts, summed, the inactive
 *      tabs included, which are mounted to report;
 *  (b) an authored `count` wins, and its tab is not mounted while inactive;
 *  (c) a tab with no list block is not mounted while inactive;
 *  (d) a block that unmounts withdraws its count;
 *  (e) outside a tab panel the reporter is `undefined`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer } from '@object-ui/react';
import { ComponentRegistry } from '@object-ui/core';
import '../renderers';
import { usePageTabCountReporter } from '../index';

let mounted: string[] = [];
let reporterSeen: Array<boolean> = [];

/** Reports the count it is handed, once mounted, and records that it mounted. */
const ReportingList: React.FC<any> = ({ schema }) => {
  const report = usePageTabCountReporter();
  reporterSeen.push(report !== undefined);
  React.useEffect(() => {
    mounted.push(schema.id);
    if (typeof schema.reportCount === 'number') report?.(schema.reportCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.reportCount]);
  return <div data-testid={`list-${schema.id}`} />;
};
ComponentRegistry.register('list-view', ReportingList, { namespace: 'test', label: 'Reporting list', category: 'view' });

const list = (id: string, reportCount: number) => ({ type: 'list-view', id, properties: { reportCount } });

const triggers = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="tab"]')).map((t) => t.textContent);

afterEach(() => {
  cleanup();
  mounted = [];
  reporterSeen = [];
});

describe('page:tabs badges a tab with its list blocks\' counts (objectstack#26613)', () => {
  it('(a) sums each tab\'s reports, the inactive tabs mounted to report', async () => {
    const { container } = render(
      <SchemaRenderer
        schema={{
          type: 'page:tabs',
          id: 'home_tabs',
          items: [
            { label: 'Leads', value: 'leads', children: [list('leads', 21)] },
            { label: 'Work', value: 'work', children: [list('deals', 8), list('tasks', 3)] },
          ],
        } as never}
      />,
    );
    await waitFor(() => expect(triggers(container)).toEqual(['Leads21', 'Work11']));
    expect(mounted.sort()).toEqual(['deals', 'leads', 'tasks']);
    // The inactive panel is in the tree, marked inactive for its `hidden` class.
    const work = container.querySelector('[role="tabpanel"][data-state="inactive"]');
    expect(work?.className).toContain('data-[state=inactive]:hidden');
  });

  it('(b) an authored count wins, and its tab mounts on open only', async () => {
    const { container } = render(
      <SchemaRenderer
        schema={{
          type: 'page:tabs',
          id: 'home_tabs',
          items: [
            { label: 'Leads', value: 'leads', children: [list('leads', 21)] },
            { label: 'Deals', value: 'deals', count: 99, children: [list('deals', 8)] },
          ],
        } as never}
      />,
    );
    await waitFor(() => expect(triggers(container)).toEqual(['Leads21', 'Deals99']));
    expect(mounted).toEqual(['leads']);
  });

  it('(c) a tab with no list block mounts on open only', async () => {
    let probes = 0;
    const Probe: React.FC = () => {
      React.useEffect(() => {
        probes += 1;
      }, []);
      return null;
    };
    ComponentRegistry.register('test-probe-26613', Probe, { namespace: 'test', label: 'Probe', category: 'view' });
    const { container } = render(
      <SchemaRenderer
        schema={{
          type: 'page:tabs',
          id: 'home_tabs',
          items: [
            { label: 'Leads', value: 'leads', children: [list('leads', 21)] },
            { label: 'Notes', value: 'notes', children: [{ type: 'test-probe-26613', id: 'probe' }] },
          ],
        } as never}
      />,
    );
    await waitFor(() => expect(triggers(container)).toEqual(['Leads21', 'Notes']));
    expect(probes).toBe(0);
  });

  it('(d) a block that unmounts withdraws its count', async () => {
    const schema = (children: unknown[]) => ({
      type: 'page:tabs',
      id: 'home_tabs',
      items: [
        { label: 'Work', value: 'work', children },
        { label: 'Other', value: 'other', children: [] },
      ],
    });
    const view = render(<SchemaRenderer schema={schema([list('deals', 8), list('tasks', 3)]) as never} />);
    await waitFor(() => expect(triggers(view.container)).toEqual(['Work11', 'Other']));
    act(() => {
      view.rerender(<SchemaRenderer schema={schema([list('deals', 8)]) as never} />);
    });
    await waitFor(() => expect(triggers(view.container)).toEqual(['Work8', 'Other']));
  });

  it('(e) outside a tab panel the reporter is undefined', () => {
    render(<SchemaRenderer schema={list('bare', 5) as never} />);
    expect(reporterSeen.length).toBeGreaterThan(0);
    expect(reporterSeen.every((seen) => seen === false)).toBe(true);
  });
});
