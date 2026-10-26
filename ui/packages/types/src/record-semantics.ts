/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Object-level semantic-role readers (ADR-0085) shared across surfaces.
 *
 * `detectStatusField` began life in `@object-ui/plugin-detail`'s page
 * synthesizer, but the `stageField` role is consumed by MORE than detail
 * pages (kanban default lanes, future list/report affordances), and those
 * consumers (`plugin-list`, `app-shell`) can't depend on plugin-detail.
 * The single source lives here; plugin-detail re-exports it unchanged.
 */

/** Minimal duck-typed slice of an object definition read by the detectors. */
export interface StatusFieldSource {
  /** Semantic role (ADR-0085): the linear-lifecycle field. `false` = the
   *  status-shaped field is NOT a linear flow — suppress stage heuristics. */
  stageField?: string | false;
  fields?: Record<string, { type?: string } | undefined>;
}

/**
 * Detect the canonical "status" / "stage" field on an object definition.
 *
 * Resolution order:
 *   1) the top-level `objectDef.stageField` semantic role (spec-typed since
 *      ADR-0085). `false` = the status-shaped field is NOT a linear flow —
 *      suppress stage detection entirely (no `record:path`, no default
 *      kanban lane field; #2065).
 *   2) else the first field named status / stage / state / phase
 *   3) else the first field of type status / stage
 *   4) else null
 */
export function detectStatusField(def?: StatusFieldSource | null): string | null {
  if (!def) return null;
  const hint = def.stageField;
  if (hint === false) return null;
  if (typeof hint === 'string' && hint) return hint;
  const fields = def.fields || {};
  const candidates = ['status', 'stage', 'state', 'phase'];
  for (const key of candidates) {
    if (key in fields) return key;
  }
  for (const [name, field] of Object.entries(fields)) {
    const t = (field?.type || '').toLowerCase();
    if (t === 'status' || t === 'stage') return name;
  }
  return null;
}
