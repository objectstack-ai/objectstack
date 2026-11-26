// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0159] The authoring rules of the `form` metadata type (card ② items 1,
 * 7 and 9). Every rule reads a stack's forms through ONE walk,
 * {@link stackForms}: the authored `forms:` items and the projection of the
 * three old `view` shapes (`projectViewForms`), so no rule re-reads
 * `formViews` by hand.
 *
 *  - `form-public-address-taken` (gating, ruled question 3 = A): an authored
 *    `form` left open on a `/forms/SLUG` another form of the stack holds,
 *    authored or projected. A form holds an address while its
 *    `sharing.publicLink` names it, switched on or off. A refusal on the new
 *    type only: two old-shape forms on one slug keep today's first-match
 *    behaviour, and a closed authored form is never refused.
 *  - `form-consumer-less` (advisory, D1; the successor of
 *    `form-view-internal-not-loaded` for `form` items): an authored `form`
 *    with no public link that no `type: 'form'` action targets steers
 *    nothing. ⛔ Not raised for an item that declares `overrides`: an
 *    override with no link over a base form that has a consumer is what keeps
 *    that address closed, and a warning that it steers nothing would invite
 *    its removal (the base is not in the stack, so its consumers cannot be
 *    read here; the rule stays silent rather than guess). ⛔ No advisory for
 *    an old shape: `form-view-internal-not-loaded` stays the only one (D5).
 *  - `form-object-outside-closure` / `form-object-unknown` (gating, D2): a
 *    `form`'s `object` judged where a list view's object is judged
 *    (`validateListViewFieldRefs`): under a stated package closure, or
 *    against the whole collection a runtime write is judged against. The CLI
 *    judges no binding it cannot see (a dependency package's object).
 */

import {
  anonymousFormIntakeSlug,
  isAggregatedViewContainer,
  projectViewForms,
  publicFormSlug,
} from '@objectstack/spec/ui';
import { collectionEntries } from './collection-entries.js';
import { recordsOf } from './object-graph.js';
import { walkPageComponents } from './page-walk.js';

export const FORM_PUBLIC_ADDRESS_TAKEN = 'form-public-address-taken';
export const FORM_CONSUMER_LESS = 'form-consumer-less';
export const FORM_OBJECT_OUTSIDE_CLOSURE = 'form-object-outside-closure';
export const FORM_OBJECT_UNKNOWN = 'form-object-unknown';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);
const strName = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

export interface FormItemFinding {
  severity: 'error' | 'warning';
  rule: typeof FORM_PUBLIC_ADDRESS_TAKEN | typeof FORM_CONSUMER_LESS | typeof FORM_OBJECT_OUTSIDE_CLOSURE | typeof FORM_OBJECT_UNKNOWN;
  where: string;
  path: string;
  message: string;
  hint: string;
}

/** One form of a stack: an authored `form` item, or one the projection reads out of a `view`. */
export interface StackForm {
  name: string;
  object: string | undefined;
  form: AnyRec;
  /** `form`: authored in `forms:`; `view`: projected from an old shape. */
  definedIn: 'form' | 'view';
  path: string;
}

/**
 * [ADR-0159 D5] Every form of a stack: the authored `forms:` entries, then
 * the forms the projection reads out of `views:` (containers expanded under
 * the object the registrars bind them to, items under their own name).
 */
export function stackForms(stack: AnyRec): StackForm[] {
  const out: StackForm[] = [];
  for (const { rec, path } of collectionEntries(stack.forms, 'forms')) {
    const name = strName(rec.name);
    if (!name) continue;
    out.push({ name, object: strName(rec.object), form: rec, definedIn: 'form', path });
  }
  for (const { rec, path } of collectionEntries(stack.views, 'views')) {
    for (const form of projectViewForms(rec).forms) {
      out.push({
        name: form.name,
        object: strName(form.object),
        form: form as AnyRec,
        definedIn: 'view',
        path: isAggregatedViewContainer(rec) ? `${path} (${form.name})` : `${path}.config`,
      });
    }
  }
  return out;
}

/** The slug a form's `sharing.publicLink` names, switched on or off. */
function heldSlug(form: AnyRec): string | undefined {
  const sharing = form.sharing;
  const link = isRec(sharing) ? strName(sharing.publicLink) : undefined;
  return link ? publicFormSlug(link) : undefined;
}

