/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#36733 — a state-machine row's "Next states" box takes a typed
 * comma.
 *
 * The box used to show the parsed targets on every keystroke, so a typed `,`
 * (and the space after it) was dropped on re-render and a second target could
 * not be typed in. The box now keeps its own text while it is being edited and
 * writes the parsed targets on each change; on blur it shows the targets.
 *
 * The harness feeds every `onPatch` back into `draft`, as the Data pillar does.
 */

// The panel reaches a dynamic `import()` of each module below: its first load
// is paid here, at collection, never inside a case's clocked window
// (`check:test-source-alias`).
import '@objectstack/formula';
import '@objectstack/lint';
import '@object-ui/core';
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ValidationRuleSchema } from '@objectstack/spec/data';

import { ObjectValidationsPanel } from './ObjectValidationsPanel';
import { t } from '../metadata-admin/i18n';

afterEach(() => cleanup());

const rule = {
  type: 'state_machine',
  name: 'status_flow',
  message: 'Bad move',
  field: 'status',
  transitions: { open: [] as string[], paused: ['open', ''] },
};

const draft: Record<string, unknown> = {
  name: 'ticket',
  label: 'Ticket',
  fields: { status: { type: 'select', label: 'Status' } },
  validations: [rule],
};

function Harness({ onPatch }: { onPatch: (p: Record<string, unknown>) => void }) {
  const [d, setD] = React.useState(draft);
  return (
    <ObjectValidationsPanel
      draft={d}
      onPatch={(p) => {
        onPatch(p);
        setD((prev) => ({ ...prev, ...p }));
      }}
    />
  );
}

function lastTransitions(onPatch: ReturnType<typeof vi.fn>): Record<string, string[]> {
  const calls = onPatch.mock.calls;
  const written = (calls[calls.length - 1][0].validations as Array<Record<string, unknown>>)[0];
  expect(ValidationRuleSchema.safeParse(written).success).toBe(true);
  return written.transitions as Record<string, string[]>;
}

const nextStates = () => screen.getAllByPlaceholderText(t('engine.studio.rules.transitionTo', 'en-US'));

/** Type `text` into the box one key at a time, as a browser delivers it. */
function typeKeyByKey(box: HTMLElement, text: string) {
  fireEvent.focus(box);
  for (const ch of text) {
    const el = box as HTMLInputElement;
    fireEvent.change(el, { target: { value: el.value + ch } });
  }
}

describe('a state-machine row\'s "Next states" box takes a typed comma (objectstack#36733)', () => {
  it("typing 'done, closed' key by key writes the targets ['done', 'closed']", () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);

    typeKeyByKey(nextStates()[0], 'done, closed');
    expect(nextStates()[0]).toHaveValue('done, closed');
    expect(lastTransitions(onPatch).open).toEqual(['done', 'closed']);

    // Off the box, it shows the targets it wrote.
    fireEvent.blur(nextStates()[0]);
    expect(nextStates()[0]).toHaveValue('done, closed');
    expect(lastTransitions(onPatch)).toEqual({ open: ['done', 'closed'], paused: ['open', ''] });
  });

  it("typing into a row that may be cleared keeps its '' target", () => {
    const onPatch = vi.fn();
    render(<Harness onPatch={onPatch} />);

    typeKeyByKey(nextStates()[1], ', closed');
    expect(lastTransitions(onPatch).paused).toEqual(['open', 'closed', '']);
  });
});
