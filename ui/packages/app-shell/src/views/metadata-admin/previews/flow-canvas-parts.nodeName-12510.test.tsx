// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12510 — a flow node's button is named by what the card shows: the
 * node's label, then its kind.
 *
 * The 2026-10-15 test pass read the Start and End nodes as buttons with no
 * name. The browser's computed tree on that canvas names them "Start START
 * crm_campaign" and "End END" (label, kind, summary). This pins the name by
 * role, for the two nodes the pass named and a labelled middle node, so a
 * restyle that drops the text from the tree turns it red.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { NodeCard } from './flow-canvas-parts';

afterEach(cleanup);

function node(type: string, label: string, summary?: string) {
  render(
    <NodeCard
      id="n"
      type={type}
      label={label}
      summary={summary}
      locale="en-US"
      position={{ x: 0, y: 0 }}
      selected={false}
      editable={false}
    />,
  );
}

describe('a flow node button carries its label and kind as its name (objectui#12510)', () => {
  it('names the Start node by its label, then its kind and summary', () => {
    node('start', 'Start', 'crm_campaign');
    expect(screen.getByRole('button', { name: /^Start\b/ })).toHaveAccessibleName(/^Start\s+Start\s+crm_campaign$/i);
  });

  it('names the End node by its label and kind', () => {
    node('end', 'End');
    expect(screen.getByRole('button', { name: /^End\b/ })).toHaveAccessibleName(/^End\s+End$/i);
  });

  it('a labelled middle node leads with the label the author wrote', () => {
    node('decision', 'Campaign Open?');
    expect(screen.getByRole('button', { name: /^Campaign Open\?/ })).toHaveAccessibleName(/Decision/i);
  });
});
