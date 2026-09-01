// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  lintViewRefs,
  VIEW_KEY_COLLISION,
  VIEW_REF_FORM_TARGET_MISSING,
  VIEW_REF_FORM_TARGET_KIND,
  VIEW_REF_NAV_VIEW_MISSING,
} from './lint-view-refs.js';
import { runAuthoringRules, splitBySeverity } from './authoring-rules.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// #14108 — app navigation `viewName`, the SECOND door into the same `listViews`
// namespace the #2554 rules above guard.
// ─────────────────────────────────────────────────────────────────────────────

/** Distinct configs so the expander does not dedupe the default `list` into a
 *  structurally identical `listViews` entry — the fixture needs BOTH so the
 *  default's real key is observable. */
const navListView = (object: string, label: string, column: string) => ({
  type: 'grid',
  label,
  columns: [column],
  data: { provider: 'object', object },
});

const NAV_OBJECT = {
  name: 'duly_task',
  list: navListView('duly_task', 'All tasks', 'title'),
  listViews: {
    schedule: navListView('duly_task', 'Schedule', 'due_at'),
    board: navListView('duly_task', 'Board', 'status'),
  },
  formViews: { edit: formView('duly_task') },
};

const navStack = (nav: Record<string, unknown>, appExtra: Record<string, unknown> = {}) => ({
  objects: [NAV_OBJECT],
  apps: [{ name: 'duly', label: 'Duly', navigation: [nav], ...appExtra }],
});

const navFindings = (stack: Record<string, unknown>) =>
  lintViewRefs(stack).filter((f) => f.rule === VIEW_REF_NAV_VIEW_MISSING);

describe('lintViewRefs — navigation viewName resolution (#14108)', () => {
  it('errors when a nav viewName names no list view on its object (the measured repro)', () => {
    const out = navFindings(
      navStack({ id: 'nav_schedule', type: 'object', objectName: 'duly_task', viewName: 'A4_no_such_view', label: 'Schedule' }),
    );
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('error');
    expect(out[0].where).toBe("app 'duly' · nav 'nav_schedule'");
    // The available list views are listed the way the platform's other
    // unknown-name findings list theirs — short (authorable) keys, not
    // expanded `<object>.<key>` ids.
    expect(out[0].message).toContain('board, default, schedule');
    expect(out[0].message).not.toContain('duly_task.schedule');
  });

  it('suggests the near-miss name a rename left behind', () => {
    const out = navFindings(
      navStack({ id: 'n', type: 'object', objectName: 'duly_task', viewName: 'schedul', label: 'Schedule' }),
    );
    expect(out[0].hint).toContain('Did you mean "schedule"?');
  });

  it('accepts a viewName that names a declared listViews key', () => {
    expect(navFindings(navStack({ id: 'n', type: 'object', objectName: 'duly_task', viewName: 'schedule', label: 'S' }))).toEqual([]);
  });

  it("accepts the default `list`'s real expansion key — which is `default`, not `all`", () => {
    // The schema documents viewName as 'Defaults to "all"'. That describes the
    // CONVENTION of declaring a `listViews.all`, not a magic fallback name:
    // `expandViewContainer` keys a bare default `list` as `<object>.default`,
    // and objectui's `resolveViewId` has no special case for 'all' either.
    expect(navFindings(navStack({ id: 'n', type: 'object', objectName: 'duly_task', viewName: 'default', label: 'D' }))).toEqual([]);
    const undeclaredAll = navFindings(
      navStack({ id: 'n', type: 'object', objectName: 'duly_task', viewName: 'all', label: 'A' }),
    );
    expect(undeclaredAll).toHaveLength(1);
  });

  it("accepts 'all' once the object actually declares it (the app-crm convention)", () => {
    const stack = {
      objects: [{ ...NAV_OBJECT, listViews: { ...NAV_OBJECT.listViews, all: navListView('duly_task', 'All', 'title') } }],
      apps: [{ name: 'duly', navigation: [{ id: 'n', type: 'object', objectName: 'duly_task', viewName: 'all', label: 'A' }] }],
    };
    expect(navFindings(stack)).toEqual([]);
  });

  it('accepts a FULLY QUALIFIED viewName, exactly as the runtime matcher does', () => {
    // objectui's `resolveViewId` accepts `<object>.<key>` as well as the short
    // key. A lint stricter than the matcher would red a name that works.
    expect(
      navFindings(navStack({ id: 'n', type: 'object', objectName: 'duly_task', viewName: 'duly_task.schedule', label: 'S' })),
    ).toEqual([]);
  });

  it('resolves against an independent (already-expanded) top-level ViewItem', () => {
    const stack = {
      objects: [{ name: 'duly_task' }],
      views: [{ name: 'duly_task.mine', object: 'duly_task', viewKind: 'list', ...navListView('duly_task', 'Mine', 'title') }],
      apps: [{ name: 'duly', navigation: [{ id: 'n', type: 'object', objectName: 'duly_task', viewName: 'mine', label: 'M' }] }],
    };
    expect(navFindings(stack)).toEqual([]);
  });

  it('names the form-view case explicitly rather than reporting a bare miss', () => {
    const out = navFindings(navStack({ id: 'n', type: 'object', objectName: 'duly_task', viewName: 'edit', label: 'E' }));
    expect(out).toHaveLength(1);
    expect(out[0].message).toContain('resolves to a FORM view');
    expect(out[0].hint).toContain("type:'form' action target");
  });

  it('recurses into `group` children AND into an `object` item’s own children', () => {
    const stack = {
      objects: [NAV_OBJECT],
      apps: [{
        name: 'duly',
        navigation: [{
          id: 'grp', type: 'group', label: 'Work',
          children: [{
            id: 'parent', type: 'object', objectName: 'duly_task', viewName: 'schedule', label: 'Tasks',
            children: [{ id: 'deep', type: 'object', objectName: 'duly_task', viewName: 'A4_no_such_view', label: 'Deep' }],
          }],
        }],
      }],
    };
    const out = navFindings(stack);
    expect(out).toHaveLength(1);
    expect(out[0].where).toContain("nav 'deep'");
  });

  it('walks the `areas[]` nav container too, not only `navigation`', () => {
    const bad = { id: 'in_area', type: 'object', objectName: 'duly_task', viewName: 'A4_no_such_view', label: 'X' };
    for (const area of [{ name: 'a', items: [bad] }, { name: 'a', navigation: [bad] }]) {
      const out = navFindings({ objects: [NAV_OBJECT], apps: [{ name: 'duly', areas: [area] }] });
      expect(out).toHaveLength(1);
      expect(out[0].where).toContain("nav 'in_area'");
    }
  });

  it('reports each distinct nav entry once', () => {
    const stack = {
      objects: [NAV_OBJECT],
      apps: [{
        name: 'duly',
        navigation: [
          { id: 'a', type: 'object', objectName: 'duly_task', viewName: 'A4_no_such_view', label: 'A' },
          { id: 'b', type: 'object', objectName: 'duly_task', viewName: 'A4_no_such_view', label: 'B' },
        ],
      }],
    };
    expect(navFindings(stack).map((f) => f.where)).toEqual([
      "app 'duly' · nav 'a'",
      "app 'duly' · nav 'b'",
    ]);
  });
});

