// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { SchemaForm } from './SchemaForm';
import { loaded } from './loadState';
import { registerBuiltinAnchors } from './anchors';
import { resolveResourceConfig } from './registry';

afterEach(cleanup);

/**
 * objectui#2325 — render proof. The `action` resource's object-binding field
 * (`objectName`) must mount as a `ref:object` object selector, not a plain text
 * input. Drives SchemaForm with the ACTUAL registry `createSchema` (so it can't
 * drift from what the create page ships) and asserts the rendered control type:
 *
 *   • objectName → the ref:object <Select> trigger (role="combobox")
 *   • name       → a plain text <input> (the contrast that proves the widget
 *                  hint — not the field being a string — is what differentiates)
 *
 * Without the createSchema fix, `objectName` fell through to a text <input>,
 * identical to `name` — the exact symptom the issue reported.
 */
registerBuiltinAnchors();

describe('SchemaForm — action objectName renders as an object selector (#2325)', () => {
  const action = resolveResourceConfig('action');

  function renderActionCreateForm() {
    return render(
      <SchemaForm
        schema={action.createSchema}
        value={{}}
        createMode
        onChange={() => {}}
        widgetContext={{
          // objectui#8167 — required member; `'flattened'` keeps this fixture's
          // subject (the object picker) exactly where it was.
          conditionScope: 'flattened',
          // objectui#5228: the object catalog carries its own load state, so
          // the separate `objectsLoading: false` this fixture used to set is
          // now expressed by the arm itself — a load that COMPLETED.
          objectNames: loaded(['showcase_task', 'showcase_account']),
        }}
      />,
    );
  }

  it('mounts objectName as the ref:object Select (combobox), not a text input', () => {
    renderActionCreateForm();
    const objControl = document.getElementById('mdf-objectName');
    expect(objControl, 'objectName control missing — createSchema not applied?').toBeTruthy();
    // Radix <Select> trigger is a button with role="combobox"; a plain-text
    // fallback would be an <input> (role="textbox").
    expect(objControl?.tagName).toBe('BUTTON');
    expect(objControl?.getAttribute('role')).toBe('combobox');
  });

  it('keeps the name field a plain text input (proves the widget hint is the differentiator)', () => {
    renderActionCreateForm();
    const nameControl = document.getElementById('mdf-name');
    expect(nameControl?.tagName).toBe('INPUT');
    // objectName is the SAME JSON-schema primitive (string) as name — only the
    // `ref:object` widget hint separates them.
    expect(document.getElementById('mdf-objectName')?.tagName).not.toBe('INPUT');
  });
});
