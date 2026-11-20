import { describe, it, expect } from 'vitest';
import { authoredBodyTableIds, deriveRelatedLists } from '../deriveRelatedLists';
import { normalizeSchemaReferenceKeys } from '@object-ui/core';

const project = { name: 'project', label: 'Project', fields: { name: { type: 'text' } } };

describe('deriveRelatedLists', () => {
  it('returns [] for missing object or empty registry', () => {
    expect(deriveRelatedLists(undefined, [])).toEqual([]);
    expect(deriveRelatedLists(project, [])).toEqual([]);
    expect(deriveRelatedLists(project, null as any)).toEqual([]);
  });

  it('derives a related list from a master_detail child (owned) — a tab by default, placeable by a field group (objectstack#35889)', () => {
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
        isPlaceable: true,
      },
    ]);
  });

  it('a parent field group naming the master_detail child makes it a body table (objectstack#35889)', () => {
    const task = {
      name: 'task',
      label: 'Task',
      fields: { project: { type: 'master_detail', reference: 'project' } },
    };
    const placing = { ...project, fieldGroups: [{ key: 'tasks', relatedList: 'task' }] };
    expect(deriveRelatedLists(placing, [placing, task])[0]).toMatchObject({ isPrimary: true, isPlaceable: true });
    const byField = { ...project, fieldGroups: [{ key: 'tasks', relatedList: 'task.project' }] };
    expect(deriveRelatedLists(byField, [byField, task])[0]).toMatchObject({ isPrimary: true });
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

// A child the data API does not expose (`enable.apiEnabled: false`, the shape
// `sys_user_device` ships on the stock boot) answers every read of its records
// `404 OBJECT_API_DISABLED`, so the record page derives no list for it.
describe('deriveRelatedLists — a child the data API does not expose', () => {
  const user = { name: 'sys_user', label: 'User', fields: { name: { type: 'text' } } };
  const device = {
    name: 'sys_user_device',
    label: 'Device',
    enable: { apiEnabled: false },
    fields: { user_id: { type: 'lookup', reference: 'sys_user' } },
  };
  const session = {
    name: 'sys_session',
    label: 'Session',
    fields: { user_id: { type: 'lookup', reference: 'sys_user' } },
  };

  it('derives no record-page list for an apiEnabled: false child', () => {
    const out = deriveRelatedLists(user, [user, device, session]);
    expect(out.map((r) => r.childObject)).toEqual(['sys_session']);
  });

  it('keeps the list of a child that declares apiEnabled: true, or no enable block', () => {
    const exposed = { ...device, enable: { apiEnabled: true } };
    expect(deriveRelatedLists(user, [user, exposed]).map((r) => r.childObject)).toEqual(['sys_user_device']);
    const { enable: _enable, ...undeclared } = device;
    expect(deriveRelatedLists(user, [user, undeclared]).map((r) => r.childObject)).toEqual(['sys_user_device']);
  });

  it('lists the relationship on the authoring surface, flagged hidden', () => {
    const out = deriveRelatedLists(user, [user, device, session], { includeHidden: true });
    expect(out.find((r) => r.childObject === 'sys_user_device')).toMatchObject({ referenceField: 'user_id', isHidden: true });
    expect(out.find((r) => r.childObject === 'sys_session')?.isHidden).toBeUndefined();
  });
});

/**
 * objectstack#35597 — an AUTHORED record page gives a master-detail list it
 * places the body-table treatment: its body tables are the related lists it
 * places, anywhere in its tree, whose relationship the record page counts as a
 * body table (the derived list's `isPrimary`).
 */
describe('authoredBodyTableIds (objectstack#35597)', () => {
  // objectstack#35889: a master-detail child is a body table only where a field
  // group of the parent names it, so the quote's group places its lines.
  const quote = {
    name: 'quote',
    label: 'Quote',
    fields: { name: { type: 'text' } },
    fieldGroups: [{ key: 'lines', relatedList: 'quote_line' }],
  };
  const line = { name: 'quote_line', label: 'Line', fields: { quote: { type: 'master_detail', reference: 'quote' } } };
  const note = { name: 'note', label: 'Note', fields: { quote: { type: 'lookup', reference: 'quote' } } };
  const sideLine = { name: 'quote_term', label: 'Term', fields: { quote: { type: 'master_detail', reference: 'quote', relatedList: true } } };
  const relations = deriveRelatedLists(quote, [quote, line, note, sideLine]);
  const list = (objectName: string, inBag = false) =>
    inBag
      ? { type: 'record:related_list', properties: { objectName, relationshipField: 'quote' } }
      : { type: 'record:related_list', objectName, relationshipField: 'quote' };
  const page = {
    type: 'record',
    regions: [{
      name: 'main',
      components: [
        { type: 'page:tabs', properties: { items: [{ label: 'Lines', children: [list('quote_line', true)] }] } },
        list('note'),
        list('quote_term'),
      ],
    }],
  };

  it('names the master-detail list the page places, in either prop spelling; not a lookup or a side master-detail', () => {
    expect([...authoredBodyTableIds(page, relations)]).toEqual(['quote_line.quote']);
  });

  it("CONTROL — 'primary' on a lookup makes its placed list a body table too", () => {
    const primaryNote = { ...note, fields: { quote: { type: 'lookup', reference: 'quote', relatedList: 'primary' } } };
    const ids = authoredBodyTableIds(page, deriveRelatedLists(quote, [quote, line, primaryNote]));
    expect([...ids].sort()).toEqual(['note.quote', 'quote_line.quote']);
  });

  it('a page placing no related list has no body table', () => {
    expect(authoredBodyTableIds({ type: 'record', regions: [] }, relations).size).toBe(0);
  });
});
