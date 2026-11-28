// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { anonymousFormIntakeSlug, formExplicitlyWithdraws, type FormWithdrawal } from './anonymous-form-intake';
import { projectViewForms } from './view.zod';
import { oldShapeFormWithdrawals } from './old-shape-form-withdrawals';

/**
 * [ADR-0159 D6] The anonymous doors' withdrawal judgement over BOTH types.
 *
 * The doors offer the open forms of the effective `form` read (authored
 * items and the projection of the old shapes, resolved over both types).
 * Each candidate is judged against a layer never narrower than the one the
 * doors judged before card ②: the effective lists and the per-package layers
 * of both `form` and `view`, the old shapes passed through the projection
 * first. Narrowing only, in both directions: a withdrawal held in either type
 * closes the form served from either type.
 *
 *  - **Identity is the served name** (rule 6): inside one name, the whole
 *    item. A body of the form's name that explicitly withdraws a form (its
 *    `sharing` keeps a `publicLink` and sets `enabled` or `allowAnonymous` to
 *    `false`) closes the form, whatever slug either side declares. A
 *    definition under another name is a different form: the slug match
 *    decides no case in this layer.
 *  - **An unreadable body closes the links it names** (rule 7): a body the
 *    projection cannot turn into items closes every `sharing.publicLink` slug
 *    it names, and the caller says so once at `error`.
 *  - A withdrawal in one package closes the name's form in every package (a
 *    known limit that fails closed, as before).
 */

/** A body the projection cannot read, and the links it closes (rule 7). */
export interface UnreadableFormBody {
  /** The stored row: its type, name and package (`undefined`: package-less). */
  type: 'view' | 'form';
  name: string;
  packageId?: string;
  reason: string;
  /** The slugs it names, each closed. */
  links: string[];
}

/** The judged layer: the names withdrawn, and the slugs closed by unreadable bodies. */
export interface FormIntakeLayer {
  withdrawn: ReadonlyMap<string, FormWithdrawal>;
  closedLinks: ReadonlyMap<string, UnreadableFormBody>;
}

const nameOf = (item: unknown): string | undefined => {
  const name = (item as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name !== '' ? name : undefined;
};

/**
 * Build the two-type layer from what the doors read: `forms` (the effective
 * and per-package `form` lists, authored and projected items alike), `views`
 * (the effective and per-package `view` lists, raw), and `unreadable` (the
 * stored bodies the protocol could not project, rule 7).
 */
export function formIntakeLayer(input: {
  forms: ReadonlyArray<unknown>;
  views: ReadonlyArray<unknown>;
  unreadable?: ReadonlyArray<UnreadableFormBody>;
}): FormIntakeLayer {
  const withdrawn = new Map<string, FormWithdrawal>();
  const closedLinks = new Map<string, UnreadableFormBody>();
  for (const form of input.forms) {
    const name = nameOf(form);
    const slug = formExplicitlyWithdraws(form);
    if (name !== undefined && slug !== undefined && !withdrawn.has(name)) withdrawn.set(name, { name, slug });
  }
  for (const view of input.views) {
    for (const w of oldShapeFormWithdrawals(view)) if (!withdrawn.has(w.name)) withdrawn.set(w.name, w);
    const projection = projectViewForms(view);
    if (projection.unreadable !== undefined) {
      const pkg = (view as { _packageId?: unknown } | null)?._packageId;
      const body: UnreadableFormBody = {
        type: 'view',
        name: nameOf(view) ?? '',
        ...(typeof pkg === 'string' && pkg !== '' ? { packageId: pkg } : {}),
        reason: projection.unreadable.reason,
        links: projection.unreadable.links,
      };
      for (const link of body.links) if (!closedLinks.has(link)) closedLinks.set(link, body);
    }
  }
  for (const body of input.unreadable ?? []) {
    for (const link of body.links) if (!closedLinks.has(link)) closedLinks.set(link, body);
  }
  return { withdrawn, closedLinks };
}

/** The open form the doors serve at `slug`: the first candidate the layer does not close. */
export function openFormAt(
  forms: ReadonlyArray<unknown>,
  layer: FormIntakeLayer,
  slug: string,
): { form: Record<string, any>; object: string } | null {
  if (layer.closedLinks.has(slug)) return null;
  for (const item of forms) {
    if (!item || typeof item !== 'object') continue;
    const form = item as Record<string, any>;
    if (anonymousFormIntakeSlug(form.sharing) !== slug) continue;
    const name = nameOf(form);
    if (name === undefined || layer.withdrawn.has(name)) continue;
    const object = typeof form.object === 'string' && form.object ? form.object : undefined;
    if (object === undefined) continue;
    return { form, object };
  }
  return null;
}
