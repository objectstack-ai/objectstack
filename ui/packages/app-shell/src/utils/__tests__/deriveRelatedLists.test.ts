import { describe, it, expect } from 'vitest';
import { deriveRelatedLists } from '../deriveRelatedLists';
import { normalizeSchemaReferenceKeys } from '@object-ui/core';

const project = { name: 'project', label: 'Project', fields: { name: { type: 'text' } } };

describe('deriveRelatedLists', () => {
  it('returns [] for missing object or empty registry', () => {
    expect(deriveRelatedLists(undefined, [])).toEqual([]);
    expect(deriveRelatedLists(project, [])).toEqual([]);
    expect(deriveRelatedLists(project, null as any)).toEqual([]);
  });

  it('derives a related list from a master_detail child (owned)', () => {
    const task = {
      name: 'task',
      label: 'Task',
      fields: { project: { type: 'master_detail', reference: 'project' } },
    };
    const out = deriveRelatedLists(project, [project, task]);
    expect(out).toEqual([
      {
        childObject: 'task',
        childLabel: 'Task',
        referenceField: 'project',
        isOwned: true,
        isPrimary: false,
      },
    ]);
  });

  it('derives a related list from a lookup child', () => {
    const note = {
      name: 'note',
      label: 'Note',
      fields: { project_id: { type: 'lookup', reference: 'project' } },
    };
    const out = deriveRelatedLists(project, [project, note]);
    expect(out[0]).toMatchObject({
      childObject: 'note',
      referenceField: 'project_id',
      isOwned: false,
      isPrimary: false,
    });
  });

  it('does NOT derive a related list from a `reference_to`-only FK (objectui#6837 half 2)', () => {
    // The inverse of what this case asserted before half 2. `reference` is the
    // only target spelling `@objectstack/spec`'s `FieldSchema` declares — it
    // refuses `reference_to` by name, with its own "did you mean ->
    // `reference`?" rename. Maintainer 2026-08-31: protocol normalization
    // belongs on the SERVER, the front end just executes the protocol;
    // objectstack#13847 rewrites stored `reference_to` on the serve path and in
    // `os migrate meta`.
    //
    // ⚠️ Non-vacuous by construction: the very next case feeds the SAME shape
    // spelled `reference` and expects one derived list, so a helper that had
    // stopped deriving anything would fail there rather than passing here.
    const task = {
      name: 'task',
      fields: { project: { type: 'master_detail', reference_to: 'project' } },
    };
    expect(deriveRelatedLists(project, [project, task])).toHaveLength(0);
  });

  it('derives one from the same FK spelled `reference` — the control for the refusal above', () => {
    const task = {
      name: 'task',
      fields: { project: { type: 'master_detail', reference: 'project' } },
    };
    const out = deriveRelatedLists(project, [project, task]);
    expect(out).toHaveLength(1);
    expect(out[0].childObject).toBe('task');
  });

  it('a `reference_to`-only FK that came through the ingestion choke point DOES derive one', () => {
    // What bounds the break: `normalizeSchemaReferenceKeys` stamps `reference`
    // from whichever spelling arrived, so any object that entered through
    // `MetadataProvider` or `ObjectStackAdapter.getObjectSchema` is unaffected.
    // Only metadata that bypassed that door reaches this helper raw.
    const task = {
      name: 'task',
      fields: { project: { type: 'master_detail', reference_to: 'project' } },
    };
    normalizeSchemaReferenceKeys(task);
    const out = deriveRelatedLists(project, [project, task]);
    expect(out).toHaveLength(1);
    expect(out[0].childObject).toBe('task');
  });

  it('orders owned (master_detail) children before lookup children', () => {
    const note = { name: 'note', fields: { project_id: { type: 'lookup', reference: 'project' } } };
    const task = { name: 'task', fields: { project: { type: 'master_detail', reference: 'project' } } };
    // note declared before task, but task is owned → owned wins ordering
    const out = deriveRelatedLists(project, [project, note, task]);
    expect(out.map((r) => r.childObject)).toEqual(['task', 'note']);
  });

  it('suppresses a child when relatedList === false', () => {
    const task = {
      name: 'task',
      fields: { project: { type: 'master_detail', reference: 'project', relatedList: false } },
    };
    expect(deriveRelatedLists(project, [project, task])).toEqual([]);
  });

  it('skips audit FKs (created_by/updated_by/owner_id)', () => {
    const log = {
      name: 'log',
      fields: {
        created_by: { type: 'lookup', reference: 'project' },
        owner_id: { type: 'lookup', reference: 'project' },
      },
    };
    expect(deriveRelatedLists(project, [project, log])).toEqual([]);
  });

  it('carries relatedListTitle and relatedListColumns overrides', () => {
    const task = {
      name: 'task',
      label: 'Task',
      fields: {
        project: {
          type: 'master_detail',
          reference: 'project',
          relatedListTitle: 'Project Tasks',
          relatedListColumns: ['name', 'status'],
        },
      },
    };
    const out = deriveRelatedLists(project, [project, task]);
    expect(out[0]).toMatchObject({
      title: 'Project Tasks',
      columns: ['name', 'status'],
    });
  });

  it('flags relatedList: "primary" as isPrimary (prominence → own tab)', () => {
    const task = {
      name: 'task',
      label: 'Task',
      fields: { project: { type: 'master_detail', reference: 'project', relatedList: 'primary' } },
    };
    const out = deriveRelatedLists(project, [project, task]);
    expect(out[0]).toMatchObject({ childObject: 'task', isPrimary: true, isOwned: true });
  });

  it('emits one related list per eligible FK when a child references the parent multiple times', () => {
    const opportunity = {
      name: 'opportunity',
      label: 'Opportunity',
      fields: {
        primary_project: { type: 'lookup', reference: 'project', label: 'Primary Project' },
        partner_project: { type: 'lookup', reference: 'project', label: 'Partner Project' },
      },
    };
    const out = deriveRelatedLists(project, [project, opportunity]);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.referenceField).sort()).toEqual(['partner_project', 'primary_project']);
    // No explicit relatedListTitle → the FK label disambiguates the two lists.
    expect(out.map((r) => r.title).sort()).toEqual([
      'Opportunity · Partner Project',
      'Opportunity · Primary Project',
    ]);
  });

  it('keeps an explicit relatedListTitle over the multi-FK disambiguation suffix', () => {
    const opportunity = {
      name: 'opportunity',
      label: 'Opportunity',
      fields: {
        primary_project: {
          type: 'lookup', reference: 'project', label: 'Primary Project',
          relatedListTitle: 'Primary Opps',
        },
        partner_project: { type: 'lookup', reference: 'project', label: 'Partner Project' },
      },
    };
    const out = deriveRelatedLists(project, [project, opportunity]);
    const byField = Object.fromEntries(out.map((r) => [r.referenceField, r.title]));
    expect(byField.primary_project).toBe('Primary Opps');
    expect(byField.partner_project).toBe('Opportunity · Partner Project');
  });

  it('skips a suppressed FK but keeps a sibling FK on the same child', () => {
    const assignment = {
      name: 'assignment',
      fields: {
        legacy_project: { type: 'lookup', reference: 'project', relatedList: false },
        project: { type: 'master_detail', reference: 'project' },
      },
    };
    const out = deriveRelatedLists(project, [project, assignment]);
    expect(out).toHaveLength(1);
    expect(out[0].referenceField).toBe('project');
  });

  it('includes a self-referential relationship (hierarchy → "child" list)', () => {
    const selfRef = {
      name: 'project',
      label: 'Project',
      fields: {
        name: { type: 'text' },
        parent_project: { type: 'lookup', reference: 'project', label: 'Parent Project' },
      },
    };
    const out = deriveRelatedLists(selfRef, [selfRef]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      childObject: 'project',
      referenceField: 'parent_project',
      isOwned: false,
    });
  });

  it('ignores unrelated objects', () => {
    const other = { name: 'other', fields: { foo: { type: 'lookup', reference: 'somethingelse' } } };
    expect(deriveRelatedLists(project, [project, other])).toEqual([]);
  });

  it('drops children the current user cannot read via canRead (objectui#2359)', () => {
    const task = {
      name: 'task',
      label: 'Task',
      fields: { project: { type: 'master_detail', reference: 'project' } },
    };
    const note = {
      name: 'note',
      label: 'Note',
      fields: { project_id: { type: 'lookup', reference: 'project' } },
    };
    const out = deriveRelatedLists(project, [project, task, note], {
      canRead: (name) => name !== 'task',
    });
    expect(out.map((r) => r.childObject)).toEqual(['note']);
  });

  it('keeps all children when canRead is omitted (permissions still loading)', () => {
    const task = {
      name: 'task',
      label: 'Task',
      fields: { project: { type: 'master_detail', reference: 'project' } },
    };
    expect(deriveRelatedLists(project, [project, task])).toHaveLength(1);
    expect(deriveRelatedLists(project, [project, task], {})).toHaveLength(1);
  });

  it('handles array-shaped fields', () => {
    const task = {
      name: 'task',
      label: 'Task',
      fields: [{ name: 'project', type: 'master_detail', reference: 'project' }],
    };
    const out = deriveRelatedLists(project, [project, task]);
    expect(out[0]).toMatchObject({ childObject: 'task', referenceField: 'project', isOwned: true });
  });
});