describe('lintViewRefs — navigation viewName exemptions (false positives stay near zero)', () => {
  const bogus = 'A4_no_such_view';

  it('skips an interpolated viewName (resolved at render time)', () => {
    expect(navFindings(navStack({ id: 'n', type: 'object', objectName: 'duly_task', viewName: '${params.view}', label: 'X' }))).toEqual([]);
  });

  it('skips an entry carrying `requiresObject` — another package provides the object', () => {
    expect(
      navFindings(navStack({ id: 'n', type: 'object', objectName: 'duly_task', viewName: bogus, requiresObject: 'duly_task', label: 'X' })),
    ).toEqual([]);
  });

  it('skips when `recordId` is set — the schema documents viewName as ignored there', () => {
    expect(
      navFindings(navStack({ id: 'n', type: 'object', objectName: 'duly_task', viewName: bogus, recordId: '{current_user_id}', label: 'X' })),
    ).toEqual([]);
  });

  it('says nothing about an object this stack declares no list views for', () => {
    // Indistinguishable from a cross-package object, so the rule stays silent
    // rather than guessing — the precondition that lets it be an ERROR at all.
    const stack = {
      objects: [{ name: 'other_object' }],
      apps: [{ name: 'duly', navigation: [{ id: 'n', type: 'object', objectName: 'not_here', viewName: bogus, label: 'X' }] }],
    };
    expect(navFindings(stack)).toEqual([]);
  });

  it('says nothing when the nav entry names no view at all', () => {
    expect(navFindings(navStack({ id: 'n', type: 'object', objectName: 'duly_task', label: 'X' }))).toEqual([]);
  });

  it('leaves the repo’s own shipped nav shapes alone (no error on a resolvable stack)', () => {
    const stack = {
      objects: [NAV_OBJECT],
      apps: [{
        name: 'duly',
        navigation: [
          { id: 'a', type: 'object', objectName: 'duly_task', viewName: 'schedule', label: 'S', icon: 'calendar' },
          { id: 'b', type: 'object', objectName: 'duly_task', label: 'Default landing' },
          { id: 'c', type: 'page', pageName: 'pricing', label: 'Pricing' },
          { id: 'd', type: 'url', url: 'https://example.com', label: 'Docs' },
        ],
      }],
    };
    expect(navFindings(stack)).toEqual([]);
  });
});

/**
 * The card's binding acceptance criterion, pinned end-to-end rather than
 * inferred from the registry entry (the #14148 / #14107 precedent): the
 * measured repro must fail `validate` AND `build`. The card measured
 * `os validate --json` returning `valid: true` and `os build` green, so a
 * validate-only fix was not acceptable — and nothing else in this file would
 * notice if the suite entry's `commands` were narrowed later.
 */
describe('#14108 acceptance — a nav viewName miss gates `validate` AND `build`', () => {
  const repro = navStack({
    id: 'nav_schedule', type: 'object', objectName: 'duly_task',
    viewName: 'A4_no_such_view', label: 'Schedule', icon: 'gantt-chart',
  });
  const clean = navStack({
    id: 'nav_schedule', type: 'object', objectName: 'duly_task',
    viewName: 'schedule', label: 'Schedule', icon: 'gantt-chart',
  });

  for (const command of ['validate', 'build'] as const) {
    it(`the measured repro fails \`${command}\``, () => {
      const { errors } = splitBySeverity(runAuthoringRules(command, { normalized: repro as never }));
      expect(errors.map((f) => f.rule)).toContain(VIEW_REF_NAV_VIEW_MISSING);
    });

    it(`the corrected nav entry passes \`${command}\``, () => {
      const { errors, advisories } = splitBySeverity(runAuthoringRules(command, { normalized: clean as never }));
      expect([...errors, ...advisories].filter((f) => f.rule === VIEW_REF_NAV_VIEW_MISSING)).toEqual([]);
    });
  }
});
