/**
 * Tests for resolveRecordFormTarget — the modal-vs-page decision used by
 * `AppContent.handleEdit` when the user clicks "Create" or "Edit" on a
 * record. Covers:
 *   - default (no editMode) → modal
 *   - editMode: 'modal' → modal (explicit opt-out)
 *   - editMode: 'page' + null/undefined record → create URL
 *   - editMode: 'page' + record with id → edit URL
 *   - editMode: 'page' + record with _id (Mongo-style) → edit URL
 *   - URL encoding of record ids that contain reserved characters
 *   - missing objectDef → modal (defensive fallback)
 */

import { describe, it, expect } from 'vitest';
import {
  resolveRecordFormTarget,
  resolveFormViewLayout,
  resolveNavigateCreateUrl,
  resolveNavigateEditUrl,
  resolvePostCreateTarget,
  recordFormCreateValues,
  readRecordFormCreateValues,
  RECORD_FORM_CREATE_VALUES_STATE,
} from '../recordFormNavigation';

describe('resolveRecordFormTarget', () => {
  const baseUrl = '/apps/sales';

  it('returns modal when editMode is unset (default)', () => {
    expect(
      resolveRecordFormTarget({
        objectDef: { name: 'account' },
        baseUrl,
        record: null,
      }),
    ).toEqual({ kind: 'modal' });
  });

  it('returns modal when editMode is explicitly "modal"', () => {
    expect(
      resolveRecordFormTarget({
        objectDef: { name: 'account', editMode: 'modal' },
        baseUrl,
        record: { id: 'r1' },
      }),
    ).toEqual({ kind: 'modal' });
  });

  it('returns the create URL when editMode is "page" and no record is provided', () => {
    expect(
      resolveRecordFormTarget({
        objectDef: { name: 'account', editMode: 'page' },
        baseUrl,
        record: null,
      }),
    ).toEqual({ kind: 'page', url: '/apps/sales/account/new' });
  });

  it('returns the edit URL when editMode is "page" and record has id', () => {
    expect(
      resolveRecordFormTarget({
        objectDef: { name: 'account', editMode: 'page' },
        baseUrl,
        record: { id: 'r1' },
      }),
    ).toEqual({ kind: 'page', url: '/apps/sales/account/record/r1/edit' });
  });

  it('falls back to record._id (Mongo-style) when id is missing', () => {
    expect(
      resolveRecordFormTarget({
        objectDef: { name: 'account', editMode: 'page' },
        baseUrl,
        record: { _id: 'mongo-7' },
      }),
    ).toEqual({ kind: 'page', url: '/apps/sales/account/record/mongo-7/edit' });
  });

  it('URL-encodes record ids with reserved characters', () => {
    expect(
      resolveRecordFormTarget({
        objectDef: { name: 'account', editMode: 'page' },
        baseUrl,
        record: { id: 'a/b c' },
      }),
    ).toEqual({
      kind: 'page',
      url: '/apps/sales/account/record/a%2Fb%20c/edit',
    });
  });

  it('treats an empty-string id as create-mode', () => {
    expect(
      resolveRecordFormTarget({
        objectDef: { name: 'account', editMode: 'page' },
        baseUrl,
        record: { id: '' },
      }),
    ).toEqual({ kind: 'page', url: '/apps/sales/account/new' });
  });

  it('treats numeric ids correctly', () => {
    expect(
      resolveRecordFormTarget({
        objectDef: { name: 'account', editMode: 'page' },
        baseUrl,
        record: { id: 42 },
      }),
    ).toEqual({ kind: 'page', url: '/apps/sales/account/record/42/edit' });
  });

  it('returns modal when objectDef is missing (defensive fallback)', () => {
    expect(
      resolveRecordFormTarget({
        objectDef: null,
        baseUrl,
        record: { id: 'r1' },
      }),
    ).toEqual({ kind: 'modal' });
  });

  it('returns modal when objectDef has no name', () => {
    expect(
      resolveRecordFormTarget({
        objectDef: { name: '', editMode: 'page' },
        baseUrl,
        record: { id: 'r1' },
      }),
    ).toEqual({ kind: 'modal' });
  });
});

