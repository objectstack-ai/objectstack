import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { ObjectForm } from './ObjectForm';
import { registerAllFields } from '@object-ui/fields';
import { PreviewModeProvider } from '@object-ui/react';

registerAllFields();
afterEach(cleanup);

const objectSchema = { name: 'proj', fields: { name: { type: 'text', label: 'Name' } } };
const ds: any = {
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  findOne: vi.fn().mockResolvedValue({}),
  create: vi.fn(),
  update: vi.fn(),
};

// Regression guard for the designer freeze: an overlay form (drawer/modal)
// rendered live on a preview surface must NOT mount a portalled, page-locking
// modal. At runtime (no provider) it mounts a real dialog; under
// PreviewModeProvider it renders inline.
describe('Preview mode — overlay forms render inline', () => {
  for (const formType of ['drawer', 'modal'] as const) {
    it(`${formType}: mounts a real overlay dialog at runtime (control)`, async () => {
      render(
        <ObjectForm
          schema={{ type: 'object-form', objectName: 'proj', mode: 'create', formType }}
          dataSource={ds}
        />,
      );
      await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeTruthy());
    });

    it(`${formType}: renders inline with no dialog under PreviewModeProvider`, async () => {
      render(
        <PreviewModeProvider>
          <ObjectForm
            schema={{ type: 'object-form', objectName: 'proj', mode: 'create', formType }}
            dataSource={ds}
          />
        </PreviewModeProvider>,
      );
      // give effects a tick to resolve the object schema
      await waitFor(() => expect(document.body.textContent).toBeDefined());
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    });
  }
});
