// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The every-item-prefixed rule of a gallery app: each item a scenario app
 * declares is named `<namespace>_<short>` (`democrm_pipeline`), not only its
 * objects. Two gallery apps installed in one environment then cannot collide on
 * a bare name (`overview`, `sales_manager`), and a gallery app reads as one.
 *
 * Objects are not judged here: `defineStack` already refuses an object without
 * its namespace prefix, and the card's `expect` names them namespace-relative.
 * Every OTHER collection of the manifest is, as the spec spells them
 * (`PLURAL_TO_SINGULAR`, the one table of manifest collections), read through
 * `resolveStackCollection` so a multi-package artifact is judged too.
 *
 * Only a bare name produces a check, and it always fails: one Build finding
 * per item, named by its type and name, so a candidate with one fails the
 * Build half. A clean build adds no check, so the rule never pads a score.
 *
 * Deterministic: no model call, no network (the cost ruling on cloud#3600).
 */

import { resolveStackCollection } from '@objectstack/core';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/meta-spelling';

import type { CheckResult } from './scenario-score.js';

/** One failing check per non-object item of `artifact` whose name does not start `<namespace>_`. */
export function gradeItemNames(artifact: unknown, namespace: string): CheckResult[] {
  const prefix = `${namespace}_`;
  const out: CheckResult[] = [];
  for (const [key, type] of Object.entries(PLURAL_TO_SINGULAR)) {
    if (key === 'objects') continue;
    for (const item of resolveStackCollection(artifact, key)) {
      const name = typeof item === 'object' && item !== null ? (item as { name?: unknown }).name : undefined;
      if (typeof name !== 'string' || name.startsWith(prefix)) continue;
      out.push({ check: `bare-name:${type}:${name}`, pass: false, detail: `a gallery app names every item \`${prefix}<short>\`; this ${type} is \`${name}\`` });
    }
  }
  return out;
}
