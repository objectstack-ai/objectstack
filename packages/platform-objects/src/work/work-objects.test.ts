// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { SharingRuleSchema } from '@objectstack/spec/security';
import { PlatformObjectsPlugin, WORK_OBJECTS_MANIFEST } from '../plugin.js';
import * as PlatformObjects from '../index.js';
import {
  SysTask,
  SysNote,
  SYS_TASK_ASSIGNEE_SHARING_RULE,
  WORK_OBJECT_SHARING_RULES,
  installWorkObjectHooks,
  stampTaskCompletion,
  stampNoteHeading,
  firstLineOf,
} from './index.js';

const NOW = '2026-11-24T12:00:00.000Z';
const now = () => NOW;

describe('sys_task / sys_note — declarations', () => {
  it('both parse as objects and are exported from the package root', () => {
    expect(ObjectSchema.safeParse(SysTask).success).toBe(true);
    expect(ObjectSchema.safeParse(SysNote).success).toBe(true);
    expect(PlatformObjects.SysTask).toBe(SysTask);
    expect(PlatformObjects.SysNote).toBe(SysNote);
  });

  it('sys_task carries exactly the card fields, plus the declared owner anchor', () => {
    expect(SysTask.name).toBe('sys_task');
    expect(Object.keys(SysTask.fields).sort()).toEqual(
      ['assignee_id', 'completed_at', 'description', 'due_at', 'owner_id', 'status', 'title'],
    );
    expect(SysTask.fields.title).toMatchObject({ type: 'text', required: true });
    expect(SysTask.fields.description).toMatchObject({ type: 'richtext' });
    expect(SysTask.fields.status).toMatchObject({ type: 'select', defaultValue: 'todo' });
    expect((SysTask.fields.status as { options: Array<{ value: string }> }).options.map((o) => o.value)).toEqual(
      ['todo', 'in_progress', 'done'],
    );
    expect(SysTask.fields.due_at).toMatchObject({ type: 'datetime' });
    expect(SysTask.fields.assignee_id).toMatchObject({ type: 'user', reference: 'sys_user', defaultValue: 'current_user' });
    expect(SysTask.fields.completed_at).toMatchObject({ type: 'datetime', readonly: true });
    expect(SysTask.fields.owner_id).toMatchObject({ type: 'lookup', reference: 'sys_user' });
  });

  it('sys_note carries an optional title, a rich-text body and the read-only heading a list shows', () => {
    expect(SysNote.name).toBe('sys_note');
    expect(Object.keys(SysNote.fields).sort()).toEqual(['body', 'heading', 'owner_id', 'title']);
    expect(SysNote.fields.title.required).not.toBe(true);
    expect(SysNote.fields.body).toMatchObject({ type: 'richtext' });
    expect(SysNote.fields.heading).toMatchObject({ type: 'text', readonly: true });
    expect(SysNote.nameField).toBe('heading');
  });

  it('carries no link to another record: no lookup but the user anchors, no related list', () => {
    for (const obj of [SysTask, SysNote]) {
      for (const [name, field] of Object.entries(obj.fields as Record<string, { type: string; reference?: string }>)) {
        if (field.type === 'lookup' || field.type === 'master_detail' || field.type === 'user') {
          expect(field.reference, `${obj.name}.${name}`).toBe('sys_user');
        }
      }
      expect((obj as { relatedLists?: unknown }).relatedLists).toBeUndefined();
    }
  });

  it('keeps its own sharing: private over a declared owner_id, attachments on, comments not turned off', () => {
    for (const obj of [SysTask, SysNote]) {
      expect(obj.sharingModel).toBe('private');
      expect(obj.fields.owner_id).toBeDefined();
      expect(obj.enable?.files).toBe(true);
      expect(obj.enable?.feeds).not.toBe(false);
      expect(obj.isSystem).not.toBe(true);
    }
  });

  it('ships the default views the card names, in order', () => {
    expect(Object.keys(SysTask.listViews ?? {})).toEqual(['assigned_to_me', 'created_by_me', 'all']);
    const assigned = SysTask.listViews!.assigned_to_me as any;
    expect(assigned.filter).toEqual([
      { field: 'assignee_id', operator: 'equals', value: '{current_user_id}' },
      { field: 'status', operator: 'not_equals', value: 'done' },
    ]);
    expect(assigned.sort).toEqual([{ field: 'due_at', order: 'asc' }]);
    expect((SysTask.listViews!.created_by_me as any).filter).toEqual([
      { field: 'created_by', operator: 'equals', value: '{current_user_id}' },
    ]);
    expect(SysTask.listViews!.all).toMatchObject({ type: 'kanban', kanban: { groupByField: 'status' } });

    expect(Object.keys(SysNote.listViews ?? {})).toEqual(['mine', 'all']);
    expect((SysNote.listViews!.mine as any).filter).toEqual([
      { field: 'owner_id', operator: 'equals', value: '{current_user_id}' },
    ]);
  });
});

