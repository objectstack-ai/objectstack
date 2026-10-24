/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Field-group helpers for ObjectForm.
 *
 * An object's metadata declares top-level `fieldGroups`, and individual
 * fields opt into a group via `field.group === group.key`. The grouping
 * SEMANTICS (declared order, empty groups dropped, trailing untitled bucket,
 * collapse behaviour incl. legacy alias handling) are single-sourced in
 * `@objectstack/spec` (`deriveFieldGroupLayout`, ADR-0085 §5) — this module
 * is only the adapter from that shared derivation onto the form renderer's
 * `ObjectFormSection` shape and its permission-filtered `FormField` list.
 */

import { deriveFieldGroupLayout } from '@objectstack/spec/data';
import type { FormField, ObjectFormSection } from '@object-ui/types';

/**
 * Derive form sections from an object's declared `fieldGroups` and each
 * rendered field's `group`.
 *
 * Returns `null` when grouping does not apply — no declared groups, or no
 * rendered field opts into a declared group — so callers fall back to a flat
 * form.
 *
 * The derivation runs against the RENDERED field list (post permission /
 * visibility filtering), not the raw object def, so a section never names a
 * field the form isn't showing. Any rendered field the shared derivation
 * excludes from its default buckets (audit/system fields) is re-appended to
 * the trailing bucket: the form was already told to render it, and a layout
 * helper silently dropping a rendered input is exactly the failure mode
 * ADR-0085 exists to kill.
 *
 * Section `fields` are field *names* (strings) so the result plugs straight
 * into ObjectForm's existing section-render path.
 */
export function deriveFieldGroupSections(
  fields: FormField[],
  fieldGroups: unknown,
): ObjectFormSection[] | null {
  const derived = deriveFieldGroupLayout({
    fieldGroups,
    // Pseudo-def over the rendered fields: membership is the only input the
    // derivation needs per field.
    fields: Object.fromEntries(
      fields.map((f) => [f.name, { group: (f as { group?: unknown }).group }]),
    ),
  });
  if (!derived) return null;

  const placed = new Set(derived.flatMap((s) => s.fields));
  const leftover = fields.map((f) => f.name).filter((n) => !placed.has(n));

  const sections: ObjectFormSection[] = derived.map((s) => ({
    ...(s.key !== undefined ? { name: s.key } : {}),
    ...(s.key !== undefined ? { label: s.label ?? s.key } : {}),
    // The other two presentation keys the shared derivation emits and
    // `ObjectFormSection` declares (objectui#7051). This map is a key-by-key
    // rebuild, so a key it does not copy is dropped before any renderer can
    // see it — the failure mode that lost `visibleOn` at the container maps and
    // that objectui#6111 / #6237 fixed there. Both are GROUP-owned presentation
    // per `@objectstack/spec` (its refusal message beside `group` names
    // "the label, icon, description, collapse state and `visibleWhen` a group
    // renders with"), so the reference form cannot inherit them from anywhere
    // else. `icon` is not copied because `ObjectFormSection` declares no such
    // key — nothing on this surface would read it.
    ...(s.description !== undefined ? { description: s.description } : {}),
    ...(s.visibleWhen !== undefined ? { visibleWhen: s.visibleWhen as ObjectFormSection['visibleWhen'] } : {}),
    // The fault direction travels WITH the predicate (objectui#13055): this is
    // a field group's `visibleWhen`, which `@objectstack/spec` declares
    // fail-closed ("else hidden (fail-closed)" on
    // `ObjectFieldGroupSchema.visibleWhen`), while a form-view section's own
    // `visibleWhen` is declared to fault open. Both reach the form renderer in
    // the same `section-divider` slot, so the slot cannot tell them apart;
    // this stamp can. Every arm that rebuilds a section key by key carries it
    // beside `visibleWhen` (`sectionFaultCarry-13055` pins that).
    ...(s.visibleWhen !== undefined ? { visibleWhenFault: 'hidden' as const } : {}),
    fields: [...s.fields],
    // Map the shared `collapse` enum onto the renderer's boolean pair.
    ...(s.collapse !== 'none' ? { collapsible: true } : {}),
    ...(s.collapse === 'collapsed' ? { collapsed: true } : {}),
  }));

  if (leftover.length > 0) {
    const trailing = sections[sections.length - 1];
    if (trailing && trailing.name === undefined) {
      trailing.fields = [...(trailing.fields ?? []), ...leftover];
    } else {
      sections.push({ fields: leftover });
    }
  }

  return sections;
}

