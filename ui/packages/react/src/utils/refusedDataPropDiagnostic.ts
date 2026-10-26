/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Dev-build diagnostic: an authored `data` key that did NOT reach the block as
 * a React prop, because that block's published `data` row is the `ViewData`
 * OBJECT arm (objectui#9571, extended to the legacy `props` alias bag by
 * objectui#9758).
 *
 * ## Why the diagnostic lives HERE and not in `SchemaRenderer.tsx` (objectui#9959)
 *
 * It was born as module state inside `SchemaRenderer.tsx`, next to the two call
 * sites that emit it. Every other dev diagnostic in this directory —
 * `propsBagDiagnostic.ts`'s two and `visibilityDiagnostic.ts`'s one — pairs its
 * dedupe `Set` with an exported test-only reset, and each of those resets says
 * in its own docblock what it exists to prevent. This one had no reset, and it
 * could not simply grow one where it stood: `index.ts` re-exports
 * `SchemaRenderer.js` with a star, so a `__reset` added there would have been a
 * new member of this package's PUBLISHED surface — a contract change, for a
 * test affordance. Moving the `Set`, the emit and the reset into this module
 * puts all three where their siblings already live and adds nothing to the
 * published entry, which is the whole shape of the remedy.
 *
 * ## The caller owns the production gate
 *
 * Same contract as `reportDroppedPropsBag` next door: `SchemaRenderer` applies
 * `__DEV__` at the call site, so this stays one dev-only branch there and the
 * whole module is dead code in a production build.
 */

/**
 * Warn ONCE per distinct refused node, not once per render (objectui#9571).
 *
 * The strip at the call site runs on every render of the node, and a warning
 * that floods the console is a warning that gets muted — the same warn-once
 * discipline `ObjectMap`'s legacy-config notice and the visibility-predicate
 * diagnostics already use. Keyed on the node's type plus its id, which is the
 * pair an author can act on; a node with no `id` is keyed on its type alone and
 * so warns once per type, which is the honest ceiling for something that cannot
 * be told apart.
 */
const _warnedRefusedDataPropNodes = new Set<string>();

/**
 * Test-only reset for the dedupe above. Without it the second test to assert
 * the same warning reads the first test's dedupe entry and sees silence — a
 * green run that checked nothing.
 *
 * ⚠️ The dangerous shape is the ABSENCE assertion, and it is why this export is
 * a correctness affordance rather than a convenience: a test that asserts this
 * warning did NOT fire for a `type#id` an earlier test already warned for is
 * green whatever the renderer does, and it reports that green as coverage
 * (objectui#9959). `SchemaRenderer.refusedDataPropWarnReset-9959.test.tsx`
 * renders one `type#id` across separate `it()` blocks and goes red when this
 * body stops clearing.
 */
export function __resetRefusedDataPropWarnings(): void {
  _warnedRefusedDataPropNodes.clear();
}

/**
 * Say why an authored `data` key did not reach the block (objectui#9571,
 * ruling objectui#8348 Q2-C, decision batch #136 item 3, maintainer 「同意」).
 *
 * ## Why this diagnostic is part of the change and not decoration
 *
 * ⛔ MEASURED, and it corrects the card's own premise: the ladder emits NO
 * runtime signal when it refuses an off-arm `data`. `resolveRecordSourceConfig`
 * returns `null` and falls through silently, and `validateSchema` — the
 * `__DEV__` pass in `SchemaRenderer.tsx` — never reads `data` against the
 * block's row at all. The refusal is loud at AUTHORING time (`os validate`, the
 * save gate and the zod row all reject a bare array) and mute at render time.
 *
 * So without this line, retiring the props carrier is exactly the failure shape
 * AGENTS.md #0.1 and `ObjectGrid`'s own column diagnostic exist to prevent:
 * renderer and author disagree, and the author gets a success receipt — a page
 * whose rows were on screen yesterday is blank today, with nothing anywhere
 * naming the key that was dropped or the spelling that would work.
 *
 * Read-only and `__DEV__`-only: it reports the decision made at the call site
 * and changes nothing about what is rendered.
 */
export function reportRefusedDataPropSpread(type: string, id: string | undefined): void {
  const key = id === undefined ? type : `${type}#${id}`;
  if (_warnedRefusedDataPropNodes.has(key)) return;
  _warnedRefusedDataPropNodes.add(key);
  console.warn(
    `[ObjectUI] SchemaRenderer: the authored \`data\` key on <${type}${
      id === undefined ? '' : ` id="${id}"`
    }> was NOT passed to the component as a React prop. This block's published ` +
      '`data` row is the `ViewData` OBJECT arm, so `data` is read from the schema ' +
      'and judged by that row (objectui#8348). Inline rows go at ' +
      '`data: { provider: "value", items: [...] }`; a bare array under `data` is ' +
      'refused. A HOST passing rows down as a React `data` prop is unaffected.',
  );
}
