/**
 * ObjectUI — what this tier says about `quickAdd` on `<object-kanban>` once the
 * key is RETIRED (objectui#8285, ruling B of decision batch #91, 2026-09-08)
 *
 * ## What changed
 *
 * Until objectui#8285 closed, `quickAdd` was a key `@objectstack/spec`
 * published on `object-kanban` and the board could not honour, so this package
 * carried an interim `inert-quick-add` warning in place of the `unknown-prop`
 * the prop walk would otherwise emit: "has no prop quickAdd" was FALSE against
 * the published contract. The ruling scheduled that interim for deletion the
 * day the spec's own refusal landed ("the spec refusal by name replaces that
 * diagnostic once it lands").
 *
 * It landed: `@objectstack/spec` 17.5.0 tombstones the key, both faces of
 * `@object-ui/types`' `ObjectKanbanSchema` refuse it by name, and
 * `ObjectKanban` no longer forwards it. So the interim module and its four
 * exports are gone, and the walk's own answer is back.
 *
 * ## Why a bare `unknown-prop` is the accurate answer now
 *
 * "`<object-kanban>` has no prop quickAdd" is TRUE on every face after the
 * retirement, and on this tier it is also the whole remedy: a constrained-JSX
 * page cannot write the `onQuickAdd` function the control needs, so the only
 * edit open to its author is to delete the key. That is the difference from the
 * retired `body` dialect next door (`./body-dialect-6771.test.ts`), which keeps
 * a replacement diagnostic because it has a replacement SPELLING to name
 * (`children`); `quickAdd` has none on this tier.
 *
 * The live-registry half of this reading — the manifest a real page compiles
 * against — is pinned in
 * `packages/plugin-kanban/src/__tests__/quickAddRetiredNotForwarded-8285.test.tsx`.
 */
import { describe, expect, it } from 'vitest';
import * as sduiParser from '../index.js';
import { compile, manifestFromConfigs, validateTree } from '../index.js';
import type { Diagnostic, Manifest } from '../types.js';

/** The `object-kanban` registration's shape: `quickAdd` is not among its inputs. */
const manifest: Manifest = manifestFromConfigs([
  {
    type: 'object-kanban',
    namespace: 'plugin-kanban',
    inputs: [
      { name: 'objectName', type: 'string', required: true },
      { name: 'groupBy', type: 'string' },
    ],
  },
]);

const diagnose = (node: Record<string, unknown>): Diagnostic[] =>
  validateTree(node as never, manifest).diagnostics;

/** The retired interim's code, spelled here because the constant left the barrel. */
const RETIRED_CODE = 'inert-quick-add';

describe('objectui#8285 — `quickAdd` on <object-kanban> draws the walk\'s own `unknown-prop`', () => {
  it.each([[true], [false], [{ $expr: 'rows.length > 0' }]])(
    'value %p — exactly one diagnostic, an `unknown-prop` warning naming the key',
    (value) => {
      const diagnostics = diagnose({ type: 'object-kanban', objectName: 'task', quickAdd: value });
      expect(diagnostics.map((d) => [d.severity, d.code, d.tag])).toEqual([
        ['warning', 'unknown-prop', 'object-kanban'],
      ]);
      expect(diagnostics[0].message).toContain('"quickAdd"');
    },
  );

  it('the retired interim code is emitted for no value of the key', () => {
    // `true` is the row that drew it before; `false` and the braced marker are
    // the two it deliberately skipped. None of them may draw it now.
    for (const value of [true, false, { $expr: 'x' }]) {
      const codes = diagnose({ type: 'object-kanban', objectName: 'task', quickAdd: value }).map((d) => d.code);
      expect(codes).not.toContain(RETIRED_CODE);
    }
  });

  it('through the whole pipeline: source text compiles, with the warning and nothing harder', () => {
    const result = compile('<object-kanban objectName="task" quickAdd={true} />', manifest);
    expect(result.diagnostics.map((d) => d.code)).toEqual(['unknown-prop']);
    // A warning, as the interim was: the save gate's pass/fail does not move.
    expect(result.ok).toBe(true);
    // Non-vacuity for that `true`: the same pipeline does turn `ok` false.
    expect(compile('<not-a-block />', manifest).ok).toBe(false);
  });

  it('the barrel no longer publishes the interim\'s four exports', () => {
    const exported = Object.keys(sduiParser);
    for (const name of ['checkKanbanQuickAdd', 'INERT_QUICK_ADD', 'QUICK_ADD_HOST_TYPES', 'QUICK_ADD_KEY']) {
      expect(exported).not.toContain(name);
    }
    // Control on the same instrument: the sibling retired-key check is still
    // exported, so the four absences are a reading of this barrel.
    expect(exported).toContain('checkRetiredBodyDialect');
  });
});