describe('sys_task assignee sharing rule', () => {
  it('parses, names the assignee field as its recipient and grants edit', () => {
    expect(SharingRuleSchema.safeParse(SYS_TASK_ASSIGNEE_SHARING_RULE).success).toBe(true);
    expect(SYS_TASK_ASSIGNEE_SHARING_RULE).toMatchObject({
      name: 'sys_task_assignee',
      object: 'sys_task',
      sharedWith: { type: 'field', value: 'assignee_id' },
      accessLevel: 'edit',
      active: true,
    });
    expect(WORK_OBJECT_SHARING_RULES).toEqual([SYS_TASK_ASSIGNEE_SHARING_RULE]);
  });

  it('names a user field the object declares, and only sys_task (a note keeps to its owner)', () => {
    const field = (SysTask.fields as Record<string, { type: string }>)[SYS_TASK_ASSIGNEE_SHARING_RULE.sharedWith.value];
    expect(field?.type).toBe('user');
    expect(WORK_OBJECT_SHARING_RULES.every((r) => r.object === 'sys_task')).toBe(true);
  });
});

describe('the task completion stamp', () => {
  it('a task created done is stamped; one created open is not, whatever the client sent', () => {
    const done: Record<string, unknown> = { title: 'x', status: 'done' };
    stampTaskCompletion('beforeInsert', done, undefined, now);
    expect(done.completed_at).toBe(NOW);

    const open: Record<string, unknown> = { title: 'x', status: 'todo', completed_at: '2020-01-01T00:00:00.000Z' };
    stampTaskCompletion('beforeInsert', open, undefined, now);
    expect(open.completed_at).toBeNull();

    const defaulted: Record<string, unknown> = { title: 'x', completed_at: '2020-01-01T00:00:00.000Z' };
    stampTaskCompletion('beforeInsert', defaulted, undefined, now);
    expect(defaulted.completed_at).toBeNull();
  });

  it('status becoming done writes completed_at; leaving done clears it', () => {
    const toDone: Record<string, unknown> = { status: 'done' };
    stampTaskCompletion('beforeUpdate', toDone, { status: 'in_progress', completed_at: null }, now);
    expect(toDone.completed_at).toBe(NOW);

    const reopen: Record<string, unknown> = { status: 'todo' };
    stampTaskCompletion('beforeUpdate', reopen, { status: 'done', completed_at: NOW }, now);
    expect(reopen).toHaveProperty('completed_at', null);
  });

  it('an update that does not write status leaves the stamp alone', () => {
    const edit: Record<string, unknown> = { title: 'renamed' };
    stampTaskCompletion('beforeUpdate', edit, { status: 'done', completed_at: NOW }, now);
    expect(edit).not.toHaveProperty('completed_at');
  });

  it('done → done keeps the first completion time; a predicate update (no snapshot) stamps now', () => {
    const again: Record<string, unknown> = { status: 'done' };
    stampTaskCompletion('beforeUpdate', again, { status: 'done', completed_at: '2026-01-01T00:00:00.000Z' }, now);
    expect(again).not.toHaveProperty('completed_at');

    const bulk: Record<string, unknown> = { status: 'done' };
    stampTaskCompletion('beforeUpdate', bulk, undefined, now);
    expect(bulk.completed_at).toBe(NOW);
  });
});

describe('the note heading', () => {
  it('is the title when there is one', () => {
    const row: Record<string, unknown> = { title: '  Weekly sync ', body: '<p>Agenda</p>' };
    stampNoteHeading('beforeInsert', row, undefined);
    expect(row.heading).toBe('Weekly sync');
  });

  it('is the body\'s first line when the title is empty', () => {
    const row: Record<string, unknown> = { title: '', body: '<h2>Call notes</h2><p>Second line</p>' };
    stampNoteHeading('beforeInsert', row, undefined);
    expect(row.heading).toBe('Call notes');

    const md: Record<string, unknown> = { body: '\n\n# Ideas &amp; plans\n- one' };
    stampNoteHeading('beforeInsert', md, undefined);
    expect(md.heading).toBe('Ideas & plans');
  });

  it('is empty when neither has text, and a client value is replaced', () => {
    const row: Record<string, unknown> = { body: '<p> </p>', heading: 'forged' };
    stampNoteHeading('beforeInsert', row, undefined);
    expect(row.heading).toBeNull();
  });

  it('on an update reads the side the write leaves out from the snapshot', () => {
    const clearTitle: Record<string, unknown> = { title: '' };
    stampNoteHeading('beforeUpdate', clearTitle, { title: 'Old', body: 'First line\nsecond' });
    expect(clearTitle.heading).toBe('First line');

    const untouched: Record<string, unknown> = { owner_id: 'u2' };
    stampNoteHeading('beforeUpdate', untouched, { title: 'Old', body: 'x' });
    expect(untouched).not.toHaveProperty('heading');
  });

  it('firstLineOf caps the heading at the column length', () => {
    expect(firstLineOf('a'.repeat(400))).toHaveLength(255);
    expect(firstLineOf(null)).toBeNull();
    expect(firstLineOf(42)).toBeNull();
  });
});

