// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12758 — compile-time pin for the shape `registerDatasourceDef` accepts and
 * the shape `listDatasourceDefs` answers.
 *
 * THE DEFECT THIS PINS WAS PURELY TYPE-LEVEL, which is why the pin lives here
 * and not only in a `.test.ts`. Measured on the pre-change tree: nothing ever
 * stripped `external.credentialsRef` at runtime — `registerDatasourceDef`
 * stored the caller's `external` object whole, by reference, and the manifest
 * install path spread the def straight through — so the reference was already
 * in the engine's index. What did not exist was any way to put it there
 * honestly or to read it back:
 *
 *   - a caller passing a FRESH object literal was refused with TS2353
 *     ("'credentialsRef' does not exist in type '{ allowWrites?: boolean }'"),
 *     so the only way in was a pre-typed variable or an `as any`; and
 *   - the engine exposed no accessor onto the index at all — its sole reader
 *     was the private write gate.
 *
 * A runtime test therefore cannot cover this card: the runtime never changed.
 * The accepted set of a public method did, and only `tsc` can see that.
 *
 * WHY A `.pin.ts` AND NOT A `*.test.ts`: `packages/objectql/tsconfig.json`
 * excludes `**\/*.test.ts`, so a `@ts-expect-error` written in a test file here
 * is a phantom check — no tsc program the `typecheck` script runs would ever
 * evaluate it, and deleting the directive would leave every gate green. This
 * file IS in that program. Same convention, and same reasoning, as
 * `register-object-authored-shape.pin.ts`. It carries no executable pin: the
 * assertions live in a function nobody calls, and the companion
 * `datasource-def-credentials-ref.test.ts` covers the runtime half.
 */

import type { DatasourceDef, ObjectQL } from './engine.js';

/**
 * Taken off the METHOD, not off {@link DatasourceDef}, so that re-narrowing the
 * method's own signature moves this pin even if the named type survives.
 */
type RegisterArg = Parameters<ObjectQL['registerDatasourceDef']>[0];
type ListedDefs = ReturnType<ObjectQL['listDatasourceDefs']>;

/**
 * Never called — every line is a type-level assertion evaluated by
 * `tsc --noEmit`. The members are taken as parameters rather than read off a
 * live engine so the pin needs no instance.
 */
export function __pinDatasourceDefCarriesCredentialsRef(
  register: (def: RegisterArg) => void,
  listed: ListedDefs,
): void {
  // ── POSITIVE: the calls this card exists for. ────────────────────────────
  // FRESH object literals throughout — excess-property checking is the thing
  // under test, so a pre-typed variable here would defeat the pin entirely.
  register({
    name: 'warehouse',
    schemaMode: 'external',
    external: { allowWrites: true, credentialsRef: 'sys_secret:sec_1' },
  });
  // `credentialsRef` alone, no federation key: legal on a MANAGED datasource
  // per #8153, and the shape the Studio wizard's createDatasource writes.
  register({ name: 'warehouse', external: { credentialsRef: 'secret:warehouse/password' } });

  // ── The pre-#12758 shapes must keep compiling — this is a WIDENING. ──────
  register({ name: 'warehouse' });
  register({ name: 'warehouse', schemaMode: 'external', external: { allowWrites: true } });

  // ── NEGATIVE: the widening must not admit garbage. ───────────────────────
  // @ts-expect-error `name` is required — a definition without one registers nothing
  register({ schemaMode: 'external' });
  // @ts-expect-error `credentialsRef` is a REFERENCE into the secrets store, so a string
  register({ name: 'warehouse', external: { credentialsRef: 12_345 } });
  // @ts-expect-error inline credentials are refused everywhere — `password` is not a key here
  register({ name: 'warehouse', external: { password: 'hunter2' } });
  // @ts-expect-error the widening is scoped to credentialsRef; `validation` has no engine reader
  register({ name: 'warehouse', external: { validation: { onMismatch: 'warn' } } });

  // ── READ-BACK: the accessor answers definitions, keyed by name. ──────────
  const one: DatasourceDef | undefined = listed[0];
  const ref: string | undefined = one?.external?.credentialsRef;
  const gate: boolean | undefined = one?.external?.allowWrites;
  void ref;
  void gate;
  // @ts-expect-error the accessor answers definitions, not bare datasource names
  const notAName: string = listed[0];
  void notAName;
}
