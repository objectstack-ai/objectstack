// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Interfaces-pillar nav-leaf binding (objectui#4019).
 *
 * The gap this pins: an `action` nav item is a LIVE runtime surface — the
 * shipped sidebar renders it and `useNavActionDispatch` executes it
 * (framework#4509) — but the Studio Interfaces rail could not resolve it to a
 * design surface, so the very same entry rendered permanently DISABLED in the
 * designer while it worked in the running app. `action` has had both a
 * registered preview (`ActionPreview`) and a registered default inspector
 * (`ActionDefaultInspector`) all along; only this binding was missing.
 *
 * The fixtures are parsed against the spec's own `NavigationItemSchema` rather
 * than asserted by eye, so this file cannot drift into pinning a shape the
 * schema rejects (the phantom-rule trap): the positive fixture must be
 * spec-VALID for the designer to be required to open it, and the rejected
 * alias spelling must stay unresolvable here because the schema refuses it by
 * name — Commandment #0.1, no second dialect in the consumer.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { NavigationItemSchema, type I18nLabel } from '@objectstack/spec/ui';
import type { NavTargetLabelResolver } from '@object-ui/layout';
import { resolveSurface, findSurfaceInTree, isSameSurface, type NavNode } from './navSurface';

/**
 * The designer locale these binding cases run in. The binding never reads it;
 * only the label does, and the map-label cases at the end of the file pin
 * that half (objectui#11158).
 */
const LOCALE = 'en-US';

/** A spec-valid global-action nav item. */
const ACTION_NODE: NavNode = {
  id: 'nav_run_sync',
  type: 'action',
  label: 'Run Sync',
  actionDef: { actionName: 'sync_now' },
};

describe('resolveSurface — action nav items (objectui#4019)', () => {
  it('the fixture is a real authoring surface: the spec accepts it whole', () => {
    const parsed = NavigationItemSchema.safeParse(ACTION_NODE);
    expect(parsed.success).toBe(true);
  });

  it('binds an action nav leaf to the `action` design surface', () => {
    expect(resolveSurface(ACTION_NODE, LOCALE)).toEqual({
      type: 'action',
      name: 'sync_now',
      label: 'Run Sync',
      navId: 'nav_run_sync',
    });
  });

  it('leaves an action item with no actionName unresolved (stays disabled)', () => {
    expect(resolveSurface({ id: 'nav_x', type: 'action', label: 'Nothing' }, LOCALE)).toBeNull();
    expect(resolveSurface({ id: 'nav_x', type: 'action', label: 'Nothing', actionDef: {} }, LOCALE)).toBeNull();
  });

  it('reads the canonical key ONLY — a spelling the schema rejects stays unresolved', () => {
    // `action` / `name` inside `actionDef` are REJECTED aliases carrying a
    // redirect (objectstack#4001), not second spellings. Measured on
    // spec 17.0.0-rc.6: `unrecognized_keys` on `actionDef` plus a missing
    // `actionName`. A tolerant `??` limb here would resurrect exactly the bug
    // #4001 closed — an entry that dispatches an action the author did not
    // declare — so the designer must refuse what the schema refuses.
    const aliasNode = {
      id: 'nav_run_sync',
      type: 'action',
      label: 'Run Sync',
      actionDef: { action: 'sync_now' },
    };
    const parsed = NavigationItemSchema.safeParse(aliasNode);
    expect(parsed.success).toBe(false);
    expect(resolveSurface(aliasNode as NavNode, LOCALE)).toBeNull();
  });

  it('reaches an action leaf nested in a group (the `?surface=` deep-link path)', () => {
    const tree: NavNode[] = [
      { id: 'g1', type: 'group', label: 'Ops', children: [ACTION_NODE] },
    ];
    expect(findSurfaceInTree(tree, { type: 'action', name: 'sync_now' }, LOCALE)).toEqual({
      type: 'action',
      name: 'sync_now',
      label: 'Run Sync',
      navId: 'nav_run_sync',
    });
  });
});

describe('resolveSurface — the variants around the new one are unchanged', () => {
  it('still binds the surface-bearing leaves', () => {
    expect(resolveSurface({ type: 'page', pageName: 'home', label: 'Home' }, LOCALE)?.type).toBe('page');
    expect(resolveSurface({ type: 'object', objectName: 'crm_lead', label: 'Leads' }, LOCALE)?.name).toBe('crm_lead');
    expect(resolveSurface({ type: 'dashboard', dashboardName: 'sales', label: 'Sales' }, LOCALE)?.name).toBe('sales');
    expect(resolveSurface({ type: 'report', reportName: 'pipeline', label: 'Pipeline' }, LOCALE)?.name).toBe('pipeline');
  });

  it('leaves the variants with no authorable target unresolved', () => {
    // Deliberately NOT openable — `url` points out of the product, `separator`
    // is a divider, and `component` names a first-party UI shipped in code, so
    // none of the three has a metadata item to design. Only `action` was a
    // metadata type sitting in this bucket by omission.
    expect(resolveSurface({ id: 'nav_docs', type: 'url', label: 'Docs', url: 'https://example.com' }, LOCALE)).toBeNull();
    expect(resolveSurface({ id: 'nav_sep', type: 'separator' }, LOCALE)).toBeNull();
    expect(
      resolveSurface({ id: 'nav_dir', type: 'component', label: 'Directory', componentRef: 'metadata:directory' }, LOCALE),
    ).toBeNull();
  });
});

/**
 * objectui#4881 — the binding reads the CANONICAL target key only.
 *
 * This card is subtraction, and subtraction has a trap: a pin that only says
 * `resolveSurface(x) === null` is green because NOTHING WAS PRODUCED, not
 * because the logic is right — it would have passed before the deleted legs
 * as well as after, so it proves nothing either way. Each spelling is
 * therefore pinned as a PAIR on the SAME `type`, and the pair is what carries
 * the proof:
 *
 *   a) the canonical fixture PARSES against `NavigationItemSchema` and
 *      RESOLVES to a surface — green only if the surviving branch really
 *      reads that key; and
 *   b) the bare fixture is REJECTED by the spec, with an `unrecognized_keys`
 *      issue naming that exact key (so the shape cannot reach a saved app),
 *      AND stays unresolved here.
 *
 * The null in (b) is only meaningful because (a) is non-null on the same
 * variant with only the key spelling changed: the leaf is unresolvable
 * because of the SPELLING, not because the variant has no surface.
 *
 * Measured against the installed `@objectstack/spec` 17.0.0 (the card was
 * written against 17.0.0-rc.6): all four bare spellings are still unknown
 * keys, and the union still has no `view` member.
 */
interface Variant {
  type: string;
  canonicalKey: 'pageName' | 'objectName' | 'dashboardName' | 'reportName';
  /** The spelling `AppSchema` answers with `unrecognized_keys`. */
  bareKey: string;
  name: string;
  label: string;
}

const VARIANTS: Variant[] = [
  { type: 'page', canonicalKey: 'pageName', bareKey: 'page', name: 'home', label: 'Home' },
  { type: 'object', canonicalKey: 'objectName', bareKey: 'object', name: 'crm_lead', label: 'Leads' },
  { type: 'dashboard', canonicalKey: 'dashboardName', bareKey: 'dashboard', name: 'sales', label: 'Sales' },
  { type: 'report', canonicalKey: 'reportName', bareKey: 'report', name: 'pipeline', label: 'Pipeline' },
];

/** Every `unrecognized_keys` key the spec named, flattened. */
function unrecognizedKeys(value: unknown): string[] {
  const parsed = NavigationItemSchema.safeParse(value);
  if (parsed.success) return [];
  return parsed.error.issues.flatMap((i) => (i.code === 'unrecognized_keys' ? i.keys : []));
}

describe.each(VARIANTS)(
  'resolveSurface — $type binds `$canonicalKey`, never the bare `$bareKey` (objectui#4881)',
  ({ type, canonicalKey, bareKey, name, label }) => {
    it('the canonical fixture is spec-VALID and resolves to its surface', () => {
      const node = { id: `nav_${name}`, type, label, [canonicalKey]: name } as NavNode;
      expect(NavigationItemSchema.safeParse(node).success).toBe(true);
      expect(resolveSurface(node, LOCALE)).toEqual({ type, name, label, navId: `nav_${name}` });
    });

    it('the bare spelling is `unrecognized_keys` in the spec AND unresolved here', () => {
      const node = { id: `nav_${name}`, type, label, [bareKey]: name } as NavNode;
      // Half one: the shape cannot reach production — the schema refuses it by
      // name, so no saved app can carry it.
      expect(NavigationItemSchema.safeParse(node).success).toBe(false);
      expect(unrecognizedKeys(node)).toContain(bareKey);
      // Half two: the consumer does not parse it either. Non-trivial because
      // the sibling test above resolves the SAME type with only the key
      // spelling changed — this null is about the spelling, not the variant.
      expect(resolveSurface(node, LOCALE)).toBeNull();
    });

    it('a draft carrying BOTH keys binds to the canonical one', () => {
      const node = { id: `nav_${name}`, type, label, [canonicalKey]: name, [bareKey]: 'rejected_spelling' } as NavNode;
      // Such a draft is unsaveable — the bare key alone is enough to fail.
      expect(unrecognizedKeys(node)).toContain(bareKey);
      expect(resolveSurface(node, LOCALE)?.name).toBe(name);
    });
  },
);

describe('resolveSurface — there is no `view` nav variant (objectui#4881)', () => {
  const VIEW_LEAF = { id: 'nav_all', type: 'view', label: 'All Leads', viewName: 'all' } as NavNode;

  it('`type: "view"` fails the discriminator — the union has nine members and none is `view`', () => {
    const parsed = NavigationItemSchema.safeParse(VIEW_LEAF);
    expect(parsed.success).toBe(false);
    const issue = parsed.success ? undefined : parsed.error.issues[0];
    expect(issue?.code).toBe('invalid_union');
    expect(issue?.path).toEqual(['type']);
    // The deleted branch could only ever have run on this — i.e. never.
    expect(resolveSurface(VIEW_LEAF, LOCALE)).toBeNull();
  });

  it('`viewName` is an OPTIONAL key ON the object item, so that leaf still binds as `object`', () => {
    // The reason there is no `view` TYPE: "which list view to open" is a
    // property of an object nav item, not a navigation variant of its own.
    const node = { id: 'nav_lead', type: 'object', label: 'Leads', objectName: 'crm_lead', viewName: 'all' } as NavNode;
    expect(NavigationItemSchema.safeParse(node).success).toBe(true);
    // objectui#11774 — and the entry's `viewName` rides on the Surface, as
    // authored, for the canvas preview; the binding is still `object:crm_lead`.
    expect(resolveSurface(node, LOCALE)).toEqual({
      type: 'object',
      name: 'crm_lead',
      label: 'Leads',
      navId: 'nav_lead',
      viewName: 'all',
    });
  });

  it('the bare `view` key is `unrecognized_keys` even on an otherwise valid object item', () => {
    const node = { id: 'nav_lead', type: 'object', label: 'Leads', objectName: 'crm_lead', view: 'all' } as NavNode;
    expect(unrecognizedKeys(node)).toContain('view');
  });
});

/**
 * objectui#11158 — a nav item's `label` is the spec's `I18nLabel`, and
 * `resolveSurface` resolves it once, in the designer locale.
 *
 * Before this card it read `String(node.label ?? '')`, so a locale map became
 * `[object Object]` in the Surface, and every reader of the Surface (the
 * canvas caption, the breadcrumb, the copilot chip) printed that. The map
 * fixture parses against the spec, so it is an input the designer must handle.
 * The designer locale is `en-US` or `zh-CN` (`useMetadataLocale`).
 */
describe('resolveSurface resolves a locale-map label in the designer locale (objectui#11158)', () => {
  const MAP_NODE: NavNode = { id: 'nav_home', type: 'page', label: { en: 'Home', 'zh-CN': '首页' }, pageName: 'home' };

  it('`NavNode.label` is typed as the spec types it, so the compiler refuses a raw render', () => {
    // Compile-time: `tsc -p tsconfig.test.json` (this package's `type-check`)
    // fails if the type narrows back to `string`, which is what let a map reach
    // JSX unresolved.
    expectTypeOf<NavNode['label']>().toEqualTypeOf<I18nLabel | undefined>();
  });

  it('the map-labelled fixture is spec-VALID', () => {
    expect(NavigationItemSchema.safeParse(MAP_NODE).success).toBe(true);
  });

  it.each([
    ['en-US', 'Home'],
    ['zh-CN', '首页'],
  ])('under %s the Surface carries the text %s, not the map', (locale, text) => {
    expect(resolveSurface(MAP_NODE, locale)).toEqual({ type: 'page', name: 'home', label: text, navId: 'nav_home' });
  });

  it('a plain-string label is carried as authored in both locales (the control)', () => {
    const node: NavNode = { ...MAP_NODE, label: 'Home' };
    expect(resolveSurface(node, 'en-US')?.label).toBe('Home');
    expect(resolveSurface(node, 'zh-CN')?.label).toBe('Home');
  });

  it('an item with no label carries the text it inherits, not an empty label (objectui#11196)', () => {
    // Re-judged by objectui#11196: this case used to pin `label: ''`. An
    // absent label now carries what the runtime's rule answers — for a page,
    // its `pageName` — so the caption, breadcrumb and chip name the leaf as
    // the rail does. The inheritance cases themselves are pinned below.
    const node: NavNode = { id: 'nav_home', type: 'page', pageName: 'home' };
    expect(resolveSurface(node, 'zh-CN')).toEqual({ type: 'page', name: 'home', label: 'home', navId: 'nav_home' });
  });

  it('`findSurfaceInTree` matches on {type,name} (no nav id asked), so the same leaf is found in both locales', () => {
    const tree: NavNode[] = [{ id: 'nav_main', type: 'group', label: { en: 'Main', 'zh-CN': '主要' }, children: [MAP_NODE] }];
    expect(findSurfaceInTree(tree, { type: 'page', name: 'home' }, 'en-US')).toEqual({ type: 'page', name: 'home', label: 'Home', navId: 'nav_home' });
    expect(findSurfaceInTree(tree, { type: 'page', name: 'home' }, 'zh-CN')).toEqual({ type: 'page', name: 'home', label: '首页', navId: 'nav_home' });
  });
});

/**
 * objectui#11196 — `resolveSurface` names a label-less leaf by what it
 * inherits, through the runtime's own rule (`navEntryLabelText` →
 * `resolveNavItemLabel`), asked of the resolver its caller passes.
 *
 * The Studio passes the console's `useNavTargetLabel`; here a plain
 * `NavTargetLabelResolver` stands in for it, answering the object's metadata
 * label. The branch is keyed on ABSENCE, as the runtime's is: an authored label
 * is never swapped for the target's, and a present label that resolves to
 * nothing is not absent.
 */
describe('resolveSurface names a label-less leaf by what it inherits (objectui#11196)', () => {
  const targetLabel: NavTargetLabelResolver = (target) =>
    target.kind === 'object' && target.objectName === 'crm_lead' ? 'Leads' : undefined;
  const LABEL_LESS: NavNode = { id: 'nav_lead', type: 'object', objectName: 'crm_lead' };

  it('the label-less fixture is spec-VALID', () => {
    expect(NavigationItemSchema.safeParse(LABEL_LESS).success).toBe(true);
  });

  it("with the resolver, a label-less object leaf carries its object's label", () => {
    expect(resolveSurface(LABEL_LESS, LOCALE, targetLabel)).toEqual({ type: 'object', name: 'crm_lead', label: 'Leads', navId: 'nav_lead' });
  });

  it('without one, it carries the rule’s machine-name rung, as the console does before its metadata loads', () => {
    expect(resolveSurface(LABEL_LESS, LOCALE)?.label).toBe('crm_lead');
  });

  it('CONTROL: an authored label is carried verbatim, even with a resolver that names the target', () => {
    expect(resolveSurface({ ...LABEL_LESS, label: 'My leads' }, LOCALE, targetLabel)?.label).toBe('My leads');
  });

  it('a label that is present but resolves to nothing is not absent: it carries an empty label', () => {
    expect(resolveSurface({ ...LABEL_LESS, label: {} }, LOCALE, targetLabel)?.label).toBe('');
  });

  it('`findSurfaceInTree` (the `?surface=` restore) hands the resolver to the leaf it finds', () => {
    const tree: NavNode[] = [{ id: 'nav_main', type: 'group', children: [LABEL_LESS] }];
    expect(findSurfaceInTree(tree, { type: 'object', name: 'crm_lead' }, LOCALE, targetLabel)?.label).toBe('Leads');
  });
});

/**
 * objectui#11774 — a Surface is a nav ENTRY, and several entries can open one
 * target. The showcase app's nav holds five entries on `showcase_task`: the
 * plain list, three data slices (`filters`) and one named view (`viewName`).
 * Each binds `object:showcase_task`; before this card each resolved to exactly
 * `{type, name, label}`, so the rail, the deep link and the canvas could not
 * tell them apart — all five highlighted, one unfiltered preview, and a reload
 * landed on the first.
 *
 * The fixture parses against the spec (`id` is required on every nav item),
 * so it is an input the designer must handle.
 */
describe('one object, five entries — a Surface carries its entry (objectui#11774)', () => {
  const TASKS: NavNode = { id: 'nav_tasks', type: 'object', objectName: 'showcase_task', label: 'Tasks' };
  const IN_PROGRESS: NavNode = {
    id: 'nav_slice_in_progress',
    type: 'object',
    objectName: 'showcase_task',
    filters: { status: 'in_progress' },
    label: 'In-Progress Tasks',
  };
  const URGENT: NavNode = {
    id: 'nav_slice_urgent',
    type: 'object',
    objectName: 'showcase_task',
    filters: { priority: 'urgent' },
    label: 'Urgent Tasks',
  };
  const IN_REVIEW: NavNode = {
    id: 'nav_slice_review',
    type: 'object',
    objectName: 'showcase_task',
    filters: { status: 'in_review' },
    label: 'In-Review Tasks',
  };
  const TASK_LIST: NavNode = {
    id: 'nav_report_tabular',
    type: 'object',
    objectName: 'showcase_task',
    viewName: 'tabular',
    label: 'Task List',
  };
  const ENTRIES = [TASKS, IN_PROGRESS, URGENT, IN_REVIEW, TASK_LIST];
  const HOME: NavNode = { id: 'nav_home', type: 'page', pageName: 'home', label: 'Home' };
  const TREE: NavNode[] = [
    HOME,
    { id: 'grp_data', type: 'group', label: 'Data Model', children: [TASKS] },
    { id: 'grp_slices', type: 'group', label: 'Data Slices', children: [IN_PROGRESS, URGENT, IN_REVIEW] },
    { id: 'grp_analytics', type: 'group', label: 'Analytics', children: [TASK_LIST] },
  ];

  it('the fixture is spec-VALID, entry by entry', () => {
    for (const node of ENTRIES) expect(NavigationItemSchema.safeParse(node).success).toBe(true);
  });

  it('each entry resolves to the same target, carrying its own id and its own slice or view', () => {
    expect(ENTRIES.map((n) => resolveSurface(n, LOCALE))).toEqual([
      { type: 'object', name: 'showcase_task', label: 'Tasks', navId: 'nav_tasks' },
      { type: 'object', name: 'showcase_task', label: 'In-Progress Tasks', navId: 'nav_slice_in_progress', filters: { status: 'in_progress' } },
      { type: 'object', name: 'showcase_task', label: 'Urgent Tasks', navId: 'nav_slice_urgent', filters: { priority: 'urgent' } },
      { type: 'object', name: 'showcase_task', label: 'In-Review Tasks', navId: 'nav_slice_review', filters: { status: 'in_review' } },
      { type: 'object', name: 'showcase_task', label: 'Task List', navId: 'nav_report_tabular', viewName: 'tabular' },
    ]);
  });

  it('`isSameSurface` holds for an entry and itself only — never across two entries of one target', () => {
    const surfaces = ENTRIES.map((n) => resolveSurface(n, LOCALE)!);
    for (const a of surfaces) {
      expect(surfaces.filter((b) => isSameSurface(a, b))).toEqual([a]);
    }
  });

  it('an id-less side is compared by {type,name}, the rule before ids were carried', () => {
    const urgent = resolveSurface(URGENT, LOCALE)!;
    expect(isSameSurface(urgent, { type: 'object', name: 'showcase_task' })).toBe(true);
    expect(isSameSurface({ type: 'object', name: 'showcase_task' }, urgent)).toBe(true);
    expect(isSameSurface(urgent, { type: 'object', name: 'showcase_project' })).toBe(false);
  });

  it('a deep link that names a nav id opens THAT entry, not the first of its target', () => {
    expect(
      findSurfaceInTree(TREE, { type: 'object', name: 'showcase_task', navId: 'nav_slice_urgent' }, LOCALE)?.label,
    ).toBe('Urgent Tasks');
    expect(
      findSurfaceInTree(TREE, { type: 'object', name: 'showcase_task', navId: 'nav_report_tabular' }, LOCALE)?.viewName,
    ).toBe('tabular');
  });

  it('BACK-COMPAT: a `<type>:<name>` link with no nav id resolves as before, to the first matching entry', () => {
    expect(findSurfaceInTree(TREE, { type: 'object', name: 'showcase_task' }, LOCALE)?.navId).toBe('nav_tasks');
  });

  it('a nav id no entry carries any more falls back exactly as the same link without it does', () => {
    const gone = { type: 'object', name: 'showcase_task', navId: 'nav_deleted' };
    expect(findSurfaceInTree(TREE, gone, LOCALE)).toEqual(
      findSurfaceInTree(TREE, { type: 'object', name: 'showcase_task' }, LOCALE),
    );
    // An unknown target too: nothing found, so the pillar opens its first leaf.
    expect(findSurfaceInTree(TREE, { type: 'object', name: 'deleted_object', navId: 'nav_deleted' }, LOCALE)).toBeNull();
  });

  it('CONTROL: entries on distinct objects keep resolving one target each', () => {
    const distinct: NavNode[] = [
      { id: 'nav_projects', type: 'object', objectName: 'showcase_project', label: 'Projects' },
      { id: 'nav_tasks', type: 'object', objectName: 'showcase_task', label: 'Tasks' },
    ];
    expect(findSurfaceInTree(distinct, { type: 'object', name: 'showcase_task' }, LOCALE)?.label).toBe('Tasks');
    expect(findSurfaceInTree(distinct, { type: 'object', name: 'showcase_project' }, LOCALE)?.label).toBe('Projects');
  });
});