describe('installWorkObjectHooks', () => {
  function fakeEngine() {
    const hooks: Array<{ event: string; handler: (ctx: any) => void; options?: { object?: string; packageId?: string } }> = [];
    return {
      hooks,
      registerHook(event: string, handler: (ctx: any) => void, options?: { object?: string; packageId?: string }) {
        hooks.push({ event, handler, options });
      },
      fire(event: string, object: string, ctx: any) {
        for (const h of hooks) if (h.event === event && h.options?.object === object) h.handler({ event, ...ctx });
      },
    };
  }

  it('registers a before-insert and a before-update hook on each object, under the package id', () => {
    const engine = fakeEngine();
    installWorkObjectHooks(engine, 'pkg.work');
    expect(engine.hooks.map((h) => `${h.event}:${h.options?.object}:${h.options?.packageId}`).sort()).toEqual([
      'beforeInsert:sys_note:pkg.work',
      'beforeInsert:sys_task:pkg.work',
      'beforeUpdate:sys_note:pkg.work',
      'beforeUpdate:sys_task:pkg.work',
    ]);
  });

  it('reads the record out of the ctx.input envelope and the snapshot out of ctx.previous', () => {
    const engine = fakeEngine();
    installWorkObjectHooks(engine, 'pkg.work');

    const data: Record<string, unknown> = { status: 'done' };
    engine.fire('beforeUpdate', 'sys_task', { input: { id: 't1', data }, previous: { status: 'todo' } });
    expect(typeof data.completed_at).toBe('string');

    const note: Record<string, unknown> = { body: 'Hello\nworld' };
    engine.fire('beforeInsert', 'sys_note', { input: { data: note } });
    expect(note.heading).toBe('Hello');
  });
});

describe('PlatformObjectsPlugin registers the work objects', () => {
  function makeCtx(services: Record<string, unknown> = {}) {
    const warns: string[] = [];
    const ctx: any = {
      logger: { info: () => {}, warn: (m: string) => warns.push(String(m)) },
      getService: (name: string) => {
        if (!(name in services)) throw new Error(`service '${name}' not registered`);
        return services[name];
      },
      hook: () => {},
    };
    return { ctx, warns };
  }

  it('init registers sys_task and sys_note on their own manifest, with the assignee sharing rule', async () => {
    const manifests: any[] = [];
    const { ctx } = makeCtx({ manifest: { register: (m: unknown) => manifests.push(m) } });
    await new PlatformObjectsPlugin().init(ctx);

    const work = manifests.find((m) => m.id === WORK_OBJECTS_MANIFEST.id);
    expect(work).toMatchObject({ scope: 'system', type: 'plugin' });
    expect(work.defaultDatasource).toBeUndefined();
    expect(work.objects).toEqual([SysTask, SysNote]);
    expect(work.sharingRules).toEqual(WORK_OBJECT_SHARING_RULES);
    // Neither infrastructure manifest carries them.
    for (const other of manifests.filter((m) => m !== work)) {
      expect(other.objects.map((o: { name: string }) => o.name)).not.toContain('sys_task');
      expect(other.objects.map((o: { name: string }) => o.name)).not.toContain('sys_note');
    }
  });

  it('a refused registration is said, not swallowed', async () => {
    const { ctx, warns } = makeCtx({
      manifest: {
        register: (m: { id: string }) => {
          if (m.id === WORK_OBJECTS_MANIFEST.id) throw new Error('Object "sys_task" is already owned by package "host"');
        },
      },
    });
    await new PlatformObjectsPlugin().init(ctx);
    expect(warns.some((w) => w.includes('sys_task') && w.includes('already owned'))).toBe(true);
  });

  it('start installs the hooks when an engine is present, under the work package id', async () => {
    const registered: Array<{ event: string; options?: { object?: string; packageId?: string } }> = [];
    const engine = { registerHook: (event: string, _h: unknown, options?: any) => registered.push({ event, options }) };
    const { ctx } = makeCtx({ objectql: engine });
    await new PlatformObjectsPlugin().start(ctx);
    expect(registered.filter((r) => r.options?.packageId === WORK_OBJECTS_MANIFEST.id)).toHaveLength(4);
  });

  it('start is a no-op for the hooks on a kernel without an engine', async () => {
    const { ctx } = makeCtx();
    await expect(new PlatformObjectsPlugin().start(ctx)).resolves.toBeUndefined();
  });
});
