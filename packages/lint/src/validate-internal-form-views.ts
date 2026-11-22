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
 */

import { collectionEntries } from './collection-entries.js';
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

  for (const { rec: view, path: viewPath } of collectionEntries(stack.views, 'views')) {
    const viewName = strName(view.name) ?? strName(view.object) ?? viewPath;
    const sites: Array<{ form: AnyRec; path: string; surface: string }> = [];

    for (const site of formViewSites(view, viewPath)) {
      if (site.kind === 'form') {
        sites.push({ form: site.view, path: site.path, surface: site.surface });
      } else if (site.kind === 'formView') {
        const key = site.surface.slice('formViews.'.length);
        if (key === 'create' || key === 'default') {
          sites.push({ form: site.view, path: site.path, surface: site.surface });
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
        sites.push({ form, path, surface: isRec(view.config) ? 'config' : '' });
      }
    }

    for (const site of sites) {
      if (isPublicForm(site.form)) continue;
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
