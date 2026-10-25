/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Shared FLAT field builder for the overlay form containers (Modal / Drawer).
 *
 * `ModalForm` and `DrawerForm` each accept `objectName` (plus an optional
 * `fields` whitelist and inline `customFields`) with NO `sections`. In that shape
 * there is no section to normalize, so both used to build the runtime
 * `FormField` list inline — two hand-copied loops over the same "object-schema
 * field to runtime FormField" mapping that `sectionFields`' `fromObjectSchema`
 * already owns for the sectioned path.
 *
 * They drifted, exactly as duplicated mappings do (objectui#4755): the modal's
 * copy carried the ADR-0036 field-level rules (`visibleWhen` / `readonlyWhen` /
 * `requiredWhen`) and the field-group membership (`group`), the drawer's copy
 * stopped at `multiple`. A drawer form opened over an object declaring
 * conditional rules therefore ignored every one of them — a `visibleWhen`-FALSE
 * field rendered anyway, a `readonlyWhen`-TRUE field stayed editable (and the
 * server then dropped the write), and `requiredWhen` never fired. Nothing was
 * broken in the renderer: `resolveFieldRuleState` simply never received the
 * predicates, because the builder did not copy them onto the FormField.
 *
 * So there is now ONE mapping in this package, shared by all three producers —
 * this module for the flat path, `buildSectionFields` for the sectioned path,
 * both resolving each field through `fromObjectSchema`. The next widget-arity
 * fix (#3986), create-mode `required` rule (#4069) or ADR-0036 key lands once
 * and reaches every container.
 */

import type { FormField } from '@object-ui/types';
import { fromObjectSchema, warnUnresolvedTopLevelField, type SectionFieldsContext } from './sectionFields';
import { mergeCustomFields } from './customFieldsMerge';

export interface FlatFieldsContext extends SectionFieldsContext {
  /**
   * The caller's explicit field whitelist, in render order. Entries are field
   * names or objects carrying one (`{ name }`). Omitted → every field the
   * object schema declares, in schema order.
   */
  fields?: Array<string | Record<string, any>>;
  /**
   * The authored inline members (`schema.customFields`), MERGED over the
   * generated set exactly as `ObjectForm` merges them — override by name in
   * place, keep the rest, append the unmatched in authored order
   * (objectui#10073; the rule lives in `customFieldsMerge.ts`).
   */
  customFields?: FormField[];
}

/**
 * Build the runtime `FormField` list for a container rendering an object's
 * fields flat (no sections).
 *
 * Fields the object schema does not declare are SKIPPED — the flat containers
 * have always dropped them rather than rendering `fromObjectSchema`'s bare
 * `input` stub, and a whitelist naming a field the object does not have is an
 * authoring error the form should not paper over with an untyped control. A
 * `customFields` member naming such a field is drawn in its place: the member
 * is a whole definition, not an untyped stub.
 */
export function buildFlatFields(ctx: FlatFieldsContext): FormField[] {
  const fieldsToShow = ctx.fields || Object.keys(ctx.objectSchema?.fields || {});
  const names: string[] = [];

  for (const entry of fieldsToShow) {
    const name = typeof entry === 'string' ? entry : (entry as any)?.name;
    if (!name) {
      // objectui#8738 route 1: same read-site shape as `SimpleObjectForm`'s
      // `fieldsToShow` loop in `ObjectForm.tsx` — warn, don't accept.
      warnUnresolvedTopLevelField(entry, ctx.objectName);
      continue;
    }
    names.push(name);
  }

  return mergeCustomFields(names, ctx.customFields, (name) => {
    const field = ctx.objectSchema?.fields?.[name];
    if (!field) return undefined;

    return {
      ...fromObjectSchema(name, ctx),
      // Field-group membership (Field.group → object.fieldGroups[].key), read
      // by `deriveFieldGroupSections` for the fieldGroups fallback. Carried
      // HERE and not in `fromObjectSchema` because that fallback only ever runs
      // over a flat field list — both call sites (ObjectForm, ModalForm) skip
      // it the moment explicit sections exist, so stamping `group` onto
      // section-built fields would add a key with no reader.
      group: (field as any).group,
    };
  });
}
