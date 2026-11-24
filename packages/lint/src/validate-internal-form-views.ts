// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `form-view-internal-not-loaded` — an app still declares an internal create or
 * edit form (#36425).
 *
 * The Console's record create and edit surfaces (the create dialog, the
 * full-page create, a create or edit an action opens, the edit dialog) no
 * longer load an object's form view. They lay out by the object's
 * `fieldGroups` and follow the rules on its fields (`visibleWhen`,
 * `readonlyWhen`, `requiredWhen`, `required`, `showOnCreate`). A declared
 * internal form still parses, installs and runs; it steers nothing. This rule
 * says so, once per form, as a warning: nothing is broken, and the app keeps
 * working.
 *
 * ## Which forms are internal create / edit forms
 *
 * The ones those surfaces used to load, and only those:
 *
 *  - a view container's default `form`, and its `formViews.default` (the
 *    legacy container shape) — what create and edit opened;
 *  - its `formViews.create` — what a create opened when declared;
 *  - a stored form ViewItem (`{ name, object, viewKind: 'form', config }`) that
 *    carries `isDefault: true`, or is named `OBJECT.create`.
 *
 * A form shared publicly (`sharing.enabled: true`) is a public form, which
 * keeps loading at its own link: never reported. That is the one test for a
 * public form. A form view under any other name is a NAMED form, which an
 * action of type `form` opens by its name and which keeps loading: never
 * reported either.
 *
 * ## A default or create form an action opens by name (#36545)
 *
 * Seat ruling 5 on #36425: "A form an action opens by name (action type
 * `form`, `/forms/:name`, `/apps/:app/forms/:name`) is not the object's create
 * or edit form and keeps loading." So a default or `OBJECT.create` form that
 * some `type: 'form'` action in the stack targets is not reported either.
 *
 * "By name" is matched the way the Console resolves it, and no looser: the
 * action runner routes the target to `/forms/:name` and `FormPage` reads
 * `/meta/view/:name` with that string, so the target must EQUAL the name the
 * form is served under. A stored item is served under its own `name`; a
 * container's form is served under the name the spec's own expansion gives it
 * ({@link servedFormNames}: `expandViewContainer`, collisions included, on the
 * object `deriveViewContainerObject` binds), never a hand-built
 * `<object>.<key>`. An interpolated target names no form statically and
 * exempts nothing. The actions read are the registered ones (`actions[]`,
 * `objects[].actions[]`) and a page component's inline `properties.action`.
 */

import {
  deriveViewContainerObject,
  expandViewContainer,
  isAggregatedViewContainer,
} from '@objectstack/spec';
import { collectionEntries } from './collection-entries.js';
import { recordsOf } from './object-graph.js';
import { walkPageComponents } from './page-walk.js';
import { formViewSites, viewObjectName } from './view-walk.js';

export const FORM_VIEW_INTERNAL_NOT_LOADED = 'form-view-internal-not-loaded';

