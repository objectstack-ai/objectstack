// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A form's `thank-you` panel may name only a field the engine generates on
 * insert (ruling B on #28005, ruling record 6545210989).
 *
 * The panel's `title` / `message` interpolate a field of the record just
 * submitted as `{{record.field_name}}`; the spec door holds the token's shape
 * (`FormViewSchema`, `ui/view.zod.ts`) and `thankYouRecordFieldNames`
 * (`@objectstack/spec/ui`) is the one reading of which fields a panel names.
 * What the shape cannot decide is whether a named field is one an anonymous
 * visitor may be shown. The submit answer of a public form echoes nothing the
 * insert stored, because a `beforeInsert` / `afterInsert` hook — an elevated
 * one included — can derive a stored value from records the anonymous form
 * grant may never read. So the answer carries `id` plus exactly the named
 * fields (`PublicFormSubmitResponseSchema`, `@objectstack/spec/api`), and a
 * name is admitted only when its field's type is in `RUNTIME_OWNED_FIELD_TYPES`
 * (`@objectstack/spec/data`, today `autonumber`): the engine mints that value
 * itself, so no hook could have put it there. ⛔ This rule carries no list of
 * its own; widening that set widens what it admits, with no edit here.
 *
 * Every other name is refused where it is written, naming the field and its
 * type: a declared field of another type, a registry-injected column
 * (`created_at`, `owner_id`, `id`, … — injected, not engine-numbered), and a
 * name the object does not declare at all (the panel would print nothing).
 *
 * ## Which forms
 *
 * Every form that carries a `thank-you` panel, public or not: the slot is one
 * slot with one admission, and a form that is internal today is made public by
 * flipping its `sharing`, which is a write this rule would otherwise never see
 * again.
 *
 * - A `views[]` entry's forms: the bare form-view shape itself, the nested
 *   `form`, every `formViews` entry and the flattened `config` of a
 *   `viewKind: 'form'` item. The object is the one `anonymousFormObjectName`
 *   resolves, the rung order both anonymous doors submit by.
 * - A page `object-form` component (`properties.submitBehavior`, the form
 *   view's own block by reference). Its object is its `properties.objectName`,
 *   else the binding the page walk resolves.
 *
 * A form whose object does not resolve in the stack is not judged here (the
 * object-reference rules own that answer), the same boundary
 * `validate-public-form-file-fields.ts` draws.
 *
 * ## Where it runs
 *
 * A stack-level authoring rule (`authoring-rules.ts`): `os validate`,
 * `os build` and `os lint` run it over the whole stack, and the runtime publish
 * gate runs it on a `view` or `page` write, whose snapshot carries the
 * `objects` collection as resolution context. An `object` write's snapshot
 * carries no views or pages, so retyping a named field under a published panel
 * is caught by the CLI commands and by the form's next publish.
 */

import { RUNTIME_OWNED_FIELD_TYPES } from '@objectstack/spec/data';
import { anonymousFormObjectName, thankYouRecordFieldNames } from '@objectstack/spec/ui';

import { collectionEntries } from './collection-entries.js';
import { indexObjectGraph, type GraphObject } from './object-graph.js';
import { walkPageComponents } from './page-walk.js';

export const THANK_YOU_RECORD_FIELD = 'thank-you-record-field';

export interface ThankYouRecordFieldFinding {
  severity: 'error';
  /** Diagnostic rule id: always {@link THANK_YOU_RECORD_FIELD}. */
  rule: string;
  /** Human-readable location, e.g. `view "case_intake" · form`. */
  where: string;
  /** Config path of the panel, e.g. `views[0].form.submitBehavior`. */
  path: string;
  message: string;
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** The page component type whose `properties.submitBehavior` is a form view's block. */
const OBJECT_FORM_COMPONENT_TYPE = 'object-form';

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** One form that carries a panel, located. */
interface PanelSite {
  submitBehavior: unknown;
  objectName: string | undefined;
  where: string;
  path: string;
  /** Who reads the refusal: `view "x" · form`, `page "y" · component …`. */
  owner: string;
}

/** Every form a `views[]` entry carries, in scan order, with its slot. */
function viewForms(view: AnyRec): Array<{ form: AnyRec; slot: string }> {
  const forms: Array<{ form: AnyRec; slot: string }> = [];
  if ('submitBehavior' in view) forms.push({ form: view, slot: '' });
  if (isRec(view.form)) forms.push({ form: view.form, slot: 'form' });
  if (isRec(view.formViews)) {
    for (const [key, fv] of Object.entries(view.formViews)) {
      if (isRec(fv)) forms.push({ form: fv, slot: `formViews.${key}` });
    }
  }
  if (view.viewKind === 'form' && isRec(view.config)) forms.push({ form: view.config, slot: 'config' });
  return forms;
}

function panelSites(stack: AnyRec): PanelSite[] {
  const sites: PanelSite[] = [];
  for (const { rec: view, path: viewPath } of collectionEntries(stack.views, 'views')) {
    const viewName = strName(view.name) ?? strName(view.object) ?? viewPath;
    for (const { form, slot } of viewForms(view)) {
      if (form.submitBehavior === undefined) continue;
      const owner = `view "${viewName}"${slot ? ` · ${slot}` : ''}`;
      sites.push({
        submitBehavior: form.submitBehavior,
        objectName: anonymousFormObjectName(view, form),
        where: owner,
        path: `${viewPath}${slot ? `.${slot}` : ''}.submitBehavior`,
        owner,
      });
    }
  }
  for (const { rec: page, path: pagePath } of collectionEntries(stack.pages, 'pages')) {
    const pageName = strName(page.name) ?? pagePath;
    for (const walked of walkPageComponents(page, pagePath)) {
      const { component } = walked;
      if (component.type !== OBJECT_FORM_COMPONENT_TYPE || !isRec(component.properties)) continue;
      if (component.properties.submitBehavior === undefined) continue;
      const id = strName(component.id);
      const owner = `page "${pageName}" · object-form${id ? ` "${id}"` : ` at ${walked.path}`}`;
      sites.push({
        submitBehavior: component.properties.submitBehavior,
        objectName: strName(component.properties.objectName) ?? walked.objectName,
        where: owner,
        path: `${walked.path}.properties.submitBehavior`,
        owner,
      });
    }
  }
  return sites;
}

/** Why `name` is not admitted on `object`, or `undefined` when it is runtime-owned. */
function refusalReason(object: GraphObject, name: string, admitted: ReadonlySet<string>): string | undefined {
  const declared = object.fields.get(name);
  if (declared) {
    const type = declared.type;
    if (type !== undefined && admitted.has(type)) return undefined;
    return `a ${type ?? 'untyped'} field`;
  }
  if (object.injected.has(name)) {
    const type = object.injected.get(name)?.type;
    return `a system column${type ? ` (${type})` : ''} the platform adds to every record`;
  }
  return 'not a field the object declares';
}

/**
 * Refuse every name a `thank-you` panel interpolates that is not an
 * engine-generated field. Empty = clean.
 *
 * `admitted` is the spec's set and nothing else in production; the parameter
 * exists so a test can widen it as a double and prove this rule follows the
 * one source with no edit of its own (the spec dist is externalised in this
 * package's tests, so it cannot be module-mocked).
 */
export function validateThankYouRecordFields(
  stack: AnyRec,
  admitted: ReadonlySet<string> = RUNTIME_OWNED_FIELD_TYPES,
): ThankYouRecordFieldFinding[] {
  const findings: ThankYouRecordFieldFinding[] = [];
  const sites = panelSites(stack);
  if (sites.length === 0) return findings;
  const graph = indexObjectGraph(stack);

  for (const site of sites) {
    const names = thankYouRecordFieldNames(site.submitBehavior);
    if (names.length === 0 || !site.objectName) continue;
    const object = graph.get(site.objectName);
    if (!object) continue;
    for (const name of names) {
      const reason = refusalReason(object, name, admitted);
      if (reason === undefined) continue;
      findings.push({
        severity: 'error',
        rule: THANK_YOU_RECORD_FIELD,
        where: site.where,
        path: site.path,
        message:
          `${site.owner}: the thank-you panel names {{record.${name}}}, which on object ` +
          `"${site.objectName}" is ${reason}. A thank-you panel may name only a field the engine ` +
          `generates on insert: any other value may have been set by a beforeInsert / afterInsert ` +
          `hook from records an anonymous visitor's form grant cannot read, so a public form's ` +
          `submit answer never carries it.`,
        hint:
          `Name a ${[...admitted].join(' or ')} field of "${site.objectName}" instead ` +
          `(for example a case number), or ` +
          `take {{record.${name}}} out of the panel's title and message.`,
      });
    }
  }

  return findings;
}