// objectui#12291 — a NEW record (no id) that carries values is a create
// seeded with them: the calendar's empty-day hand-off sends the clicked day.
describe('recordFormCreateValues (objectui#12291)', () => {
  it('returns the values a record without an id carries', () => {
    expect(recordFormCreateValues({ due_date: '2026-10-20' })).toEqual({ due_date: '2026-10-20' });
  });

  it('treats an empty-string id as a new record, and never carries the id keys', () => {
    expect(recordFormCreateValues({ id: '', _id: '', due_date: '2026-10-20' })).toEqual({ due_date: '2026-10-20' });
  });

  it('carries nothing for an existing record (it has an id or an _id)', () => {
    expect(recordFormCreateValues({ id: 'r1', due_date: '2026-10-20' })).toBeUndefined();
    expect(recordFormCreateValues({ _id: 'mongo-7', due_date: '2026-10-20' })).toBeUndefined();
  });

  it('carries nothing for no record, or one with only empty entries', () => {
    expect(recordFormCreateValues(null)).toBeUndefined();
    expect(recordFormCreateValues(undefined)).toBeUndefined();
    expect(recordFormCreateValues({ due_date: null, end_date: undefined })).toBeUndefined();
  });
});

describe('readRecordFormCreateValues (objectui#12291)', () => {
  it('reads the values a history entry carries under its key', () => {
    const values = { due_date: '2026-10-20' };
    expect(readRecordFormCreateValues({ [RECORD_FORM_CREATE_VALUES_STATE]: values })).toBe(values);
  });

  it('reads nothing from an entry without them, or from a value that is not a values object', () => {
    expect(readRecordFormCreateValues(null)).toBeUndefined();
    expect(readRecordFormCreateValues({ from: { pathname: '/x' } })).toBeUndefined();
    expect(readRecordFormCreateValues({ [RECORD_FORM_CREATE_VALUES_STATE]: ['due_date'] })).toBeUndefined();
    expect(readRecordFormCreateValues({ [RECORD_FORM_CREATE_VALUES_STATE]: 'due_date' })).toBeUndefined();
  });
});

describe('resolveRecordFormTarget — a seeded create in page mode (objectui#12291)', () => {
  it('carries the values as the query-string prefill RecordFormPage reads', () => {
    expect(
      resolveRecordFormTarget({
        objectDef: { name: 'task', editMode: 'page' },
        baseUrl: '/apps/sales',
        record: { due_date: '2026-10-20', start_at: '2026-10-20T09:00:00.000Z' },
      }),
    ).toEqual({
      kind: 'page',
      url: '/apps/sales/task/new?due_date=2026-10-20&start_at=2026-10-20T09%3A00%3A00.000Z',
    });
  });

  it('an existing record still opens its edit page, its other keys ignored', () => {
    expect(
      resolveRecordFormTarget({
        objectDef: { name: 'task', editMode: 'page' },
        baseUrl: '/apps/sales',
        record: { id: 'r1', due_date: '2026-10-20' },
      }),
    ).toEqual({ kind: 'page', url: '/apps/sales/task/record/r1/edit' });
  });
});

describe('resolveNavigateCreateUrl', () => {
  const defaultBaseUrl = '/apps/sales';

  it('uses params.objectName as primary source', () => {
    expect(
      resolveNavigateCreateUrl({
        action: { params: { objectName: 'lead' } },
        defaultBaseUrl,
      }),
    ).toEqual({ success: true, url: '/apps/sales/lead/new' });
  });

  it('falls back to action.objectName when params.objectName is missing', () => {
    expect(
      resolveNavigateCreateUrl({
        action: { objectName: 'lead' },
        defaultBaseUrl,
      }),
    ).toEqual({ success: true, url: '/apps/sales/lead/new' });
  });

  it('falls back to context.objectName as last resort', () => {
    expect(
      resolveNavigateCreateUrl({
        action: {},
        context: { objectName: 'lead' },
        defaultBaseUrl,
      }),
    ).toEqual({ success: true, url: '/apps/sales/lead/new' });
  });

  it('prefers context.baseUrl over defaultBaseUrl', () => {
    expect(
      resolveNavigateCreateUrl({
        action: { params: { objectName: 'lead' } },
        context: { baseUrl: '/apps/marketing' },
        defaultBaseUrl,
      }),
    ).toEqual({ success: true, url: '/apps/marketing/lead/new' });
  });

  it('errors when objectName cannot be resolved', () => {
    expect(
      resolveNavigateCreateUrl({
        action: {},
        defaultBaseUrl,
      }),
    ).toEqual({
      success: false,
      error: 'navigate_create: objectName is required',
    });
  });
});

