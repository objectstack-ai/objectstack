/**
 * The identity import's offer and its refusal read ONE constant
 * (objectui#12697).
 *
 * The wizard used to offer "Update existing (skip if no match)" on `sys_user`,
 * a mode `resolveIdentityWriteOptions` refuses, so every row was skipped. The
 * accepted set now lives once, as `IDENTITY_IMPORT_WRITE_MODES` beside the
 * refusal, and `ObjectView` hands that same constant to the wizard as
 * `writeModes`. The pins below fail if either half stops reading it:
 *
 * - the refusal: every write mode is refused exactly when it is outside the
 *   constant;
 * - the offer: the real wizard, driven through the real identity wrapper with
 *   the constant, lists exactly the constant's modes, and each one it lists is
 *   one the refusal lets through;
 * - the host: `ObjectView` passes the constant itself (not a copy of its
 *   values) on the identity branch.
 *
 * `ImportWizard` is imported at module scope rather than through `ObjectView`'s
 * `React.lazy` boundary (AGENTS.md 测试纪律).
 */
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, fireEvent, act, within, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ImportWizard } from '@object-ui/plugin-grid';
import type { ImportWriteMode } from '@object-ui/types';
import {
  createIdentityImportDataSource,
  resolveIdentityWriteOptions,
  IDENTITY_IMPORT_OBJECT,
  IDENTITY_IMPORT_WRITE_MODES,
} from '../identityImport';

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/app-shell/src/views/__tests__  ->  packages/app-shell/src/views
const viewsDir = path.resolve(here, '..');

/** Every write mode the shared import contract names. */
const ALL_MODES: ImportWriteMode[] = ['insert', 'update', 'upsert'];

/** The wizard's English labels, keyed by mode. */
const LABEL: Record<ImportWriteMode, string> = {
  insert: 'Always create new',
  update: 'Update existing (skip if no match)',
  upsert: 'Update if matched, else create',
};

beforeAll(() => {
  // Radix Select reads these on open; happy-dom lacks them.
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = vi.fn(() => false) as any;
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

afterEach(() => cleanup());

function pasteRows(text: string) {
  const evt = new Event('paste', { bubbles: true, cancelable: true }) as Event & {
    clipboardData: { getData: (type: string) => string };
  };
  evt.clipboardData = { getData: (type: string) => (type === 'text/plain' ? text : '') };
  act(() => { window.dispatchEvent(evt); });
}

describe('identity import write modes: one constant for the offer and the refusal (objectui#12697)', () => {
  it('states the identity door’s accepted modes: insert and upsert', () => {
    expect([...IDENTITY_IMPORT_WRITE_MODES]).toEqual(['insert', 'upsert']);
  });

  it('refuses a write mode exactly when the constant leaves it out', () => {
    for (const mode of ALL_MODES) {
      const run = () => resolveIdentityWriteOptions({ writeMode: mode, matchFields: ['email'] });
      if ((IDENTITY_IMPORT_WRITE_MODES as readonly ImportWriteMode[]).includes(mode)) {
        expect(run, mode).not.toThrow();
        expect(run().mode, mode).toBe(mode);
      } else {
        expect(run, mode).toThrow(/write modes only/);
      }
    }
  });

  it('the wizard, given the constant, offers exactly the modes the refusal lets through', async () => {
    const ds = createIdentityImportDataSource({
      base: {},
      authFetch: vi.fn() as any,
      baseUrl: '',
      getPasswordPolicy: () => 'auto',
    });
    render(
      <ImportWizard
        objectName={IDENTITY_IMPORT_OBJECT}
        fields={[{ name: 'email', label: 'Email', type: 'text', required: true }]}
        dataSource={ds as any}
        writeModes={IDENTITY_IMPORT_WRITE_MODES}
        open
        onOpenChange={() => {}}
      />,
    );
    pasteRows('email\na@x.co');
    fireEvent.click(await screen.findByTestId('import-next-btn'));
    const trigger = await screen.findByTestId('import-writemode-select');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const offered = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);

    expect(offered).toEqual(IDENTITY_IMPORT_WRITE_MODES.map((m) => LABEL[m]));
    expect(offered).not.toContain(LABEL.update);
    for (const mode of IDENTITY_IMPORT_WRITE_MODES) {
      expect(() => resolveIdentityWriteOptions({ writeMode: mode, matchFields: ['email'] }), mode).not.toThrow();
    }
  });

  it('ObjectView hands the wizard the constant itself on the identity branch', () => {
    const source = readFileSync(path.join(viewsDir, 'ObjectView.tsx'), 'utf8');
    // The identity-only props spread is where the host tells the wizard about
    // the identity door; the offer must be the refusal's own constant there.
    const spread = source.slice(source.indexOf('{...(identityImportEnabled ? {'));
    const branch = spread.slice(0, spread.indexOf('} : {})}'));
    expect(branch.length).toBeGreaterThan(0);
    expect(branch).toMatch(/\bwriteModes:\s*IDENTITY_IMPORT_WRITE_MODES\b/);
    expect(source).toMatch(/import \{[^}]*\bIDENTITY_IMPORT_WRITE_MODES\b[^}]*\} from '\.\/identityImport\.js';/);
  });
});
