/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE spelling of the `customFields` merge rule (objectui#10073).
 *
 * The registered description of `object-form.customFields` is a single
 * sentence for every `formType`: "Field definitions merged over the set
 * generated from object metadata. With inline definitions and no data source,
 * this becomes the only field source." objectui#9778 made `ObjectForm`'s
 * default arm honour it; its `drawer` and `modal` arms reach `DrawerForm` /
 * `ModalForm`, which kept REPLACING the generated set with the members — so the
 * same authored key meant two different things depending on the arm. Every
 * producer of a flat field list now resolves the members through this
 * function, so the rule cannot drift between arms again.
 *
 * The three directions, over the caller's ordered field names:
 *   override — a member naming a field in the list supplies that field's WHOLE
 *              definition (it inherits nothing from the generated one), in the
 *              list's position;
 *   keep     — a field no member names is generated as usual;
 *   append   — a member naming a field the list does not reach is added after
 *              it, in authored order.
 * With no object metadata the list the caller passes is empty (or names only
 * what the `fields` whitelist names), so the members are the whole field
 * source — the registration's second sentence.
 *
 * An EMPTY `customFields` is unauthored: nothing is overridden or appended.
 *
 * Explicit and derived SECTIONS answer the same question — whose definition is
 * the field a section names? — through `findCustomFieldMember` below, which
 * `mergeCustomFields` itself resolves every name through (objectui#10254). A
 * section body has no append direction: it draws only what its entries name.
 *
 * Module-private: not re-exported from the package barrel.
 */

import type { FormField } from '@object-ui/types';

/**
 * The member that supplies the definition of the field called `name`, or
 * `undefined` when no member names it — the override direction's precedence,
 * spelled once. The first member naming the field wins, and an EMPTY
 * `customFields` supplies nothing.
 *
 * Shared by the two producers of a runtime field from a name: the flat list
 * (`mergeCustomFields` below, the default arm's pool and the drawer / modal
 * no-sections path) and a section body (`normalizeSectionField` in
 * `sectionFields.ts`, where the member is a section entry's BASE definition).
 * objectui#10254: the drawer and modal section bodies used to regenerate every
 * named field from the object schema, so a member the default arm drew was
 * dropped on those two arms.
 */
export function findCustomFieldMember(
  customFields: readonly FormField[] | null | undefined,
  name: string,
): FormField | undefined {
  if (!customFields?.length) return undefined;
  return customFields.find((m) => m?.name === name);
}

/**
 * Resolve the runtime field list for `names`, with `customFields` merged over
 * the fields `generate` produces.
 *
 * @param names        The field names the form draws, in render order.
 * @param customFields The authored members (`schema.customFields`).
 * @param generate     Builds the generated field for `names[index]`, or
 *                     returns `undefined` when the object declares no such
 *                     field (the name is then skipped unless a member names it).
 * @param normalize    Applied to every member before it is drawn.
 */
export function mergeCustomFields(
  names: readonly string[],
  customFields: readonly FormField[] | null | undefined,
  generate: (name: string, index: number) => FormField | undefined,
  normalize: (member: FormField) => FormField = (member) => member,
): FormField[] {
  const members = customFields?.length ? customFields : undefined;
  const drawn: FormField[] = [];

  names.forEach((name, index) => {
    const member = findCustomFieldMember(members, name);
    if (member) {
      drawn.push(normalize(member));
      return;
    }
    const generated = generate(name, index);
    if (generated) drawn.push(generated);
  });

  if (members) {
    const alreadyDrawn = new Set(drawn.map((f) => f.name));
    members.forEach((member) => {
      const name = member?.name;
      if (!name || alreadyDrawn.has(name)) return;
      alreadyDrawn.add(name);
      drawn.push(normalize(member));
    });
  }

  return drawn;
}