describe('resolveNavigateEditUrl', () => {
  const defaultBaseUrl = '/apps/sales';

  it('builds the edit URL from params', () => {
    expect(
      resolveNavigateEditUrl({
        action: { params: { objectName: 'lead', recordId: 'L-7' } },
        defaultBaseUrl,
      }),
    ).toEqual({ success: true, url: '/apps/sales/lead/record/L-7/edit' });
  });

  it('falls back to action.objectName + action.recordId', () => {
    expect(
      resolveNavigateEditUrl({
        action: { objectName: 'lead', recordId: 'L-7' },
        defaultBaseUrl,
      }),
    ).toEqual({ success: true, url: '/apps/sales/lead/record/L-7/edit' });
  });

  it('uses context.objectName but never context.recordId', () => {
    // recordId must always come from the action — every record click
    // should provide its own id.
    expect(
      resolveNavigateEditUrl({
        action: { params: { recordId: 'L-7' } },
        context: { objectName: 'lead' },
        defaultBaseUrl,
      }),
    ).toEqual({ success: true, url: '/apps/sales/lead/record/L-7/edit' });
  });

  it('URL-encodes record ids', () => {
    expect(
      resolveNavigateEditUrl({
        action: { params: { objectName: 'lead', recordId: 'a/b c' } },
        defaultBaseUrl,
      }),
    ).toEqual({
      success: true,
      url: '/apps/sales/lead/record/a%2Fb%20c/edit',
    });
  });

  it('errors when objectName is missing', () => {
    expect(
      resolveNavigateEditUrl({
        action: { params: { recordId: 'L-7' } },
        defaultBaseUrl,
      }),
    ).toEqual({
      success: false,
      error: 'navigate_edit: objectName and recordId are required',
    });
  });

  it('errors when recordId is missing', () => {
    expect(
      resolveNavigateEditUrl({
        action: { params: { objectName: 'lead' } },
        defaultBaseUrl,
      }),
    ).toEqual({
      success: false,
      error: 'navigate_edit: objectName and recordId are required',
    });
  });

  it('errors when recordId is empty string', () => {
    expect(
      resolveNavigateEditUrl({
        action: { params: { objectName: 'lead', recordId: '' } },
        defaultBaseUrl,
      }),
    ).toEqual({
      success: false,
      error: 'navigate_edit: objectName and recordId are required',
    });
  });
});