/**
 * THE ONE ROW RULE (objectui#9849 step two — director ruling letter E,
 * item 2): 「The divider row exists iff `title || description`; with
 * `description` only it is the blurb-only row (objectui#9835's shape), on
 * every arm — one rule」.
 *
 * Every arm asks this one function, both to decide whether a row is drawn and
 * — because 「the collapse control lives on the row」 (item 3) — whether a
 * collapse control has anywhere to live. It replaced a four-way gate union
 * (one answer per arm) that the ruling deleted.
 *
 * ⚠️ The row is PRESENTATION only. Whether the group is gated by its ADR-0089
 * `visibleWhen` predicate and objectui#6236 membership claim does NOT depend
 * on it (item 1) — see `projectSectionDivider`.
 */
export function sectionDrawsDividerRow(title?: string, description?: string): boolean {
  return Boolean(title) || Boolean(description);
}

/**
 * The section configuration a divider row is projected FROM, already resolved
 * by the arm that owns each resolution.
 *
 * ⚠️ `collapse` arrives RESOLVED — by `resolveSectionCollapse` below, the one
 * `collapsed` / `collapsible` resolution every arm calls. It is resolved before
 * this projection rather than inside it because the arm needs the same answer
 * a second time: whether to take the section's fields out of the DOM.
 */
export interface SectionDividerSource {
  /** Section identity; spells the row's `name`. */
  key: string | number;
  /** The heading, already resolved through `sectionLabel` where the arm does that. */
  title?: string;
  /** The authored blurb (spec `FormSection.description`). */
  description?: string;
  /** ADR-0089 `FormSection.visibleWhen` (#6111), unevaluated. */
  visibleWhen?: unknown;
  /**
   * The fault direction of {@link visibleWhen}, copied onto the row unchanged
   * (`ObjectFormSection.visibleWhenFault`, objectui#13055).
   */
  visibleWhenFault?: ObjectFormSection['visibleWhenFault'];
  /** The objectui#6236 membership claim: RESOLVED (post-FLS) member names. */
  members: string[];
  /** Read by one arm only — see `projectSectionDivider`. */
  className?: string;
  /** Resolved by `resolveSectionCollapse`, ⛔ never here. */
  collapse?: { collapsible?: boolean; collapsed?: boolean; onToggle?: () => void };
}

/**
 * The loud diagnostic director ruling letter E, item 3 orders for a group that
 * declares `collapsible` (or `collapsed`) but yields neither a heading nor a
 * blurb: 「The collapse control lives on the row. A group that … yields neither
 * title nor description has nowhere to host the control ⇒ a loud diagnostic at
 * validation or render …, ⛔ never fields removed from the DOM with no control」.
 *
 * Emitted at RENDER, through the channel this package already uses for
 * renderer-side author mistakes — a once-per-occurrence `console.warn`, the
 * voice of `warnSectionMemberExcludedByFields` in `sectionFields.ts`. ⛔ It
 * only warns: the resolution below keeps such a group OPEN, so its fields stay
 * reachable whatever the warning's reader does.
 *
 * The first sentence is the ruling's own wording, verbatim; the pin that holds
 * it reads it from this function, so the two cannot drift.
 */
export function headinglessCollapseWarning(where: string): string {
  return (
    'collapsible section has no heading or description to carry its control: ' +
    `${where} declares \`collapsible\` / \`collapsed\` but yields neither a \`label\` nor a ` +
    '`description`, so no divider row is drawn for it and there is nowhere to put the ' +
    'disclosure control. The section is rendered OPEN and the declaration is ignored. Give it ' +
    'a `label` (or a `description`), or drop `collapsible` / `collapsed`.'
  );
}

const warnedHeadinglessCollapse = new Set<string>();
/**
 * Forget which sections were already reported — for pins only, so each row
 * observes its own first report. The dedupe is per module instance, and this
 * module is internal (the package barrel does not re-export it).
 */
