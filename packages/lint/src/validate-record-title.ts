// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { objectTitleCompleteness } from '@objectstack/spec/data';
import type { DisplayNameObjectMeta } from '@objectstack/spec/data';

/**
 * Build-time record-title diagnostics (ADR-0079).
 *
 * A record's human title is a structural invariant: every object resolves a
 * primary title from a real STORED field via `nameField` (the canonical
 * pointer; `displayNameField` is the deprecated alias) or a deterministic
 * derivation. Two authoring smells are flagged here so `os build`/`os lint`,
 * the MCP authoring surface, and hand-authoring all get the coverage cloud
 * graph-lint already has (the ADR-0078 "not cloud-only" principle):
 *
 * - `title-format-retired` — the object declares a `titleFormat`. That field
 *   is a RENDER-ONLY template the server can neither return nor query; ADR-0079
 *   retires it in favour of `nameField`. The schema still parses it (existing
 *   metadata keeps loading), so this is advisory, not an error.
 * - `title-unresolvable` — `objectTitleCompleteness` reports `status: 'none'`:
 *   no `nameField`/`displayNameField` pointer and no title-eligible field to
 *   derive one from. Records will have no meaningful title (the runtime falls
 *   back to the auto-provisioned primary / `Record #<id>` floor), so this is a
 *   warning, not an error — nothing is fully broken.
 *
 * Both are warnings: the auto-provision transform and the id floor mean a
 * green build never ships a fully title-less object. Reuses the shared spec
 * predicate (`@objectstack/spec/data` → display-name) so cloud and framework
 * classify titles identically.
 */

export const TITLE_FORMAT_RETIRED = 'title-format-retired';
export const TITLE_UNRESOLVABLE = 'title-unresolvable';

export type RecordTitleSeverity = 'error' | 'warning';

export interface RecordTitleFinding {
  /** Always `warning` today — both rules are advisory (see module note). */
  severity: RecordTitleSeverity;
  /** Diagnostic rule id (registry entry), e.g. `title-format-retired`. */
  rule: string;
  /** Human-readable location, e.g. `object "invoice"`. */
  where: string;
  /** Config path, e.g. `objects[3]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/**
 * Validate every object's record-title declaration. Returns the list of
 * findings (empty = clean). Both rules are advisory (`warning`): the caller
 * must never fail the build on them alone — auto-provision + the `Record #<id>`
 * floor guarantee a resolvable title at runtime.
 */
export function validateRecordTitle(stack: AnyRec): RecordTitleFinding[] {
  const findings: RecordTitleFinding[] = [];

  const objects = asArray(stack.objects);
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const objName = typeof obj.name === 'string' ? obj.name : `(object ${i})`;
    const where = `object "${objName}"`;
    const path = `objects[${i}]`;

    // ── (a) titleFormat is retired (ADR-0079) ──
    // Render-only template the server cannot return or query. Still parsed by
    // the schema for back-compat, so advisory.
    if (obj.titleFormat !== undefined && obj.titleFormat !== null && obj.titleFormat !== '') {
      findings.push({
        severity: 'warning',
        rule: TITLE_FORMAT_RETIRED,
        where,
        path,
        message:
          `${objName}: titleFormat is retired (ADR-0079) — migrate to nameField ` +
          `(single field) or a formula field designated nameField`,
        hint:
          `titleFormat is a render-only template the server cannot return or ` +
          `query, and an explicit nameField now takes precedence. For a ` +
          `single-field title set nameField: '<field>'. For a composite title, ` +
          `add a formula field (returnType: 'text') and designate it via ` +
          `nameField.`,
      });
    }

    // ── (b) no resolvable title (status: 'none') ──
    // Reuse the shared spec predicate so cloud graph-lint and framework lint
    // classify titles identically. `none` = no pointer AND nothing derivable.
    const completeness = objectTitleCompleteness(obj as DisplayNameObjectMeta);
    if (completeness.status === 'none') {
      findings.push({
        severity: 'warning',
        rule: TITLE_UNRESOLVABLE,
        where,
        path,
        message:
          `${objName}: no resolvable record title — records will have no ` +
          `meaningful name (no nameField and no title-eligible field to derive one)`,
        hint:
          `Set nameField to a text/email field (or a formula field with ` +
          `returnType: 'text'), or add a text field named "name"/"title". The ` +
          `runtime auto-provisions a primary and falls back to "Record #<id>", ` +
          `but an explicit title is far more useful.`,
      });
    }
  }

  return findings;
}
