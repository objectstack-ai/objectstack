// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app shell an author ships, judged for the three ways it publishes and
 * then shows the user less than was built (#35143, Views, dashboards and app
 * shell family). All three are advisory: each shape is a legitimate step in
 * building an app, and none of them breaks a request.
 *
 * ## `app-navigation-empty` — an app with no navigation entry
 *
 * The console's app root asks whether the app serves any entry at all
 * (`appServesNoNavigation` in objectui, over the app's `navigation` and every
 * `areas[].navigation`, with a `separator` and a `group` with no entry under it
 * counting as nothing), and on a no it renders the "no access" empty state to
 * every member, the author included: the app opens on nothing. Navigation
 * another package contributes into the app (`navigationContributions`,
 * ADR-0029 D7) does count, and this stack's own contributions are read; a
 * contribution from a package this stack cannot see is why the rule is a
 * warning, as is Studio, which may save a new app before its first entry.
 * Runs on the runtime `app` door: the written app is the whole question.
 *
 * ## `object-unreachable-from-navigation` — an object no app opens
 *
 * An object the stack declares and no navigation entry of any app (nor any
 * navigation the stack contributes into another package's app) names in a
 * `type: 'object'` entry. The finding claims only what it read: no navigation
 * entry opens the object's list. Not judged, because the shell shows the
 * object some other way or the object is not meant to be listed:
 *
 *  - a stack that declares no app and contributes no navigation (a package of
 *    objects other packages present);
 *  - an object with a `master_detail` field, or one another object names in
 *    its `relatedLists` (bare `child` / `child.field`, or the object form's
 *    `list`): it is shown as a related list on its parent's record page;
 *  - an object a page names (an `object` / `objectName` value anywhere in a
 *    page that a `type: 'page'` entry opens): the page presents it;
 *  - an object whose `enable.apiEnabled` is `false`: its list cannot be served,
 *    which `nav-object-unservable` already says of any entry that opens it.
 *
 * ## `object-without-view` — an object opened from navigation with no list view
 *
 * An object a navigation entry opens as a list (a `type: 'object'` entry with
 * no `recordId`, which opens one record instead) that declares no list view:
 * no `listViews` entry and no `views[]` item bound to it. The console then
 * builds an "All records" tab of its own (`buildViewTabs`' fallback in
 * objectui): the name field followed by `highlightFields`, or by the first five
 * fields in declared order, with no filter, sort or grouping and no second tab.
 * It works; it is the list nobody designed. Judged only where navigation opens
 * the object, which is the one place that list is shown.
 *
 * The two object findings need every app, view and object of the stack, a
 * collection the runtime gate's per-write snapshot does not carry, so they run
 * on `os validate` / `lint` / `build` only.
 */

import { packagesOf, recordsOf } from './object-graph.js';

type AnyRec = Record<string, unknown>;

export const APP_NAVIGATION_EMPTY = 'app-navigation-empty';
export const OBJECT_UNREACHABLE_FROM_NAVIGATION = 'object-unreachable-from-navigation';
export const OBJECT_WITHOUT_VIEW = 'object-without-view';

export interface AppShellReachFinding {
  severity: 'warning';
  rule: string;
  where: string;
  path: string;
  message: string;
  hint: string;
}

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);
const strName = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

/**
 * Whether a navigation tree holds an entry the shell draws: anything but a
 * `separator`, and a `group` only through an entry under it — the structural
 * half of objectui's `hasVisibleNavigationItems`, with no gate asked.
 */
function hasEntry(items: unknown): boolean {
  if (!Array.isArray(items)) return false;
  return items.some((item) => {
    if (!isRec(item)) return false;
    if (item.type === 'separator') return false;
    if (item.type === 'group') return hasEntry(item.children);
    return true;
  });
}

/** What a navigation tree opens, at any depth. */
interface NavReach {
  /** Every `objectName` a `type: 'object'` entry names. */
  objects: Set<string>;
  /** The subset an entry opens as a LIST: one with no `recordId`. */
  lists: Set<string>;
  /** Every `pageName` a `type: 'page'` entry names. */
  pages: Set<string>;
}

function collectNav(items: unknown, into: NavReach): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isRec(item)) continue;
    const objectName = item.type === 'object' ? strName(item.objectName) : undefined;
    if (objectName) {
      into.objects.add(objectName);
      if (item.recordId === undefined) into.lists.add(objectName);
    }
    const pageName = item.type === 'page' ? strName(item.pageName) : undefined;
    if (pageName) into.pages.add(pageName);
    if (item.type !== 'separator') collectNav(item.children, into);
  }
}

