// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5543 — compile-time pin for the shape `registerObject` accepts.
 *
 * Both doors (`ObjectQL.registerObject` and `SchemaRegistry.registerObject`)
 * are annotated `ServiceObject`. Since ADR-0122 phase 2 (#6083) that bare spec
 * alias means the **authored** (`z.input`) shape — defaulted keys optional,
 * pre-transform — which is what the registry actually receives: `registerObject`
 * runs no `parse`, so nothing on that path materializes a `.default(...)`.
 * Before the flip the same annotation named the POST-parse shape, so a legal
 * authored literal was rejected with TS2740 demanding ~9 keys an author is not
 * supposed to write, and 135 call sites in this package reached for `as any`.
 *
 * This module pins both halves of that contract so a re-flip cannot land quietly:
 *   - the authored literal from #5543 compiles with **no** cast, and
 *   - a genuinely wrong literal (unknown key, wrong field type, missing `name`)
 *     still fails — the loosening must not admit garbage.
 *
 * WHY A `.pin.ts` AND NOT A `*.test.ts`: `packages/objectql/tsconfig.json`
 * excludes `**\/*.test.ts`, so a `@ts-expect-error` written in a test file here
 * is a phantom check — no tsc program the `typecheck` script runs would ever
 * evaluate it, and deleting the directive would leave every gate green
 * (AGENTS.md, #5286's `PINS_CHECKED`). This file IS in that program. It carries
 * no executable pin: the assertions live inside a function nobody calls, so the
 * only thing it costs at runtime is the literal below, which the companion
 * `register-object-authored-shape.test.ts` registers for real.
 */

import type { ObjectQL } from './engine.js';
import type { SchemaRegistry } from './registry.js';

/** The exact literal #5543 reported as uncompilable. */
export const AUTHORED_TASK_OBJECT = {
  name: 'task',
  label: 'Task',
  fields: { title: { type: 'text', label: 'Title' } },
} as const;

type EngineArg = Parameters<ObjectQL['registerObject']>[0];
type RegistryArg = Parameters<SchemaRegistry['registerObject']>[0];

/**
 * Never called — every line below is a type-level assertion evaluated by
 * `tsc --noEmit`. The parameters are taken as arguments rather than read off a
 * live engine so the pin needs no instance and no import cycle.
 */
export function __pinRegisterObjectAcceptsAuthoredLiterals(
  engineRegister: (schema: EngineArg) => unknown,
  registryRegister: (schema: RegistryArg, packageId: string) => unknown,
): void {
  // ── POSITIVE: what an author writes, verbatim, with no cast. ──────────────
  engineRegister({ name: 'task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } });
  registryRegister({ name: 'task', label: 'Task', fields: { title: { type: 'text', label: 'Title' } } }, 'p');
  // `label` and every other `.default(...)` key stays optional.
  engineRegister({ name: 'sys_thing', fields: {} });

  // ── NEGATIVE: the loosening must not admit garbage. ───────────────────────
  // @ts-expect-error `primaryKey` is not a spec Field key (it exists only on external-catalog columns)
  engineRegister({ name: 'task', fields: { title: { type: 'text', primaryKey: true } } });
  // @ts-expect-error 'longtext' is not a field type — the spec spells it 'textarea'
  engineRegister({ name: 'task', fields: { body: { type: 'longtext' } } });
  // @ts-expect-error `name` is required on every object, defaults or not
  engineRegister({ label: 'Task', fields: {} });
  // @ts-expect-error a field must be an object, not a bare type string
  engineRegister({ name: 'task', fields: { title: 'text' } });
}
