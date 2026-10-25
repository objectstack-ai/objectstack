/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `form.sections[].group` — the ADR-0085 §5 REFERENCE form on the view-level
 * form surface (`@objectstack/spec` 17.3.0, objectstack#13855; objectui#7051).
 *
 * A form section declares its members exactly one way: it enumerates `fields`,
 * or it points `group` at one of the object's declared `fieldGroups` and
 * inherits that group's members AND its presentation. This module resolves the
 * second form into the first, so every downstream reader — the simple grouped
 * body and all five container variants — keeps seeing the one section shape it
 * already knows.
 *
 * ⛔ No assembly rule is re-implemented here. Declared order, the empty-group
 * drop, the ungrouped trailing bucket and the collapse / `visibleWhen`
 * passthrough all come from `deriveFieldGroupLayout` (ADR-0085 §5), reached
 * through this package's ONE adapter onto the form-section shape,
 * `deriveFieldGroupSections`. That is the same adapter the no-sections
 * field-group fallback uses, deliberately: authoring a group by reference and
 * letting the fallback derive it must produce the same section, and they do
 * because one of them IS the other's code path.
 *
 * What this module owns is only the three things the reference form adds on
 * top of that derivation:
 *
 *   1. matching an authored key to a derived section (and reporting a miss);
 *   2. keeping the two page-layout keys the spec permits beside `group`;
 *   3. refusing the shapes the spec refuses, out loud rather than silently.
 */

import type { ObjectFormSection } from '@object-ui/types';
import { deriveFieldGroupSections } from './fieldGroups';

/**
 * The keys `@objectstack/spec` REFUSES beside `group`, measured against
 * `FormSectionSchema` in `@objectstack/spec` 17.3.0 and pinned in
 * `__tests__/formSectionGroupReference-7051.test.tsx`.
 *
 * There are no override semantics: each of these is something the object's
 * `fieldGroups` entry declares, so restating one on the referencing section
 * would be a second writable spelling of one fact. Authored metadata carrying
 * one never reaches this renderer (the spec door rejects it); a programmatic
 * SDUI caller, which does not pass that door, is reported instead of quietly
 * having its key honoured or quietly having it dropped.
 */
export const GROUP_OWNED_SECTION_KEYS = [
  'name',
  'label',
  'description',
  'collapsible',
  'collapsed',
  'visibleWhen',
] as const;

/**
 * The keys the spec PERMITS beside `group`. They describe how THIS form lays
 * the section out, which is the form's business and not the group's, so the
 * authored value wins over the derived section.
 */
export const SECTION_LAYOUT_KEYS = ['columns', 'pane'] as const;

/** Diagnostics already emitted, keyed so one typo is loud once, not per render. */
const reported = new Set<string>();

function reportOnce(key: string, emit: () => void): void {
  if (reported.has(key)) return;
  reported.add(key);
  emit();
}

/** Test seam — forget which section-group diagnostics have been reported. */
export function resetSectionGroupReports(): void {
  reported.clear();
}

/** Does any section in this list use the reference form? */
export function hasSectionGroupReference(sections: unknown): boolean {
  return (
    Array.isArray(sections) &&
    sections.some((s) => s != null && typeof s === 'object' && typeof (s as any).group === 'string')
  );
}

/** The object's declared field groups, as the shape `deriveFieldGroupSections` reads. */
function declaredGroupSections(objectDef: any): ObjectFormSection[] | null {
  const fields = objectDef?.fields;
  if (!fields || typeof fields !== 'object') return null;
  return deriveFieldGroupSections(
    Object.entries(fields as Record<string, any>).map(
      ([name, def]) => ({ name, group: def?.group }) as any,
    ),
    objectDef?.fieldGroups,
  );
}

export interface ResolveSectionGroupsOptions {
  /** Object name — diagnostics say WHICH object is missing the group. */
  objectName: string;
  /** The form's layout. `wizard` is the one the spec bans `group` on. */
  formType?: string;
  /**
   * The object definition (`{ fields, fieldGroups }`), or `null`/`undefined`
   * while it is still loading. A `group` section is rendered EMPTY until it
   * arrives — never dropped, see the note on the return value.
   */
  objectDef: any;
  /**
   * `false` when this form can never load an object definition (no
   * DataSource), so an unresolvable reference is reported as such instead of
   * being left to look like a load that never finished.
   */
  resolvable?: boolean;
}

/**
 * Replace every `{ group }` section with the section that group declares.
 *
 * Returns the SAME array reference when nothing uses the reference form, so a
 * caller can keep this in a `useMemo` without perturbing any existing form.
 *
 * ⚠️ A reference that cannot be resolved yields `{ fields: [] }` — an empty
 * section — and NOT a dropped one. Both render nothing, which is what the spec
 * assigns to an unresolvable reference (`deriveFieldGroupLayout` already drops
 * a declared group nothing references, and `@objectstack/lint`'s
 * `form-section-group-unknown` is the declared reporter of a dangling key).
 * The choice between them is forced by THIS surface and was measured: a form
 * whose `sections` array empties out stops being a sectioned form at all and
 * falls back to the flat every-field layout, so dropping would make a single
 * mistyped key render MORE than the author asked for. Emptying renders
 * exactly nothing, and leaves the array length — which is the wizard's step
 * count and the container routing's condition — untouched.
 */
export function resolveSectionGroupReferences(
  sections: ObjectFormSection[] | undefined,
  opts: ResolveSectionGroupsOptions,
): ObjectFormSection[] | undefined {
  if (!hasSectionGroupReference(sections)) return sections;
  const authored = sections as ObjectFormSection[];
  const { objectName, formType, objectDef, resolvable = true } = opts;

  // The spec REFUSES `group` on a wizard step: a field group carries
  // `visibleWhen` and `collapse`, and `deriveFieldGroupLayout` passes both
  // through to the section it derives, while a wizard step has a slot for
  // neither (steps are entered in array order behind the step gate). Honouring
  // the reference here would mean inventing the semantics the spec declined to
  // give it, and the wizard's own key-by-key step map would then silently drop
  // the two keys — the same silent drop objectui#6237 reported rather than
  // accepted. So the step renders empty and says why, exactly as an inert step
  // predicate already does.
  if (formType === 'wizard') {
    for (const s of authored) {
      const g = (s as any)?.group;
      if (typeof g !== 'string') continue;
      reportOnce(`wizard:${objectName}.${g}`, () =>
        console.warn(
          `[object-ui] form section { group: '${g}' } is not supported on a wizard step and renders nothing. ` +
            "`@objectstack/spec` refuses `group` on a `formType: 'wizard'` section at parse: a field group " +
            'carries `visibleWhen` and `collapse`, and a wizard step has no slot for either. Enumerate ' +
            '`fields` on the step instead.',
        ),
      );
    }
    return authored.map((s) =>
      typeof (s as any)?.group === 'string' ? withoutGroup(s, []) : s,
    );
  }

  const derived = objectDef ? declaredGroupSections(objectDef) : null;
  const byKey = new Map<string, ObjectFormSection>();
  for (const d of derived ?? []) {
    // The trailing ungrouped bucket carries no `name`, so no reference can
    // resolve to it — which is correct: it is not a declared group.
    if (typeof d.name === 'string') byKey.set(d.name, d);
  }

  return authored.map((section) => {
    const group = (section as any)?.group;
    if (typeof group !== 'string') return section;

    const layout = pickLayout(section);
    reportGroupOwnedKeys(section, group, objectName);

    const match = byKey.get(group);
    if (!match) {
      // Only a LOADED object definition proves the key resolves to nothing. An
      // absent one is a load still in flight (or a form with no DataSource at
      // all), and reporting it would fire a dangling-reference diagnostic at
      // every author whose form simply had not finished loading.
      if (objectDef || !resolvable) {
        reportOnce(`unknown:${objectName}.${group}`, () =>
          console.error(
            `[object-ui] form section group "${group}" is not declared in fieldGroups on object ` +
              `"${objectName}" — the section renders nothing. Declare the group on the object, or ` +
              'enumerate `fields` on the section. (`@objectstack/lint` reports this as ' +
              '`form-section-group-unknown`.)',
          ),
        );
      }
      return withoutGroup(section, []);
    }

    // The spread order IS the spec's precedence. The authored half can only
    // ever carry layout (everything else beside `group` is refused at parse
    // and reported above when a programmatic caller sends it anyway), so
    // letting it win gives the group its presentation and the form its layout,
    // with no key able to have two sources.
    return { ...match, ...layout };
  });
}

/** Strip `group` from an authored section, keeping only what the spec permits beside it. */
function withoutGroup(section: ObjectFormSection, fields: ObjectFormSection['fields']): ObjectFormSection {
  return { ...pickLayout(section), fields };
}

/** The authored keys the spec permits beside `group`. */
function pickLayout(section: ObjectFormSection): Partial<ObjectFormSection> {
  const out: Record<string, unknown> = {};
  for (const k of SECTION_LAYOUT_KEYS) {
    const v = (section as any)[k];
    if (v !== undefined) out[k] = v;
  }
  return out as Partial<ObjectFormSection>;
}

/** Report — once — an off-spec key restated beside `group`. */
function reportGroupOwnedKeys(section: ObjectFormSection, group: string, objectName: string): void {
  const restated = GROUP_OWNED_SECTION_KEYS.filter((k) => (section as any)[k] !== undefined);
  if (restated.length === 0) return;
  reportOnce(`owned:${objectName}.${group}:${restated.join(',')}`, () =>
    console.warn(
      `[object-ui] form section { group: '${group}' } also declares ${restated
        .map((k) => `\`${k}\``)
        .join(', ')} — the group owns ${restated.length > 1 ? 'those keys' : 'that key'} and the ` +
        'authored value is ignored. `@objectstack/spec` refuses this combination at parse (there are no ' +
        `override semantics); set it on the object's \`fieldGroups\` entry for "${group}" instead.`,
    ),
  );
}