/** Every string an `object` or `objectName` key holds anywhere under `node`. */
function collectNamedObjects(node: unknown, into: Set<string>, depth = 0): void {
  if (depth > 64) return;
  if (Array.isArray(node)) {
    for (const v of node) collectNamedObjects(v, into, depth + 1);
    return;
  }
  if (!isRec(node)) return;
  for (const [key, v] of Object.entries(node)) {
    const named = key === 'object' || key === 'objectName' ? strName(v) : undefined;
    if (named) into.add(named);
    else collectNamedObjects(v, into, depth + 1);
  }
}

/** The child object a `relatedLists` entry names: `child`, `child.field`, or the object form's `list`. */
function relatedListChild(entry: unknown): string | undefined {
  const spelled = typeof entry === 'string' ? entry : isRec(entry) ? strName(entry.list) : undefined;
  return spelled ? strName(spelled.split('.')[0]) : undefined;
}

/** One collection holder: the stack itself, or one `packages[].manifest` body. */
interface Holder {
  body: AnyRec;
  /** Path prefix of the holder, `''` for the stack itself. */
  prefix: string;
}

/**
 * The holders whose navigation COUNTS toward reach: the stack and every
 * package of an assembled artifact, so an entry one package contributes into
 * another's app reaches the object wherever the object is judged. Only the
 * stack itself (the first holder) is JUDGED: an assembled artifact's
 * `packages[]` is judged by the CLI's per-package run
 * (`runPerPackageAuthoringRules`), which hands each package to these rules as
 * a stack of its own; judging it here too would report each item twice.
 */
function reachHolders(stack: AnyRec): Holder[] {
  const holders: Holder[] = [{ body: stack, prefix: '' }];
  packagesOf(stack).forEach((entry, i) => {
    if (isRec(entry.manifest)) holders.push({ body: entry.manifest, prefix: `packages[${i}].manifest.` });
  });
  return holders;
}

/** The navigation contributions a holder makes: its own key, or its manifest's. */
function contributionsOf(body: AnyRec): AnyRec[] {
  const own = recordsOf(body.navigationContributions);
  const viaManifest = isRec(body.manifest) ? recordsOf(body.manifest.navigationContributions) : [];
  return [...own, ...viaManifest];
}

/** The apps a holder declares, with each one's path. */
function appsOf(holder: Holder): Array<{ app: AnyRec; path: string; name: string }> {
  const apps = holder.body.apps;
  if (Array.isArray(apps)) {
    return apps.flatMap((app, i) =>
      isRec(app) ? [{ app, path: `${holder.prefix}apps[${i}]`, name: strName(app.name) ?? `#${i}` }] : [],
    );
  }
  if (isRec(apps)) {
    return Object.entries(apps).flatMap(([name, app]) =>
      isRec(app) ? [{ app, path: `${holder.prefix}apps.${name}`, name: strName(app.name) ?? name }] : [],
    );
  }
  return [];
}

/** Every app `name` some navigation contribution of the stack targets. */
function contributedAppNames(holders: readonly Holder[]): Set<string> {
  const names = new Set<string>();
  for (const holder of holders) {
    for (const contribution of contributionsOf(holder.body)) {
      const app = strName(contribution.app);
      if (app && hasEntry(contribution.items)) names.add(app);
    }
  }
  return names;
}

/**
 * `app-navigation-empty`: every app with no entry in `navigation` nor in any
 * `areas[].navigation`, and no contribution of this stack into it.
 */
export function validateAppNavigationPresent(stack: AnyRec): AppShellReachFinding[] {
  const findings: AppShellReachFinding[] = [];
  if (!isRec(stack)) return findings;
  const contributed = contributedAppNames(reachHolders(stack));
  for (const { app, path, name } of appsOf({ body: stack, prefix: '' })) {
    if (hasEntry(app.navigation)) continue;
    if (recordsOf(app.areas).some((area) => hasEntry(area.navigation))) continue;
    if (contributed.has(name)) continue;
    findings.push({
      severity: 'warning',
      rule: APP_NAVIGATION_EMPTY,
      where: `app "${name}"`,
      path: `${path}.navigation`,
      message:
        `app "${name}" has no navigation entry (none in \`navigation\` or in any \`areas[].navigation\`), so ` +
        'it opens on the "no access" empty state for every member, its author included',
      hint:
        "Add an entry that opens something, e.g. `navigation: [{ id: 'nav_home', type: 'object', label: '…', " +
        "objectName: '<object>' }]`, or remove the app",
    });
  }
  return findings;
}

