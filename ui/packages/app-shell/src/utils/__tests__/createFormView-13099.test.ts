/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The create entry uses the object's `create` form view when it declares one
 * (objectui#13099, ruling B′ on objectstack-ai/objectstack#24692).
 *
 * The documented create-vs-edit model (`content/docs/ui/create-vs-edit-form.mdx`
 * in objectstack) authors a sparse `formViews.create` on the view container
 * beside the full default `form`. A container's named form view is SERVED as
 * the form item `OBJECT.create` (`expandViewContainer` in
 * `@objectstack/spec/ui`), and `MetadataProvider` keys `formViews` by that
 * served name — so the fixtures below are served rows run through the real
 * merge, the `showcase_contact` shape, not a hand-built object.
 *
 *   (a) a create selects the `create` form view's layout;
 *   (b) an edit of the same object keeps the default form view, unchanged;
 *   (c) CONTROL: an object with no `create` form view creates with
 *       `form ?? formViews.default`, as before — and no OTHER named form view
 *       is ever picked for a create.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveFormViewLayout,
  resolveRecordFormModalLayout,
  selectRecordFormView,
} from '../recordFormNavigation';
import { mergeViewsIntoObjects } from '../../providers/MetadataProvider';

const row = (object: string, key: string, config: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  name: `${object}.${key}`,
  object,
  viewKind: 'form' as const,
  label: config.label,
  config,
  scope: 'package',
  ...extra,
});

const QUICK = [{ name: 'quick', label: 'Quick add', fields: [{ field: 'first_name' }, { field: 'email' }] }];
const IDENTITY = [
  { name: 'identity', label: 'Identity', fields: [{ field: 'first_name' }, { field: 'email' }] },
  { name: 'notes', label: 'Notes', fields: [{ field: 'notes' }] },
];

// examples/app-showcase `showcase_contact`: the named `create` form, then the
// container's own `form`, the one default — in the order the expansion serves them.
const contact = mergeViewsIntoObjects(
  [{ name: 'showcase_contact', fields: {} }],
  [
    row('showcase_contact', 'create', { type: 'simple', sections: QUICK, modalSize: 'sm' }, { order: 1 }),
    row('showcase_contact', 'form', { type: 'tabbed', sections: IDENTITY }, { order: 2, isDefault: true }),
  ],
)[0];

const names = (sections: Array<{ name?: string }> | undefined) => sections?.map((s) => s.name);

describe('the create entry uses the `create` form view when declared (objectui#13099)', () => {
  it('(a) a create selects the `create` form view: its sections, layout and size', () => {
    expect(names(resolveFormViewLayout(contact, 'create').sections)).toEqual(['quick']);
    expect(resolveFormViewLayout(contact, 'create')).toStrictEqual({ sections: QUICK, modalSize: 'sm' });
    // The console's create modal (AppContent) goes through this resolver.
    expect(resolveRecordFormModalLayout(contact, 'auto', 'create')).toStrictEqual({ sections: QUICK, modalSize: 'sm' });
    expect(selectRecordFormView(contact, 'create')).toBe(contact.formViews['showcase_contact.create']);
  });

  it('(b) an edit of the same object keeps the default form view, unchanged', () => {
    expect(resolveFormViewLayout(contact, 'edit')).toStrictEqual({ sections: IDENTITY, contentLayout: 'tabbed' });
    expect(resolveRecordFormModalLayout(contact, 'auto', 'edit')).toStrictEqual({ sections: IDENTITY, contentLayout: 'tabbed' });
    // A caller that names no flow gets the default form view, as before.
    expect(resolveFormViewLayout(contact)).toStrictEqual(resolveFormViewLayout(contact, 'edit'));
    expect(selectRecordFormView(contact, 'edit')).toBe(contact.form);
  });

  it('(c) CONTROL: no `create` form view — a create takes `form ?? formViews.default`, as before', () => {
    const lead = mergeViewsIntoObjects(
      [{ name: 'crm_lead', fields: {} }],
      [
        row('crm_lead', 'web_to_lead', { type: 'simple', sections: QUICK }, { order: 1 }),
        row('crm_lead', 'form', { type: 'simple', sections: IDENTITY }, { order: 2, isDefault: true }),
      ],
    )[0];
    // The named Web-to-Lead form is never picked for a create.
    expect(resolveFormViewLayout(lead, 'create')).toStrictEqual({ sections: IDENTITY });
    expect(resolveFormViewLayout(lead, 'create')).toStrictEqual(resolveFormViewLayout(lead, 'edit'));

    // The legacy container shape (`formViews.default`) is still the create fallback.
    const legacy = { name: 'project', formViews: { default: { type: 'simple', sections: IDENTITY } } };
    expect(resolveFormViewLayout(legacy, 'create')).toStrictEqual({ sections: IDENTITY });

    // A named-only object (no default, no `create`) creates with no layout.
    const inquiry = mergeViewsIntoObjects(
      [{ name: 'showcase_inquiry', fields: {} }],
      [row('showcase_inquiry', 'contact', { type: 'simple', sections: QUICK }, { order: 1 })],
    )[0];
    expect(resolveFormViewLayout(inquiry, 'create')).toStrictEqual({});
  });
});
