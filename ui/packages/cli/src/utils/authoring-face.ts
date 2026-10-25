/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE door through which `objectui validate` and `objectui check` judge an
 * authored document: the STRICT AUTHORING FACE (objectui#5250, slice A).
 *
 * The maintainer ruling on objectui#5250 (2026-09-04, decision batch #25,
 * option 2) reads: "each node schema gets a derived strict variant;
 * `objectui validate` and the doc-snippet gates run **strict**; renderer props
 * keep the tolerant face unchanged". `StrictAnyComponentSchema` is that variant
 * (objectui#8345): the same declarations as `AnyComponentSchema`, with every
 * object closed, at every depth. So a key no schema declares is REFUSED here,
 * where the tolerant face kept it unjudged — `BaseSchemaCore` is `.passthrough()`,
 * and that is the face the RENDERER keeps. ⛔ Nothing here touches it.
 *
 * Why one function and not two call sites: both commands called
 * `safeValidateSchema` directly, and two call sites are how two commands drift
 * into two verdicts on one document. Both now call this, so `check`'s
 * validity arm and `validate`'s verdict are the same parse by construction.
 *
 * ⛔ No flag chooses the face, in either direction. A `--strict` opt-in or a
 * `--tolerant` escape would widen the CLI's public surface, and the ruling
 * names the strict face as THE authoring verdict, not as a mode of it.
 */

import { StrictAnyComponentSchema } from '@object-ui/types/zod';

import { formatIssuePath } from './issue-path.js';
import { authoredTypeAt, type UndeclaredKey } from './union-arm-diagnostics.js';

/** Judge one authored document through the strict authoring face. */
export function validateAuthoredDocument(document: unknown) {
  return StrictAnyComponentSchema.safeParse(document);
}

/**
 * The line that names one undeclared key, where it sits, and what to do.
 *
 * A strict refusal read off the issue list alone can be a bare `Invalid input`
 * at a union the object fits more than one arm of (a dashboard widget), or
 * `Unrecognized key` with no word on what to do about it.
 * This is the loud form: the key, the path of the object carrying it (spelled
 * by `formatIssuePath`, like every other path the CLI prints), that object's
 * own `type` when it has one, and the prescription.
 *
 * The `type` is quoted as a FACT about the object, never as a claim about
 * which schema judged it: a form field's `type` is a field type, not a
 * component, so "the keys `text` declares" would send the author to the wrong
 * list. The prescription therefore points at the position, not at a type.
 */
export function describeUndeclaredKey(finding: UndeclaredKey, document: unknown): string {
  const type = authoredTypeAt(document, finding.path);
  const owner = type === undefined ? '' : ` (type "${type}")`;
  return (
    `Undeclared key "${finding.key}" at ${formatIssuePath(finding.path)}${owner}: ` +
    'no schema declares it there. Remove it, or check its spelling against the keys ' +
    'declared at that position.'
  );
}