describe('resolveFormViewLayout', () => {
  it('returns {} when objectDef is missing', () => {
    expect(resolveFormViewLayout(undefined)).toEqual({});
    expect(resolveFormViewLayout(null)).toEqual({});
  });

  it('returns {} when the object declares no form view', () => {
    expect(resolveFormViewLayout({})).toEqual({});
    expect(resolveFormViewLayout({ formViews: {} })).toEqual({});
  });

  it('returns the curated sections for a simple form view (no contentLayout)', () => {
    const sections = [{ label: 'Details', fields: [{ field: 'subject' }] }];
    expect(resolveFormViewLayout({ form: { type: 'simple', sections } })).toEqual({ sections });
  });

  it('adds contentLayout:"tabbed" for a tabbed form view with sections', () => {
    const sections = [
      { label: 'A', fields: [{ field: 'x' }] },
      { label: 'B', fields: [{ field: 'y' }] },
    ];
    expect(resolveFormViewLayout({ form: { type: 'tabbed', sections } })).toEqual({
      sections,
      contentLayout: 'tabbed',
    });
  });

  it('stacks wizard/split sections (no contentLayout — no modal equivalent)', () => {
    const sections = [{ label: 'Step 1', fields: ['a'] }];
    expect(resolveFormViewLayout({ form: { type: 'wizard', sections } })).toEqual({ sections });
    expect(resolveFormViewLayout({ form: { type: 'split', sections } })).toEqual({ sections });
  });

  it('treats an empty sections array as "no curation" (omits the key)', () => {
    expect(resolveFormViewLayout({ form: { type: 'simple', sections: [] } })).toEqual({});
    // …even when tabbed: contentLayout only rides along with real sections.
    expect(resolveFormViewLayout({ form: { type: 'tabbed', sections: [] } })).toEqual({});
  });

  it('forwards non-empty subforms (master-detail) and omits empty ones', () => {
    const subforms = [{ childObject: 'invoice_line' }];
    expect(resolveFormViewLayout({ form: { type: 'simple', subforms } })).toEqual({ subforms });
    expect(resolveFormViewLayout({ form: { type: 'simple', subforms: [] } })).toEqual({});
  });

  it('combines sections + subforms', () => {
    const sections = [{ label: 'Details', fields: ['subject'] }];
    const subforms = [{ childObject: 'invoice_line' }];
    expect(resolveFormViewLayout({ form: { type: 'simple', sections, subforms } })).toEqual({
      sections,
      subforms,
    });
  });

  it('falls back to formViews.default when `form` is absent (legacy container)', () => {
    const sections = [{ label: 'Details', fields: ['subject'] }];
    expect(
      resolveFormViewLayout({ formViews: { default: { type: 'simple', sections } } }),
    ).toEqual({ sections });
  });

  it('prefers the default `form` ViewItem over formViews.default', () => {
    const formSections = [{ label: 'Primary', fields: ['a'] }];
    const legacySections = [{ label: 'Legacy', fields: ['b'] }];
    expect(
      resolveFormViewLayout({
        form: { type: 'simple', sections: formSections },
        formViews: { default: { type: 'simple', sections: legacySections } },
      }),
    ).toEqual({ sections: formSections });
  });
});

describe('resolvePostCreateTarget (#2604 save invariant: create lands on the record)', () => {
  const base = {
    objectName: 'contract',
    baseUrl: '/apps/crm',
    pathname: '/apps/crm/contract',
  };

  it('heavy record (page surface) → the detail ROUTE', () => {
    expect(
      resolvePostCreateTarget({ ...base, surface: 'page', recordId: 'REC-1' }),
    ).toEqual({ kind: 'detail-page', url: '/apps/crm/contract/record/REC-1' });
  });

  it('light record (drawer surface) → detail drawer over the CURRENT list route', () => {
    expect(
      resolvePostCreateTarget({ ...base, surface: 'drawer', recordId: 'REC-1' }),
    ).toEqual({ kind: 'detail-drawer', url: '/apps/crm/contract?recordId=REC-1' });
  });

  it('drawer target preserves existing query state but strips the form overlay param', () => {
    const target = resolvePostCreateTarget({
      ...base,
      pathname: '/apps/crm/contract/view/all_active',
      search: '?form=new&status=open',
      surface: 'drawer',
      recordId: 'REC-2',
    });
    expect(target.kind).toBe('detail-drawer');
    const url = new URL('http://x' + (target as { url: string }).url);
    expect(url.pathname).toBe('/apps/crm/contract/view/all_active');
    expect(url.searchParams.get('form')).toBeNull();
    expect(url.searchParams.get('status')).toBe('open');
    expect(url.searchParams.get('recordId')).toBe('REC-2');
  });

  it('URL-encodes the record id in the page route', () => {
    expect(
      resolvePostCreateTarget({ ...base, surface: 'page', recordId: 'a b:c' }),
    ).toEqual({ kind: 'detail-page', url: '/apps/crm/contract/record/a%20b%3Ac' });
  });

  it('stays put without a usable record id or object name', () => {
    expect(resolvePostCreateTarget({ ...base, surface: 'page', recordId: null })).toEqual({ kind: 'none' });
    expect(resolvePostCreateTarget({ ...base, surface: 'page', recordId: '' })).toEqual({ kind: 'none' });
    expect(
      resolvePostCreateTarget({ ...base, objectName: '', surface: 'drawer', recordId: 'x' }),
    ).toEqual({ kind: 'none' });
  });
});
