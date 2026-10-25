/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The one layout arm that still DROPS an authored `FormSection.visibleWhen`
 * (objectui#6237).
 *
 * Of the six layout routes in `ObjectForm`, five honour the predicate:
 * `split` / `drawer` / `modal` rebuild each section key by key and copy it
 * (#6111), the flat arm carries it on the `section-divider` pseudo-field
 * (#6236), and `tabbed` joined them by copying it onto the tab `TabbedForm`
 * synthesises, where the renderer evaluates it (#6237). `wizard` is the
 * remainder.
 *
 * ⛔ The wizard's gap is a DESIGN boundary, not an oversight, and it is not one
 * copy line away. A step predicate would be step-boundary reactive against the
 * ruled live-record reactivity, and it needs navigation, indicator, final-gate
 * and re-selection semantics that the tab arm's machinery does not supply —
 * `WizardStepConfig` carries the full measurement. Until that contract is ruled,
 * an author who writes the key on a wizard is told so rather than watching it do
 * nothing.
 *
 * Since objectstack#13622 (ruled 2026-08-31) the boundary is ALSO enforced at
 * the author door: `@objectstack/spec` refuses `visibleWhen` on a wizard step
 * at parse, so authored form-view metadata can no longer arrive here carrying
 * it. This report is deliberately KEPT (Card R of that ruling): programmatic
 * SDUI callers do not pass the spec door, and metadata published before the
 * tightening still round-trips — for both, this warning is the only signal.
 *
 * Single-sourced so the runtime report and the pin that holds its wording cannot
 * drift apart.
 */
export function sectionPredicateUnsupportedWarning(
  layout: 'wizard',
  sectionNames: string,
): string {
  return '[ObjectForm] Section `visibleWhen` is not yet supported on this layout: '
    + `the \`${layout}\` layout's steps drop the predicate, so section(s) `
    + `${sectionNames} render unconditionally. A wizard STEP predicate is a `
    + 'separate contract still being designed (objectui#6237) — it is not the '
    + 'tab predicate with a different name. Today, use '
    + "`formType: 'tabbed' | 'modal' | 'drawer' | 'split'` or the flat layout — "
    + 'each honours a section `visibleWhen` — or move the predicate onto the '
    + 'individual fields, whose own `visibleWhen` is evaluated on every layout.';
}

/*
 * Lives in its own module rather than in `ObjectForm.tsx`: exporting a
 * non-component from a component file costs that file Fast Refresh
 * (`react-refresh/only-export-components`), and `ObjectForm` is edited often
 * enough for that to be a real tax. Deliberately NOT re-exported from the
 * package barrel — this is an internal diagnostic, not published surface.
 */
