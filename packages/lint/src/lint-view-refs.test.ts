// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  lintViewRefs,
  VIEW_KEY_COLLISION,
  VIEW_REF_FORM_TARGET_MISSING,
  VIEW_REF_FORM_TARGET_KIND,
} from './lint-view-refs.js';

const listView = (object: string) => ({
  type: 'grid',
  label: 'All',
  columns: ['title'],
  data: { provider: 'object', object },
});
const formView = (object: string) => ({
  type: 'simple',
  data: { provider: 'object', object },
  sections: [],
});

describe('lintViewRefs — clean paths', () => {
  it('passes a container whose form key does not collide, with a correct form target', () => {
    const stack = {
      views: [{ name: 'task', list: listView('task'), formViews: { edit: formView('task') } }],
      actions: [{ name: 'log_time', type: 'form', target: 'task.edit' }],
    };
    expect(lintViewRefs(stack)).toEqual([]);
  });

  it('ignores non-form action types (their target is not a form-view ref)', () => {
    const stack = {
      views: [{ name: 'task', list: listView('task') }],
      actions: [
        { name: 'open_docs', type: 'url', target: 'https://example.com' },
        { name: 'gallery', type: 'modal', target: 'some_modal' },
      ],
    };
    expect(lintViewRefs(stack)).toEqual([]);
  });

  it('skips dynamic (interpolated) and non-qualified targets', () => {
    const stack = {
      views: [{ name: 'task', list: listView('task'), formViews: { edit: formView('task') } }],
      actions: [
        { name: 'a', type: 'form', target: 'task.${param.view}' },
        { name: 'b', type: 'form', target: 'bare_key_no_dot' },
      ],
    };
    expect(lintViewRefs(stack)).toEqual([]);
  });
});

describe('lintViewRefs — object name derivation (real defineView shape)', () => {
  // `defineView({...})` containers carry NO top-level name/object — the object
  // lives only in `list.data.object`. The lint must derive it exactly like the
  // runtime loader, or every name-less container silently drops out of the index
  // and its targets read as "missing" (the false negative found dogfooding
  // app-showcase).
  it('indexes a name-less container via list.data.object and accepts a good target', () => {
    const stack = {
      views: [{ list: listView('showcase_task'), formViews: { edit: formView('showcase_task') } }],
      actions: [{ name: 'log_time', type: 'form', target: 'showcase_task.edit' }],
    };
    expect(lintViewRefs(stack)).toEqual([]);
  });

  it('still flags a genuinely missing target on a name-less container', () => {
    const stack = {
      views: [{ list: listView('showcase_task'), formViews: { edit: formView('showcase_task') } }],
      actions: [{ name: 'x', type: 'form', target: 'showcase_task.nope' }],
    };
    expect(lintViewRefs(stack).some((f) => f.rule === VIEW_REF_FORM_TARGET_MISSING)).toBe(true);
  });
});

describe('lintViewRefs — view-key collisions (#2554)', () => {
  it('warns (does NOT fail the build) when formViews.default collides with the implicit default list', () => {
    const stack = {
      views: [{ name: 'task', list: listView('task'), formViews: { default: formView('task') } }],
    };
    const out = lintViewRefs(stack);
    const collision = out.find((f) => f.rule === VIEW_KEY_COLLISION);
    expect(collision).toBeDefined();
    // Fragile, not broken: a rename only breaks something if the name is referenced.
    expect(collision!.severity).toBe('warning');
    expect(collision!.message).toContain("'task.default'");
    expect(collision!.message).toContain("'task.default_2'");
  });

  it('detects the collision in object-nested listViews/formViews too', () => {
    const stack = {
      objects: [
        {
          name: 'task',
          listViews: { mine: listView('task') },
          formViews: { mine: formView('task') },
        },
      ],
    };
    const out = lintViewRefs(stack);
    expect(out.some((f) => f.rule === VIEW_KEY_COLLISION && f.message.includes("'task.mine'"))).toBe(true);
  });

  it('a collision-only stack yields NO error-severity finding — build is not blocked', () => {
    const stack = {
      views: [{ name: 'task', list: listView('task'), formViews: { default: formView('task') } }],
    };
    const out = lintViewRefs(stack);
    expect(out.some((f) => f.rule === VIEW_KEY_COLLISION)).toBe(true); // collision surfaced…
    expect(out.some((f) => f.severity === 'error')).toBe(false); // …but nothing fails the build
  });
});

describe('lintViewRefs — form action target resolution', () => {
  it('errors when a form target names a LIST view (the #2554 runtime symptom)', () => {
    // `default` is the list; the form collides to `default_2`, so `task.default`
    // resolves to the list — exactly what opened a blank form at runtime.
    const stack = {
      views: [{ name: 'task', list: listView('task'), formViews: { default: formView('task') } }],
      actions: [{ name: 'log_time', type: 'form', target: 'task.default' }],
    };
    const out = lintViewRefs(stack);
    const kindErr = out.find((f) => f.rule === VIEW_REF_FORM_TARGET_KIND);
    expect(kindErr).toBeDefined();
    expect(kindErr!.severity).toBe('error');
    expect(kindErr!.message).toContain('list view, not a form view');
  });

  it('warns (possible false positive, does NOT fail) when a form target resolves to no view at all', () => {
    const stack = {
      views: [{ name: 'task', list: listView('task'), formViews: { edit: formView('task') } }],
      actions: [{ name: 'log_time', type: 'form', target: 'task.nope' }],
    };
    const out = lintViewRefs(stack);
    const missWarn = out.find((f) => f.rule === VIEW_REF_FORM_TARGET_MISSING);
    expect(missWarn).toBeDefined();
    // Might be a view the lint failed to collect — warn rather than break the build.
    expect(missWarn!.severity).toBe('warning');
  });

  it('accepts a form target that resolves to an actual form view', () => {
    const stack = {
      views: [{ name: 'task', list: listView('task'), formViews: { edit: formView('task') } }],
      actions: [{ name: 'log_time', type: 'form', target: 'task.edit' }],
    };
    expect(lintViewRefs(stack).filter((f) => f.rule.startsWith('view-ref'))).toEqual([]);
  });

  it('validates object-nested actions against object-nested form views', () => {
    const stack = {
      objects: [
        {
          name: 'task',
          formViews: { edit: formView('task') },
          actions: [{ name: 'nested_form', type: 'form', target: 'task.missing' }],
        },
      ],
    };
    const out = lintViewRefs(stack);
    expect(out.some((f) => f.rule === VIEW_REF_FORM_TARGET_MISSING && f.where.includes("object 'task'"))).toBe(true);
  });

  it('reports a shared (top-level + object-nested) action only once', () => {
    const shared = { name: 'log_time', type: 'form', target: 'task.missing' };
    const stack = {
      views: [{ name: 'task', list: listView('task'), formViews: { edit: formView('task') } }],
      actions: [shared],
      objects: [{ name: 'task', actions: [shared] }],
    };
    const out = lintViewRefs(stack).filter((f) => f.rule === VIEW_REF_FORM_TARGET_MISSING);
    expect(out).toHaveLength(1);
    expect(out[0].where).toContain("object 'task'"); // object-nested context retained
  });
});
