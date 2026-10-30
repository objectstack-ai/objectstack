// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#27521 (Studio row 30) — a node card names the object it works
 * on by the object's label.
 *
 * A record-triggered flow's Start card read `START field_service_work_…`, the
 * API name cut at the card's width; the Update Records card did the same. The
 * host hands the canvas the object catalog's labels, and a card whose object
 * has one reads it. An object the catalog does not label keeps its name.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FlowCanvas } from './FlowCanvas';
import type { FlowDesignerEdge, FlowDesignerNode } from './flow-canvas-layout';

// The palette's engine overlay answers "engine absent", so no read reaches a socket.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('not found', { status: 404 })),
);

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const nodes: FlowDesignerNode[] = [
  { id: 'start', type: 'start', label: 'Start', config: { objectName: 'field_service_work_order' } },
  { id: 'upd', type: 'update_record', label: 'Close order', config: { objectName: 'field_service_visit' } },
  { id: 'end', type: 'end', label: 'End' },
];
const edges: FlowDesignerEdge[] = [
  { id: 'e1', source: 'start', target: 'upd' },
  { id: 'e2', source: 'upd', target: 'end' },
];

const summaries = () => Array.from(document.querySelectorAll('span[title]')).map((el) => el.textContent);

describe('FlowCanvas · node cards name objects by label (objectstack#27521)', () => {
  it('the Start and Update cards read the object labels the host hands in', () => {
    render(
      <FlowCanvas
        nodes={nodes}
        edges={edges}
        editable={false}
        designMode={false}
        selectedId={null}
        onSelect={() => {}}
        objectLabels={new Map([['field_service_work_order', 'Work Order']])}
      />,
    );
    expect(screen.getByTitle('Work Order')).toHaveTextContent('Work Order');
    expect(summaries()).not.toContain('field_service_work_order');
    // An object the catalog does not label keeps its name.
    expect(screen.getByTitle('field_service_visit')).toHaveTextContent('field_service_visit');
  });

  it('CONTROL — with no catalog the cards keep the API names', () => {
    render(<FlowCanvas nodes={nodes} edges={edges} editable={false} designMode={false} selectedId={null} onSelect={() => {}} />);
    expect(screen.getByTitle('field_service_work_order')).toBeTruthy();
  });
});
