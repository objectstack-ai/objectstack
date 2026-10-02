// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#21325) — a binding scaffold takes each reference it writes from an
 * argument or from the project's stack, ⛔ never from the new item's name, and
 * refuses (naming the remedy, writing nothing) when it cannot.
 *
 * ## The defect
 *
 * On a fresh `npm create objectstack` project (namespace `tasks_app`) holding
 * `tasks_app_project` and `tasks_app_task`:
 *
 *   os g flow task_done        bound object `tasks_app_task_done` — the flow's
 *                              own name — and printed "Reaches the stack"
 *   os g action complete_task  bound object `tasks_app_complete_task` and flow
 *                              `complete_task_flow`, exit 1 (`defineStack`)
 *   os g app tasks             bound object `tasks_app_tasks`, exit 1
 *
 * and `os g --help` offered no way to name an existing object.
 *
 * ## What is pinned here, in-process
 *
 * `resolveScaffoldBindings` is the one place a binding is resolved, and it is
 * pure (it answers a verdict; the command prints it and exits), so every
 * branch is asserted directly: where each reference came from, and every
 * refusal. Refusals are asserted by their NAMED SUBJECTS — the value the
 * author passed, the names the stack declares — never by their prose. The
 * spawned half (exit status, nothing written) is `generate-stack-reach.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  GENERATOR_SCAFFOLD_TARGETS,
  resolveScaffoldBindings,
  stackBindingCandidates,
  unusedBindingFlagRefusal,
  type ScaffoldBindingVerdict,
  type ScaffoldBinds,
} from '../src/commands/generate.js';
import type { ProjectNamespace } from '../src/utils/project-namespace.js';

const NS = 'tasks_app';

const object = (name: string, fields: Record<string, unknown> = { name: { type: 'text', label: 'Name' } }) => ({
  name,
  label: 'Thing',
  pluralLabel: 'Things',
  fields,
});

/** A loaded project whose stack declares `objects` and `flows`. */
function project(objects: string[], flows: string[] = []): ProjectNamespace {
  return {
    kind: 'loaded',
    configPath: '/project/objectstack.config.ts',
    namespace: NS,
    config: { objects: objects.map((n) => object(n)), flows: flows.map((n) => ({ name: n })) },
  };
}

const binds = (type: string): ScaffoldBinds => {
  const t = GENERATOR_SCAFFOLD_TARGETS.find((g) => g.type === type);
  if (!t) throw new Error(`no '${type}' generator`);
  return t.binds;
};

function resolve(
  type: string,
  name: string,
  p: ProjectNamespace,
  flags: { object?: string; flow?: string } = {},
  objectName?: string,
): ScaffoldBindingVerdict {
  return resolveScaffoldBindings({ type, name, binds: binds(type), project: p, namespace: NS, objectName, flags });
}

/** Everything a refusal shows the author, as one string. */
const shown = (v: ScaffoldBindingVerdict) => (v.ok ? '' : [v.headline, ...v.lines].join('\n'));

describe('[#21325] the roster: which scaffold binds what', () => {
  it('view is named after its object; action, flow and app take --object; action takes --flow', () => {
    expect(binds('view')).toEqual({ object: 'name' });
    expect(binds('flow')).toEqual({ object: 'flag' });
    expect(binds('app')).toEqual({ object: 'flag' });
    expect(binds('action')).toEqual({ object: 'flag', flow: 'flag' });
    for (const type of ['object', 'dashboard', 'skill', 'picklist']) expect(binds(type)).toEqual({});
  });
});

describe('[#21325] the object comes from --object or the stack, never the item name', () => {
  const two = project([`${NS}_project`, `${NS}_task`]);

  it('--object as declared binds that object', () => {
    const v = resolve('flow', 'task_done', two, { object: `${NS}_task` });
    expect(v.ok && v.bindings.object?.name).toBe(`${NS}_task`);
  });

  it('--object without the namespace prefix binds the prefixed object, as `os g object` names it', () => {
    const v = resolve('flow', 'task_done', two, { object: 'task' });
    expect(v.ok && v.bindings.object?.name).toBe(`${NS}_task`);
  });

  it('--object naming nothing declared is refused, with the declared objects listed', () => {
    const v = resolve('action', 'complete_task', two, { object: 'complete_task' });
    expect(v.ok).toBe(false);
    expect(shown(v)).toContain('complete_task');
    expect(shown(v)).toContain(`'${NS}_project'`);
    expect(shown(v)).toContain(`'${NS}_task'`);
  });

  it('no --object and several objects: refused and listed — never the one named like the item', () => {
    // The card's exact shape: an object whose name the flow's name would have
    // derived exists, and is still not picked.
    const v = resolve('flow', 'task', project([`${NS}_project`, `${NS}_task`]));
    expect(v.ok).toBe(false);
    expect(shown(v)).toContain('--object');
    expect(shown(v)).toContain(`'${NS}_project'`);
    expect(shown(v)).toContain(`'${NS}_task'`);
  });

  it('no --object and exactly one object: that object, said out loud', () => {
    const v = resolve('app', 'tasks', project([`${NS}_project`]));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    // Not `tasks_app_tasks`: the app's own name derives nothing.
    expect(v.bindings.object?.name).toBe(`${NS}_project`);
    expect(v.said.join('\n')).toContain(`${NS}_project`);
  });

  it('no --object and no object declared: refused, and the remedy is `os g object`', () => {
    const v = resolve('flow', 'task_done', project([]));
    expect(v.ok).toBe(false);
    expect(shown(v)).toContain('g object');
  });

  it('the bound object carries its declared fields, labels and title field', () => {
    const p: ProjectNamespace = {
      kind: 'loaded',
      configPath: '/project/objectstack.config.ts',
      namespace: NS,
      config: {
        objects: [object(`${NS}_note`, { title: { type: 'text', label: 'Title' }, body: { type: 'textarea', label: 'Body' } })],
      },
    };
    const v = resolve('app', 'notes', p);
    expect(v.ok && v.bindings.object).toEqual({
      name: `${NS}_note`,
      label: 'Thing',
      pluralLabel: 'Things',
      fields: ['title', 'body'],
      displayField: 'title',
    });
  });
});

describe('[#21325] a view is named after the object it binds, which the stack must declare', () => {
  it('a declared object binds', () => {
    const v = resolve('view', 'task', project([`${NS}_task`]), {}, `${NS}_task`);
    expect(v.ok && v.bindings.object?.name).toBe(`${NS}_task`);
  });

  it('an undeclared one is refused, with the declared objects listed', () => {
    const v = resolve('view', 'task', project([`${NS}_project`]), {}, `${NS}_task`);
    expect(v.ok).toBe(false);
    expect(shown(v)).toContain(`'${NS}_task'`);
    expect(shown(v)).toContain(`'${NS}_project'`);
  });
});

describe('[#21325] an action runs a flow the stack declares', () => {
  const one = project([`${NS}_task`], ['task_done_flow']);
  const two = project([`${NS}_task`], ['task_done_flow', 'task_review_flow']);

  it('--flow as declared binds that flow; with one flow and none named, that one', () => {
    const named = resolve('action', 'complete_task', two, { flow: 'task_review_flow' });
    expect(named.ok && named.bindings.flow).toBe('task_review_flow');
    const only = resolve('action', 'complete_task', one);
    expect(only.ok && only.bindings).toEqual(expect.objectContaining({ flow: 'task_done_flow' }));
  });

  it('never `<name>_flow`: no flow declared is refused, with `os g flow` as the remedy', () => {
    const v = resolve('action', 'complete_task', project([`${NS}_task`], []));
    expect(v.ok).toBe(false);
    expect(shown(v)).toContain('g flow');
  });

  it('several flows and none named is refused and listed; an unknown --flow is refused and listed', () => {
    const several = resolve('action', 'complete_task', two);
    expect(several.ok).toBe(false);
    expect(shown(several)).toContain('--flow');
    expect(shown(several)).toContain("'task_done_flow'");
    const unknown = resolve('action', 'complete_task', one, { flow: 'complete_task_flow' });
    expect(unknown.ok).toBe(false);
    expect(shown(unknown)).toContain('complete_task_flow');
    expect(shown(unknown)).toContain("'task_done_flow'");
  });
});

describe('[#21325] outside a project there is no stack to bind in', () => {
  it.each(GENERATOR_SCAFFOLD_TARGETS.filter((t) => Object.keys(t.binds).length > 0).map((t) => t.type))(
    '`os g %s` with no config is refused',
    (type) => {
      const v = resolveScaffoldBindings({
        type,
        name: 'probe',
        binds: binds(type),
        project: { kind: 'no-config' },
        namespace: undefined,
        objectName: 'probe',
        flags: { object: 'probe', flow: 'probe_flow' },
      });
      expect(v.ok).toBe(false);
      expect(shown(v)).toContain('objectstack.config');
    },
  );
});

describe('[#21325] --object / --flow on a type that takes neither is refused, not ignored', () => {
  it.each([
    ['dashboard', { object: 'task' }],
    ['skill', { object: 'task' }],
    ['object', { object: 'task' }],
    ['view', { object: 'task' }],
    ['flow', { flow: 'task_done_flow' }],
    ['app', { flow: 'task_done_flow' }],
    ['types', { object: 'task' }],
    ['migration', { flow: 'task_done_flow' }],
  ] as const)('`os g %s` with %o', (type, given) => {
    const refusal = unusedBindingFlagRefusal(type, given);
    expect(refusal, type).toBeDefined();
    expect(refusal!.headline).toContain(`--${Object.keys(given)[0]}`);
  });

  it('a type that takes the flag, and an unknown type, are not refused here', () => {
    expect(unusedBindingFlagRefusal('action', { object: 'task', flow: 'task_done_flow' })).toBeUndefined();
    expect(unusedBindingFlagRefusal('flow', { object: 'task' })).toBeUndefined();
    // The unknown-type answer lists the roster, which is the more useful one.
    expect(unusedBindingFlagRefusal('nonexistent', { object: 'task' })).toBeUndefined();
    expect(unusedBindingFlagRefusal('constructor', { object: 'task' })).toBeUndefined();
  });
});

describe('[#21325] stackBindingCandidates reads both collection spellings', () => {
  it('the array form and the name-keyed map form answer the same names', () => {
    const asArray = stackBindingCandidates({ objects: [object('a_one')], flows: [{ name: 'f_one' }] });
    const asMap = stackBindingCandidates({ objects: { a_one: { ...object('a_one'), name: undefined } }, flows: { f_one: {} } });
    expect(asArray.objects.map((o) => o.name)).toEqual(['a_one']);
    expect(asMap.objects.map((o) => o.name)).toEqual(['a_one']);
    expect(asArray.flows).toEqual(['f_one']);
    expect(asMap.flows).toEqual(['f_one']);
  });
});