/** Whether a list-view-bearing view record binds `object`. */
function viewBinds(view: AnyRec, object: string): boolean {
  const bound = (v: unknown): string | undefined =>
    isRec(v) && isRec(v.data) ? strName(v.data.object) : undefined;
  if (strName(view.objectName) === object || strName(view.object) === object) return true;
  if (bound(view) === object || bound(view.list) === object || bound(view.config) === object) return true;
  return isRec(view.listViews) && Object.values(view.listViews).some((lv) => bound(lv) === object);
}

/** Whether an object declares a list view of its own (`ObjectSchema.listViews`). */
function declaresOwnView(obj: AnyRec): boolean {
  return isRec(obj.listViews) && Object.values(obj.listViews).some(isRec);
}

function hasMasterDetailField(obj: AnyRec): boolean {
  return recordsOf(obj.fields).some((f) => f.type === 'master_detail');
}

/**
 * `object-unreachable-from-navigation` and `object-without-view` over every
 * object the stack declares.
 */
export function validateObjectShellReach(stack: AnyRec): AppShellReachFinding[] {
  const findings: AppShellReachFinding[] = [];
  if (!isRec(stack)) return findings;
  const holders = reachHolders(stack);

  const nav: NavReach = { objects: new Set(), lists: new Set(), pages: new Set() };
  let navigates = false;
  for (const holder of holders) {
    for (const { app } of appsOf(holder)) {
      navigates = true;
      collectNav(app.navigation, nav);
      for (const area of recordsOf(app.areas)) collectNav(area.navigation, nav);
    }
    for (const contribution of contributionsOf(holder.body)) {
      navigates = true;
      collectNav(contribution.items, nav);
    }
  }
  if (!navigates) return findings;

  // Shown some other way: through a page navigation opens, or as a related
  // list on a parent's record page.
  const shownElsewhere = new Set<string>();
  for (const holder of holders) {
    for (const page of recordsOf(holder.body.pages)) {
      const name = strName(page.name);
      if (name && nav.pages.has(name)) collectNamedObjects(page, shownElsewhere);
    }
    for (const obj of recordsOf(holder.body.objects)) {
      for (const entry of Array.isArray(obj.relatedLists) ? obj.relatedLists : []) {
        const child = relatedListChild(entry);
        if (child) shownElsewhere.add(child);
      }
    }
  }

  const views = holders.flatMap((holder) => recordsOf(holder.body.views));

  const objects = Array.isArray(stack.objects) ? stack.objects : [];
  objects.forEach((obj, i) => {
    if (!isRec(obj)) return;
    const name = strName(obj.name);
    if (!name) return;
    const path = `objects[${i}]`;
    if (!nav.objects.has(name)) {
      if (shownElsewhere.has(name) || hasMasterDetailField(obj)) return;
      if (isRec(obj.enable) && obj.enable.apiEnabled === false) return;
      findings.push({
        severity: 'warning',
        rule: OBJECT_UNREACHABLE_FROM_NAVIGATION,
        where: `object "${name}"`,
        path,
        message:
          `no navigation entry opens object "${name}" (no \`type: 'object'\` entry names it, no page an entry ` +
          "opens names it, and no object lists it in `relatedLists`), so the app shell offers no way to its list",
        hint:
          `Add \`{ id: 'nav_${name}', type: 'object', label: '…', objectName: '${name}' }\` to an app's ` +
          "`navigation`, or name it in its parent object's `relatedLists` so it shows on the parent's record page",
      });
      return;
    }
    if (!nav.lists.has(name)) return;
    if (declaresOwnView(obj) || views.some((view) => viewBinds(view, name))) return;
    findings.push({
      severity: 'warning',
      rule: OBJECT_WITHOUT_VIEW,
      where: `object "${name}"`,
      path,
      message:
        `object "${name}" is opened from navigation but declares no list view, so the console builds an ` +
        '"All records" tab of its own: the name field and `highlightFields` (or the first five fields), ' +
        'with no filter, sort or grouping and no other tab',
      hint:
        `Declare the list users should see: \`listViews: { all: { type: 'grid', columns: [...] } }\` on ` +
        `"${name}", or a ` +
        `\`views\` entry bound to it (\`defineView({ object: '${name}', list: { ... } })\`)`,
    });
  });
  return findings;
}