/** Every form name a `type: 'form'` action of the stack targets literally. */
function formTargets(stack: AnyRec): Set<string> {
  const out = new Set<string>();
  const add = (action: unknown) => {
    if (!isRec(action) || action.type !== 'form') return;
    const target = strName(action.target);
    if (target && !target.includes('{')) out.add(target);
  };
  for (const action of recordsOf(stack.actions)) add(action);
  for (const obj of recordsOf(stack.objects)) for (const action of recordsOf(obj.actions)) add(action);
  const pages = recordsOf(stack.pages);
  for (let i = 0; i < pages.length; i++) {
    for (const { component } of walkPageComponents(pages[i], `pages[${i}]`)) {
      if (isRec(component.properties)) add(component.properties.action);
    }
  }
  return out;
}

/** [ruled question 3 = A] An authored `form` left open on an address another form holds. */
export function validateFormPublicAddresses(stack: AnyRec): FormItemFinding[] {
  const findings: FormItemFinding[] = [];
  const forms = stackForms(stack);
  for (const form of forms) {
    if (form.definedIn !== 'form') continue;
    const slug = anonymousFormIntakeSlug(form.form.sharing);
    if (slug === null) continue;
    const holder = forms.find((other) => other !== form && other.name !== form.name && heldSlug(other.form) === slug);
    if (!holder) continue;
    findings.push({
      severity: 'error',
      rule: FORM_PUBLIC_ADDRESS_TAKEN,
      where: `form "${form.name}"`,
      path: `${form.path}.sharing.publicLink`,
      message:
        `the form "${form.name}" opens /forms/${slug}, which the form "${holder.name}" (${holder.path}) already holds. ` +
        'Two forms on one public address answer one of them, and nothing says which.',
      hint:
        `Give "${form.name}" another public link, or clear the link of "${holder.name}". A form holds an address ` +
        'while its public link names it, switched on or off.',
    });
  }
  return findings;
}

/** [ADR-0159 D1] An authored `form` that no link and no action reaches. */
export function validateFormConsumers(stack: AnyRec): FormItemFinding[] {
  const findings: FormItemFinding[] = [];
  const targets = formTargets(stack);
  for (const form of stackForms(stack)) {
    if (form.definedIn !== 'form') continue;
    if (isRec(form.form.overrides)) continue;
    if (heldSlug(form.form) !== undefined) continue;
    if (targets.has(form.name)) continue;
    findings.push({
      severity: 'warning',
      rule: FORM_CONSUMER_LESS,
      where: `form "${form.name}"`,
      path: form.path,
      message:
        `the form "${form.name}" has no public link and no \`type: 'form'\` action opens it, so nothing reaches it: ` +
        'it installs and steers nothing.',
      hint:
        `Give "${form.name}" a public link (\`sharing.publicLink\`), open it from an action of type \`form\` whose ` +
        'target is its name, or remove it.',
    });
  }
  return findings;
}

/** Options mirroring `validateListViewFieldRefs`': where a binding is judged. */
export interface FormObjectBindingOptions {
  packageScope?: { readonly packageId: string; readonly dependencies: readonly string[] };
  wholeCollection?: boolean;
}

/** [ADR-0159 D2] An authored `form`'s `object`, judged where a list view's object is. */
export function validateFormObjectBindings(stack: AnyRec, options?: FormObjectBindingOptions): FormItemFinding[] {
  const findings: FormItemFinding[] = [];
  const scope = options?.packageScope;
  if (!scope && options?.wholeCollection !== true) return findings;
  const objects = new Set(recordsOf(stack.objects).map((o) => strName(o.name)).filter((n): n is string => !!n));
  // An empty whole collection means the host supplied no universe, as the
  // list-view rule reads it.
  if (!scope && objects.size === 0) return findings;
  for (const form of stackForms(stack)) {
    if (form.definedIn !== 'form' || form.object === undefined || objects.has(form.object)) continue;
    findings.push(scope
      ? {
        severity: 'error',
        rule: FORM_OBJECT_OUTSIDE_CLOSURE,
        where: `form "${form.name}"`,
        path: `${form.path}.object`,
        message:
          `binds object "${form.object}", which is outside package "${scope.packageId}"'s closure (its own objects, ` +
          'the objects of the packages its manifest declares in `dependencies`, and platform objects).',
        hint: `Bind the form to an object inside that closure, or declare a dependency on the package that ships "${form.object}".`,
      }
      : {
        severity: 'error',
        rule: FORM_OBJECT_UNKNOWN,
        where: `form "${form.name}"`,
        path: `${form.path}.object`,
        message: `binds object "${form.object}", which exists nowhere in this deployment.`,
        hint: `Bind the form to an object that exists, or save the object "${form.object}" before you publish the form.`,
      });
  }
  return findings;
}
