/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * An action's `params` values are templates, evaluated where `properties` are
 * (objectui#7867, ruling A, maintainer 「其他同意」 2026-09-20).
 *
 * ## The rule
 *
 * Every STRING LEAF of a node's `params` bag - the node-level `params` and
 * `properties.params` alike, at any depth - is template-evaluated by the
 * `SchemaRenderer` evaluation memo, with the same evaluator and the same
 * scope (`record`, `current_user`, `page`, the host's ambient roots) that
 * already evaluates `properties`. Before it, `params` was the one argument bag
 * an `action:button` hands the runner, and nothing walked it: the node-level
 * bag was never evaluated at all, and `properties.params` was ONE value of a
 * per-value, shallow loop, so a template one level inside it was never
 * visited. A metadata-authored `navigate_edit` could not name the record it
 * sits on.
 *
 * ## Why this module exists, and why it is not in `SchemaRenderer.tsx`
 *
 * Two readers must agree on exactly one radius: the memo that EVALUATES the
 * leaves, and the dev diagnostic (`unevaluatedExpression.ts`) that REPORTS the
 * leaves still carrying `${…}` afterwards. That diagnostic's header states its
 * own rule - "Depth: exactly the evaluator's own radius, and not one level
 * more" - so a second copy of this walk would be a second definition of that
 * radius, free to drift. Both import this one. It lives in its own module
 * rather than in the diagnostic's because the memo runs in production and the
 * diagnostic module is meant to be dead code there.
 *
 * ## What counts as a bag, a container and a leaf
 *
 * - **The bag** is a PLAIN object: an object literal or JSON object, whose
 *   prototype is `Object.prototype` or `null`. An ARRAY `params` is not a bag:
 *   it is the `ActionParam[]` definition list `action:button` routes to
 *   `actionParams` for the params dialog, whose members carry predicates and
 *   formats (`visible`, `titleFormat`, option `visibleWhen`) that are evaluated
 *   later, against another scope. It is left untouched, as before.
 * - **Containers** inside the bag - plain objects and arrays - are walked.
 * - **String leaves** are handed to the visitor. Everything else is passed
 *   through by IDENTITY and never looked inside: numbers, booleans, `null`,
 *   `undefined`, functions, and non-plain objects (`Date`, `Map`, class
 *   instances). Those are host-built values, not authored templates.
 * - **Keys are never visited**, only values. A key that looks like a template
 *   stays exactly as written.
 * - **An expression envelope** (`{ dialect, source }`) is a plain object like
 *   any other: it is walked, and its `source` string is a leaf. It is never
 *   collapsed to its `source` the way a bare top-level config value is.
 * - **Cycles** end the walk: a container already on the current path is passed
 *   through unwalked. JSON metadata cannot carry one; a host-built schema can.
 *
 * ## Copy on write
 *
 * A container is copied only when one of its descendants changed, so a bag
 * with no template in it comes back as the very object that went in, and a
 * changed bag never mutates the authored one (the memo's input is the
 * caller's schema). Nothing may depend on that identity (AGENTS.md #10); it is
 * there so that a template-free bag stays byte-for-byte and reference-for-
 * reference what it was.
 */

import { isConfigBag } from './configBag.js';

/** The key this rule is about. One spelling, shared by both readers. */
export const PARAMS_KEY = 'params';

/**
 * A plain object: an object literal / JSON object, and nothing more exotic.
 *
 * Built ON the package's one "is this a config bag?" answer (objectui#6761)
 * and narrowed by prototype, rather than re-spelling the object/array test:
 * this rule asks that question plus one more (a `Date` or class instance is a
 * bag to {@link isConfigBag}, and is not something this walk looks inside).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isConfigBag(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Is this value a `params` BAG this rule walks? A plain object only - see the
 * module header for why an array `params` (the definition list) is not.
 */
export function isParamsBag(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value);
}

/**
 * Visit one string leaf. `path` spells where it sits the way an author would
 * search for it: `params.target.id`, `params.ids[0]`.
 */
export type ParamsLeafVisitor = (leaf: string, path: string) => unknown;

function walk(
  value: unknown,
  path: string,
  visit: ParamsLeafVisitor,
  onPath: Set<object>,
): unknown {
  if (typeof value === 'string') return visit(value, path);

  if (Array.isArray(value)) {
    if (onPath.has(value)) return value;
    onPath.add(value);
    let copy: unknown[] | undefined;
    for (let i = 0; i < value.length; i++) {
      const next = walk(value[i], path + '[' + i + ']', visit, onPath);
      if (next !== value[i]) {
        if (!copy) copy = value.slice();
        copy[i] = next;
      }
    }
    onPath.delete(value);
    return copy ?? value;
  }

  if (isPlainObject(value)) {
    if (onPath.has(value)) return value;
    onPath.add(value);
    let copy: Record<string, unknown> | undefined;
    for (const key of Object.keys(value)) {
      const leaf = value[key];
      const next = walk(leaf, path + '.' + key, visit, onPath);
      if (next !== leaf) {
        if (!copy) copy = { ...value };
        // `defineProperty`, not assignment: an own `__proto__` key (which
        // `JSON.parse` does produce) must stay an own data property rather than
        // reach the prototype setter.
        Object.defineProperty(copy, key, {
          value: next,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }
    onPath.delete(value);
    return copy ?? value;
  }

  return value;
}

/**
 * Map every string leaf of a `params` bag through `visit`, at any depth, and
 * return the result - the bag itself when nothing changed (copy on write).
 *
 * The evaluation memo passes the evaluator; the dev diagnostic passes a visitor
 * that records and returns the leaf unchanged, which is what makes the two
 * radii one radius by construction.
 */
export function mapParamsLeaves(
  bag: Record<string, unknown>,
  visit: ParamsLeafVisitor,
  basePath: string = PARAMS_KEY,
): Record<string, unknown> {
  return walk(bag, basePath, visit, new Set<object>()) as Record<string, unknown>;
}
