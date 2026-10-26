/**
 * The wizard offers only the write modes its host says the target accepts
 * (objectui#12697).
 *
 * The identity import door accepts `insert` and `upsert` only, yet the wizard
 * rendered all three modes for every target, so choosing "Update existing"
 * on `sys_user` skipped every row with a refusal. `ImportWizardProps.writeModes`
 * is the host's channel: left out, all three are offered (every other object);
 * set, the select lists only those, and a saved mapping writing in a mode
 * outside it is listed disabled with its mode named — never applied, and never
 * swapped for another mode behind the user's back.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

import { ImportWizard } from '../ImportWizard';
import type { SavedMapping } from '../savedMapping';

beforeAll(() => {
  // Radix Select reads these on open; happy-dom lacks them.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const FIELDS = [
  { name: 'email', label: 'Email', type: 'text', required: true },
  { name: 'name', label: 'Name', type: 'text' },
];

/** Paste TSV into the upload step via the wizard's window-level handler. */
function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

/** Open a Radix select and return the option rows it portals in. */
async function openSelect(testId: string) {
  const trigger = screen.getByTestId(testId);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  const listbox = await screen.findByRole('listbox');
  return within(listbox).getAllByRole('option');
}

async function toPreview() {
  pasteRows('email\tname\na@x.co\tAda');
  const next = await screen.findByTestId('import-next-btn');
  fireEvent.click(next);
  return screen.findByTestId('import-writemode-select');
}

function renderWizard(props: Partial<React.ComponentProps<typeof ImportWizard>> = {}) {
  return render(
    <ImportWizard
      objectName="contact"
      fields={FIELDS}
      dataSource={{}}
      open
      onOpenChange={() => {}}
      {...props}
    />,
  );
}

describe('ImportWizard write modes follow the host (objectui#12697)', () => {
  it('offers all three modes when the host names no set', async () => {
    renderWizard();
    await toPreview();
    const options = await openSelect('import-writemode-select');
    expect(options.map((o) => o.textContent)).toEqual([
      'Always create new',
      'Update existing (skip if no match)',
      'Update if matched, else create',
    ]);
  });

  it('offers only the modes the host passes, starting in insert', async () => {
    renderWizard({ writeModes: ['insert', 'upsert'] });
    const trigger = await toPreview();
    expect(trigger).toHaveTextContent('Always create new');
    const options = await openSelect('import-writemode-select');
    expect(options.map((o) => o.textContent)).toEqual([
      'Always create new',
      'Update if matched, else create',
    ]);
  });

  it('starts in the first offered mode when the host does not offer insert', async () => {
    renderWizard({ writeModes: ['upsert'] });
    const trigger = await toPreview();
    expect(trigger).toHaveTextContent('Update if matched, else create');
  });

  it('throws on an empty set — a host error, not an empty select', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => renderWizard({ writeModes: [] })).toThrow(/writeModes/);
    } finally {
      errorSpy.mockRestore();
    }
  });

  describe('a saved mapping whose mode the target refuses', () => {
    const UPDATER: SavedMapping = {
      name: 'roster_update',
      label: 'Roster update',
      targetObject: 'contact',
      fieldMapping: [{ source: 'email', target: 'email' }],
      mode: 'update',
      upsertKey: ['email'],
    };
    const INSERTER: SavedMapping = {
      name: 'roster_insert',
      label: 'Roster insert',
      targetObject: 'contact',
      fieldMapping: [{ source: 'email', target: 'email' }],
      mode: 'insert',
    };

    it('is listed disabled, its mode named, and picking it applies nothing', async () => {
      renderWizard({ writeModes: ['insert', 'upsert'], savedMappings: [UPDATER, INSERTER] });
      pasteRows('email\tname\na@x.co\tAda');
      await screen.findByTestId('import-saved-mapping-bar');

      const options = await openSelect('import-saved-mapping-select');
      const refused = screen.getByTestId('import-saved-mapping-option-roster_update');
      const accepted = screen.getByTestId('import-saved-mapping-option-roster_insert');
      expect(options).toContain(refused);
      expect(refused).toHaveAttribute('aria-disabled', 'true');
      expect(refused).toHaveTextContent('Roster update (Update existing (skip if no match))');
      expect(accepted).not.toHaveAttribute('aria-disabled');
      expect(accepted).toHaveTextContent(/^Roster insert$/);

      // The accepted one is the only applicable mapping, so the wizard opened
      // with it applied (objectui#13343); the refused one does not count.
      const before = screen.getByTestId('import-saved-mapping-summary');
      expect(before).toHaveTextContent('Roster insert');

      // A disabled Radix item ignores the pick: the refused mapping never
      // becomes active, so the summary (the read-only artifact view) still
      // shows the accepted one and never the refused one.
      fireEvent.click(refused);
      const after = screen.getByTestId('import-saved-mapping-summary');
      expect(after).toHaveTextContent('Roster insert');
      expect(after).not.toHaveTextContent('Roster update');
      expect(screen.getByTestId('import-saved-mapping-select')).toHaveTextContent(/^Roster insert$/);
    });

    it('stays selectable on a target that accepts its mode', async () => {
      renderWizard({ savedMappings: [UPDATER] });
      pasteRows('email\tname\na@x.co\tAda');
      await screen.findByTestId('import-saved-mapping-bar');
      await openSelect('import-saved-mapping-select');
      const option = screen.getByTestId('import-saved-mapping-option-roster_update');
      expect(option).not.toHaveAttribute('aria-disabled');
      expect(option).toHaveTextContent(/^Roster update$/);
    });
  });
});
