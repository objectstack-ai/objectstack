// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 D4, plan step 5] The answer `IObjectQLEngine.fixedReadLeafClassOf`
 * gives, which `ObjectQL` forwards to in one line (its facade allows nothing
 * else): the seam's own recognition, {@link fixedReadLeafClassOfEngine}, with
 * its "neither class" spelled `null` instead of `undefined`.
 *
 * Why the respelling: the member is optional, so a caller asking through
 * `engine.fixedReadLeafClassOf?.(leaf)` already gets `undefined` from an engine
 * without it, and must decline there (it cannot say). Were "neither" also
 * `undefined`, that caller could not tell an engine that answered from one
 * that could not, and a caller that read `undefined` as "neither" would compile
 * what it cannot see. With "neither" as `null`, the optional call is the
 * caller's whole three-state answer and its fail-closed reading needs no probe.
 *
 * Read-only, like the seam: it throws `TypeError` on a value that is not a
 * fixed-read leaf, and otherwise calls no driver and logs nothing.
 */

import type { FixedReadLeaf } from '@objectstack/spec/data';
import { fixedReadLeafClassOfEngine, type FixedReadLeafClass } from './fixed-read-leaf-seam.js';
import type { ObjectQL } from './engine.js';

/** Which of D4's two classes `leaf` falls in on `engine`, or `null` when neither. */
export function fixedReadLeafClassAnswerOf(engine: ObjectQL, leaf: FixedReadLeaf): FixedReadLeafClass | null {
  return fixedReadLeafClassOfEngine(engine, leaf) ?? null;
}
