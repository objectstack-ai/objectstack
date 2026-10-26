/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The AUTHORING ("input") type of a `@objectstack/spec` zod schema.
 *
 * ## Why not `z.infer`
 *
 * `z.infer` is the OUTPUT type — what `.parse()` returns, with every
 * `.default()` already applied and therefore REQUIRED. The hooks in this
 * package are handed configuration an app author wrote by hand, so the input
 * side is the one that describes what they may legally omit. Deriving a config
 * type from `z.infer` turns every defaulted key into a required one and makes
 * the schema's own defaults unusable — the `_input`/`_output` trap the spec
 * symbol guard's header warns about, and the one that already bit
 * `ObjectFieldGroup` in objectui#3169.
 *
 * Rule of thumb: is this module WRITING the metadata, or READING what has
 * already been parsed? Writing → input. Reading → `z.infer`.
 *
 * ## Why it reads `_zod`, not `z.input`
 *
 * `z.input<typeof S>` needs a `zod` import, and `@object-ui/react` deliberately
 * does not depend on zod — it renders plain objects and never parses. The
 * schema's own type already carries both sides in `_zod`, so the input type is
 * reachable through the spec's binding alone, with no new dependency and no
 * copy of the shape.
 */
export type SpecAuthoredInput<S extends { _zod: { input: unknown } }> = S['_zod']['input'];
