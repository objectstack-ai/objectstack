/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The record header's object-label chip carries a host note (objectui#13385).
 *
 * Under the maintainer's ruling on objectui#13385 (option B), a Setup record
 * page draws no floating `ManagedByBadge`; the note it carried rides the
 * header's object label instead, on hover and focus. The host hands the note
 * over as `RecordContext.objectLabelNote`, and `page:header` forwards it to
 * `RecordTitleChip.objectLabelNote`.
 *
 * - CONTROL: without a note the label draws exactly as before — the same
 *   element, the same classes, no focus stop, no tooltip trigger.
 * - With a note the label is a focusable tooltip trigger, described by the
 *   note, and focusing it opens a tooltip reading "<label> · <note>".
 * - A note with no label draws nothing of its own.
 * - `PageHeaderRenderer` forwards the note from the record context, and draws
 *   no note when the context carries none.
 *
 * Direction, written before the run: with `RecordTitleChip` drawing the plain
 * label whatever the prop, every "with a note" case goes RED and the CONTROL
 * cases stay GREEN; with the `objectLabelNote` forward removed from
 * `PageHeaderRenderer`, only the forwarding case goes RED.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { ActionProvider, RecordContextProvider } from '@object-ui/react';
import { RecordTitleChip } from '../custom/RecordTitleChip';
// Registers `page:header` (the renderer under test) at module scope.
import '../renderers/layout/containers';

afterEach(() => cleanup());

const NOTE = 'Managed by the identity provider';

/** The plain label exactly as `RecordTitleChip` drew it before objectui#13385. */
const PLAIN_LABEL_HTML =
  '<span class="text-xs font-medium tracking-wide text-muted-foreground/70 shrink-0">Organization</span>';

function plainLabel(container: HTMLElement) {
  return Array.from(container.querySelectorAll('span')).find((s) => s.textContent === 'Organization');
}

describe('RecordTitleChip — the object label carries a host note (objectui#13385)', () => {
  it('CONTROL — without a note the label draws exactly as before', () => {
    const { container } = render(<RecordTitleChip title="Default Organization" objectLabel="Organization" />);

    expect(plainLabel(container)?.outerHTML).toBe(PLAIN_LABEL_HTML);
    expect(container.querySelector('[data-object-label-note]')).toBeNull();
    expect(container.querySelector('[tabindex]')).toBeNull();
    expect(container.querySelector('[aria-describedby]')).toBeNull();
  });

  it('with a note the label is a focusable trigger described by the note', () => {
    const { container } = render(
      <RecordTitleChip title="Default Organization" objectLabel="Organization" objectLabelNote={NOTE} />,
    );
    const trigger = container.querySelector<HTMLElement>('[data-object-label-note]');

    expect(trigger?.textContent).toBe('Organization');
    expect(trigger?.tabIndex).toBe(0);
    const describedBy = trigger?.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)?.textContent).toBe(NOTE);
  });

  it('focusing the label opens a tooltip reading "<label> · <note>"', async () => {
    const { container } = render(
      <RecordTitleChip title="Default Organization" objectLabel="Organization" objectLabelNote={NOTE} />,
    );
    const trigger = container.querySelector<HTMLElement>('[data-object-label-note]')!;

    fireEvent.focus(trigger);

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toBe(`Organization · ${NOTE}`);
  });

  it('a note with no label draws nothing of its own', () => {
    const { container } = render(<RecordTitleChip title="Default Organization" objectLabelNote={NOTE} />);

    expect(container.querySelector('[data-object-label-note]')).toBeNull();
    expect(container.textContent).not.toContain(NOTE);
  });
});

function renderRecordHeader(objectLabelNote?: string) {
  const Header = ComponentRegistry.get('page:header');
  if (!Header) throw new Error('page:header not registered');
  return render(
    <ActionProvider>
      <RecordContextProvider
        objectName="sys_organization"
        recordId="O1"
        data={{ id: 'O1', name: 'Default Organization' }}
        objectSchema={{ name: 'sys_organization', label: 'Organization', fields: { name: { type: 'text' } } }}
        objectLabelNote={objectLabelNote}
      >
        <Header schema={{ type: 'page:header' }} />
      </RecordContextProvider>
    </ActionProvider>,
  );
}

describe('PageHeaderRenderer — forwards RecordContext.objectLabelNote to the chip (objectui#13385)', () => {
  it('the record header’s object label carries the note the context holds', () => {
    const { container } = renderRecordHeader(NOTE);
    const trigger = container.querySelector<HTMLElement>('[data-object-label-note]');

    expect(trigger?.textContent).toBe('Organization');
    expect(document.getElementById(trigger!.getAttribute('aria-describedby')!)?.textContent).toBe(NOTE);
  });

  it('CONTROL — a context with no note draws the plain label', () => {
    const { container } = renderRecordHeader(undefined);

    expect(container.querySelector('[data-object-label-note]')).toBeNull();
    expect(plainLabel(container)?.outerHTML).toBe(PLAIN_LABEL_HTML);
  });
});