export function resetHeadinglessCollapseWarnings(): void {
  warnedHeadinglessCollapse.clear();
}
function warnHeadinglessCollapse(where: string, dedupeKey: string): void {
  if (warnedHeadinglessCollapse.has(dedupeKey)) return;
  warnedHeadinglessCollapse.add(dedupeKey);
  console.warn(`[object-ui] ${headinglessCollapseWarning(where)}`);
}

/**
 * Resolve a section's authored `collapsed` / `collapsible` pair into what the
 * page draws: whether its row is a disclosure control, whether its fields are
 * out of the DOM right now, and what toggles them.
 *
 * ⭐ THE ONE RESOLUTION (objectui#9849 — director ruling letter E, item 4:
 * 「the three `collapsed` / `collapsible` resolutions converge to the
 * declaration-based one objectui#9780 established」). Every arm calls it: the
 * default arm, both `DrawerForm` pushes and — since step two, per item 1's
 * 「on every arm」 — both stacked `ModalForm` pushes.
 *
 * The rules, each objectui#9780's (maintainer ruling 2026-09-18, letter A):
 *
 *  - `collapsed` IMPLIES `collapsible`. "Collapsed by default" is an everyday
 *    intent and `collapsed: true` its most natural spelling, so that spelling
 *    installs the control.
 *  - `collapsible: false` WITH `collapsed: true` is the same contradiction and
 *    resolves the same way — collapsed wins, the control is present.
 *  - The control is read off the DECLARATION, ⛔ never off the live state:
 *    deriving it from the live state would delete the control the moment the
 *    user opened the section.
 *  - A section declaring neither member is untouched.
 *  - ⭐ A section is only ever collapsed when it is collapsible, and it is only
 *    collapsible when it has a divider row to carry the control — which, by
 *    the one row rule (`sectionDrawsDividerRow`), is exactly when it yields a
 *    heading or a blurb. So fields leave the DOM only while a control that
 *    brings them back is on the page.
 *  - ⭐ A section that declares the pair and yields NEITHER is rendered open
 *    and reported (`headinglessCollapseWarning`) — letter E item 3.
 */
export function resolveSectionCollapse(
  declared: { collapsible?: boolean; collapsed?: boolean },
  host: {
    /** The live state the user has toggled this section to, if any. */
    live: boolean | undefined;
    /** The row the section yields — the one row rule decides from these two. */
    title: string | undefined;
    description: string | undefined;
    /**
     * Who is asking and about which section, for the diagnostic only — e.g.
     * `ObjectForm section 2 of object 'invoice'`. Also its dedupe key.
     */
    where: string;
    /** Record the next live state for this section. */
    setCollapsed: (next: boolean) => void;
  },
): { collapsible: boolean; collapsed: boolean; onToggle?: () => void } {
  const declaresPair = Boolean(declared.collapsible) || Boolean(declared.collapsed);
  const hostsControl = sectionDrawsDividerRow(host.title, host.description);
  if (declaresPair && !hostsControl) warnHeadinglessCollapse(host.where, host.where);
  const collapsible = hostsControl && declaresPair;
  const collapsed = collapsible && (host.live ?? Boolean(declared.collapsed));
  return {
    collapsible,
    collapsed,
    onToggle: collapsible ? () => host.setCollapsed(!collapsed) : undefined,
  };
}

/**
 * A divider row spans its grid row itself, so this value never reaches a
 * grid-span wrapper: `renderFormField` returns the `SectionDivider` before it.
 * It is spelled once here because four of the five heading rows carried it and
 * the fifth did not, which is precisely the kind of per-arm drift this module
 * now makes impossible.
 */
const DIVIDER_COL_SPAN = 4;

