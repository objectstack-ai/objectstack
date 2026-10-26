/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Expression wire validator
 *
 * The ONE Zod spelling of a predicate as it travels on the wire -- the runtime
 * twin of `ExpressionWire` (`../expression.ts`). Read by `BaseSchema`'s
 * `visible` / `hidden` / `disabled` (`./base.zod.ts`) and by the form predicate
 * keys (`./form.zod.ts`, where it lived as a module-private const until
 * objectui#7530 hoisted it here).
 *
 * @module zod/expression
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * The wire shape of a CEL predicate (objectui#2212): a bare string or the
 * Expression envelope `{ dialect?, source }`. Deliberately NOT the spec's
 * ExpressionInput pipe, which canonicalizes strings into an envelope at parse
 * time and would change the output shape of every module that adopted it.
 *
 * `dialect` is optional and unconstrained and `source` is a required string
 * because that is exactly what `@object-ui/core`'s `toPredicateInput` accepts:
 * a `'cel'` envelope stays on the canonical engine, every other dialect is
 * unwrapped onto the legacy `${...}` path, and an object without a string
 * `source` is "no predicate". The reasoning is written once, on the TS twin.
 *
 * Reuse is pinned by REFERENCE, not by shape:
 * `__tests__/base-schema-predicate-envelope-7530.test.ts` asserts that the
 * object arm `BaseSchema.shape.visible` carries IS this const, and so is the
 * one `FormFieldSchema.shape.visibleWhen` carries. A faithful copy passes every
 * value comparison and is still the second envelope type objectui#7530's
 * ruling forbids.
 */
export const ExpressionWireSchema = z.union([
  z.string(),
  z.object({ dialect: z.string().optional(), source: z.string() }),
]);