export interface InternalFormViewFinding {
  /** Always `warning`: the form is inert, and nothing fails. */
  severity: 'warning';
  rule: typeof FORM_VIEW_INTERNAL_NOT_LOADED;
  /** Human-readable location, e.g. `view "account" · form`. */
  where: string;
  /** Config path of the form, e.g. `views[2].formViews.create`. */
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** The card's one test for a public form: `sharing.enabled === true`. */
function isPublicForm(form: AnyRec): boolean {
  return isRec(form.sharing) && form.sharing.enabled === true;
}

/**
 * The literal target of a `type: 'form'` action — the view name the Console
 * opens — or `undefined` for any other action and for an interpolated target.
 */
function formActionTarget(action: unknown): string | undefined {
  if (!isRec(action) || action.type !== 'form') return undefined;
  const target = strName(action.target);
  return target && !target.includes('{') ? target : undefined;
}

/**
 * Every view name a `type: 'form'` action in the stack opens: registered
 * actions (top-level and object-bound) and the inline action a page component
 * carries (`properties.action`, e.g. an `element:button`).
 */
function formNamesOpenedByAction(stack: AnyRec): Set<string> {
  const opened = new Set<string>();
  const add = (action: unknown) => {
    const target = formActionTarget(action);
    if (target) opened.add(target);
  };
  for (const action of recordsOf(stack.actions)) add(action);
  for (const obj of recordsOf(stack.objects)) {
    for (const action of recordsOf(obj.actions)) add(action);
  }
  const pages = recordsOf(stack.pages);
  for (let i = 0; i < pages.length; i++) {
    for (const { component } of walkPageComponents(pages[i], `pages[${i}]`)) {
      if (isRec(component.properties)) add(component.properties.action);
    }
  }
  return opened;
}

/**
 * The names a view container's forms are served under, keyed by the site's
 * `surface` (`form`, `formViews.KEY`): the spec's own expansion, run on the
 * object the registrars bind the container to. Empty when the container binds
 * no object, which the runtime does not expand either.
 */
function servedFormNames(view: AnyRec): Map<string, string> {
  const names = new Map<string, string>();
  if (!isAggregatedViewContainer(view)) return names;
  const object = deriveViewContainerObject(view);
  if (!object) return names;
  const forms = expandViewContainer(object, view).filter((item) => item.viewKind === 'form');
  // The expansion serves each `formViews` entry that is an object, in key
  // order (its own skip test, copied), then `form` (the one item flagged
  // `isDefault`).
  const named = forms.filter((item) => item.isDefault !== true);
  const keys = view.formViews && typeof view.formViews === 'object'
    ? Object.entries(view.formViews).filter(([, v]) => !!v && typeof v === 'object').map(([k]) => k)
    : [];
  keys.forEach((key, i) => {
    if (named[i]) names.set(`formViews.${key}`, named[i].name);
  });
  const defaultForm = forms.find((item) => item.isDefault === true);
  if (defaultForm) names.set('form', defaultForm.name);
  return names;
}

/** What the author reads: the card's sentence, the same at every site. */
const HINT =
  'Internal forms are no longer loaded: use field groups (`fieldGroups`) for sections, and put required ' +
  'and show/hide rules on the fields (`required`, `requiredWhen`, `visibleWhen`, `showOnCreate`). The ' +
  'form still installs and runs, and changes nothing. A form shared publicly (`sharing.enabled: true`) ' +
  'keeps loading.';

/**
 * Report every internal create / edit form view the stack declares. Returns
 * findings (empty = none). Advisory only: the caller must never fail on these.
 */
export function validateInternalFormViews(stack: AnyRec): InternalFormViewFinding[] {
  const findings: InternalFormViewFinding[] = [];
  const openedByAction = formNamesOpenedByAction(stack);

  for (const { rec: view, path: viewPath } of collectionEntries(stack.views, 'views')) {
    // A container carries no name of its own: it is named by the object its
    // default form or list binds, so a finding reads the same wherever the
    // container sits in `views[]`.
    const viewName =
      strName(view.name)
      ?? viewObjectName(view)
      ?? (isRec(view.form) ? viewObjectName(view.form) : undefined)
      ?? (isRec(view.list) ? viewObjectName(view.list) : undefined)
      ?? viewPath;
    // `served` is the name the Console opens the form under, when it has one.
    const sites: Array<{ form: AnyRec; path: string; surface: string; served?: string }> = [];
    const served = servedFormNames(view);

    for (const site of formViewSites(view, viewPath)) {
      if (site.kind === 'form') {
        sites.push({ form: site.view, path: site.path, surface: site.surface, served: served.get(site.surface) });
      } else if (site.kind === 'formView') {
        const key = site.surface.slice('formViews.'.length);
        if (key === 'create' || key === 'default') {
          sites.push({ form: site.view, path: site.path, surface: site.surface, served: served.get(site.surface) });
        }
      }
    }

    // A stored form ViewItem: the default form (`isDefault`), or the object's
    // `create` form, by the name the Console looked it up under.
    if (view.viewKind === 'form') {
      const object = viewObjectName(view);
      const isCreate = !!object && view.name === `${object}.create`;
      if (view.isDefault === true || isCreate) {
        const form = isRec(view.config) ? view.config : view;
        const path = isRec(view.config) ? `${viewPath}.config` : viewPath;
        sites.push({ form, path, surface: isRec(view.config) ? 'config' : '', served: strName(view.name) });
      }
    }

    for (const site of sites) {
      if (isPublicForm(site.form)) continue;
      // Opened by name by a `type: 'form'` action: it keeps loading (#36545).
      if (site.served && openedByAction.has(site.served)) continue;
      const where = site.surface ? `view "${viewName}" · ${site.surface}` : `view "${viewName}"`;
      findings.push({
        severity: 'warning',
        rule: FORM_VIEW_INTERNAL_NOT_LOADED,
        where,
        path: site.path,
        message:
          `${where}: this internal create/edit form is no longer loaded — create and edit lay the ` +
          `object out by its field groups and follow the rules on its fields`,
        hint: HINT,
      });
    }
  }

  return findings;
}