/**
 * Project one section configuration onto the `section-divider` row it draws.
 *
 * ⭐ THIS IS THE ONE PATH (objectui#9849, triage ruling 2026-09-18:
 * 「让 section 配置到 divider 的投影只有一条路径」). Before it, six sites across
 * `ObjectForm.tsx`, `ModalForm.tsx` and `DrawerForm.tsx` each rebuilt the row
 * key by key, and a key one of them forgot was invisible to the author. A key
 * added here is added for every arm at once, and a key dropped here is dropped
 * for every arm at once, which is what makes the loss visible instead of
 * silent.
 *
 * ⭐ AND ONE RULE FOR WHICH ROW (director ruling letter E, maintainer 「同意」).
 * There is no per-arm gate any more — the enumerated four-way union this
 * function used to take as a parameter was deleted by that ruling:
 *
 *  1. 「Group-level semantics are independent of the heading」 — the ADR-0089
 *     `visibleWhen` predicate and the objectui#6236 membership claim ride
 *     EVERY row this function returns, so a headingless group is never
 *     un-gated, and the claim names only the group's own resolved members, so
 *     its predicate never hides more than the group it names.
 *  2. The VISIBLE row exists iff `title || description`
 *     (`sectionDrawsDividerRow`); with `description` only, it is the blurb-only
 *     row — no heading span, just the blurb (objectui#9835's shape).
 *  3. A group with neither, that authored a predicate, still needs a carrier
 *     for item 1: it gets a CHROME-LESS gate row — no `label`, no
 *     `description`, so `SectionDivider` renders nothing — which exists only
 *     to carry the predicate and the claim. It is the same shape `TabbedForm`
 *     already emits for a degraded single-section form, spelled
 *     `__section_gate_` like that one. A group with neither and no predicate
 *     returns no row at all: nothing to draw, nothing to gate.
 *
 * The key set, and who owns each member:
 *
 *  - `label` — the heading. The arm resolves i18n before handing it over.
 *  - `description` — the authored blurb (objectui#9779 / #9834 / #9849).
 *  - `visibleWhen` — ADR-0089's section predicate (#6111). The renderer
 *    evaluates it on this pseudo-field with the host predicate scope bound
 *    (#6010), so copying it here is what makes the authored predicate reach an
 *    evaluator at all.
 *  - `visibleWhenFault` — the fault direction of that predicate, emitted only
 *    when the section carries one (a field group's: `'hidden'`,
 *    objectui#13055). The renderer reads it for the divider's fault fallback.
 *  - `fields` — the objectui#6236 membership claim: RESOLVED member names, so
 *    the predicate gates the whole group and not just the heading. The form
 *    renderer also ends the group's field grid where the claim ends
 *    (`splitAtUntitledRuns`, `@object-ui/components`, objectui#11777), which is
 *    how an untitled section after it — the trailing ungrouped bucket, which
 *    gets no row here — is drawn as its own block instead of under this
 *    heading. A row that dropped the claim would put those fields back under it.
 *  - `colSpan` — see `DIVIDER_COL_SPAN`.
 *  - `collapsible` / `collapsed` / `onToggle` — on the visible row only (the
 *    control lives on the row), and only when the arm hands over a resolved
 *    `collapse`; see `SectionDividerSource`.
 *  - `className` — emitted only when the arm hands one over. objectstack#13626
 *    ("retire the reads", maintainer ruling 2026-09-01) took this read off
 *    every arm but `ModalForm`'s explicit-sections push, whose residue is
 *    preserved here rather than retired in passing: retiring it is a second
 *    ruling's job, and `sectionStyleKeysRetired-13626` pins the arms that
 *    already dropped it.
 *
 * ⛔ Not read, on any arm: `gridClassName` — a per-section grid needs a
 * per-section form, which the single-form structure these arms share does not
 * have.
 */
export function projectSectionDivider(source: SectionDividerSource): FormField[] {
  const { key, title, description, visibleWhen, visibleWhenFault, members, className, collapse } = source;

  if (!sectionDrawsDividerRow(title, description)) {
    if (visibleWhen == null) return [];
    return [
      {
        name: `__section_gate_${key}`,
        type: 'section-divider',
        visibleWhen,
        ...(visibleWhenFault !== undefined ? { visibleWhenFault } : {}),
        fields: members,
        colSpan: DIVIDER_COL_SPAN,
      } as unknown as FormField,
    ];
  }

  const row: Record<string, unknown> = {
    name: `__section_${key}`,
    label: title,
    type: 'section-divider',
    description,
    visibleWhen,
    fields: members,
    colSpan: DIVIDER_COL_SPAN,
  };
  if (visibleWhenFault !== undefined) row.visibleWhenFault = visibleWhenFault;
  if (className !== undefined) row.className = className;
  if (collapse) {
    row.collapsible = collapse.collapsible;
    row.collapsed = collapse.collapsed;
    row.onToggle = collapse.onToggle;
  }
  return [row as FormField];
}
