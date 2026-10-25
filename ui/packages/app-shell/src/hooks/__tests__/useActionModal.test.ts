import { describe, it, expect } from 'vitest';
import { normalizeModalSchema } from '../useActionModal';

describe('normalizeModalSchema', () => {
  it('keeps a string target UNRESOLVED — page-vs-object is a metadata question', () => {
    // framework#3530: assuming "object" here sent every page-targeting modal
    // action to GET /meta/object/<page>, which 400s and rendered ModalForm's
    // "Error loading form — Bad Request". `resolveModalTarget` asks the
    // metadata service instead (see useActionModal.resolve.test.tsx).
    expect(normalizeModalSchema('log_call')).toEqual({ targetName: 'log_call' });
    expect(normalizeModalSchema('contact')).toEqual({ targetName: 'contact' });
  });

  // objectstack#6739 — the `create_`/`new_`/`add_`/`edit_`/`update_` prefix
  // convention RETIRED with the object fallback. These used to assert the
  // opposite (a verb+object guess riding alongside `targetName`); they are
  // rewritten rather than deleted so the retirement is pinned, not merely
  // un-covered. A prefixed name is now an ordinary page name — nothing about
  // its spelling is special.
  it('does NOT parse a create_/new_/add_ prefix into an object guess', () => {
    expect(normalizeModalSchema('create_opportunity')).toEqual({ targetName: 'create_opportunity' });
    expect(normalizeModalSchema('new_task')).toEqual({ targetName: 'new_task' });
    expect(normalizeModalSchema('add_note')).toEqual({ targetName: 'add_note' });
  });

  it('does NOT parse an edit_/update_ prefix into an edit-mode object guess', () => {
    expect(normalizeModalSchema('edit_account')).toEqual({ targetName: 'edit_account' });
    expect(normalizeModalSchema('update_lead')).toEqual({ targetName: 'update_lead' });
  });

  it('treats a prefixed name and a bare name identically — no shape depends on spelling', () => {
    // The ruling declined the middle shape (keep the prefix, reject bare object
    // names), so the two spellings must be indistinguishable at this step.
    expect(normalizeModalSchema('create_opportunity')).toEqual({ targetName: 'create_opportunity' });
    expect(normalizeModalSchema('opportunity')).toEqual({ targetName: 'opportunity' });
  });

  it('treats a bare SchemaNode (has type, no descriptor keys) as content', () => {
    const node = { type: 'element:definition-list', properties: { items: [] } };
    expect(normalizeModalSchema(node)).toEqual({ content: node });
  });

  it('passes a modal descriptor through unchanged', () => {
    const desc = { placement: 'side', title: 'Details', content: { type: 'x' } };
    expect(normalizeModalSchema(desc)).toBe(desc);
  });

  it('keeps an object-form descriptor (objectName) as-is', () => {
    const desc = { objectName: 'task', mode: 'edit', recordId: '1' };
    expect(normalizeModalSchema(desc)).toBe(desc);
  });
});
