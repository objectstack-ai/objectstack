// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { objectTitleCompleteness } from '@objectstack/spec/data';
import type { DisplayNameObjectMeta } from '@objectstack/spec/data';
import { recordsOf } from './object-graph.js';

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
 * - `title-format-retired` ({@link validateTitleFormatRetired}) — the object
 *   declares a `titleFormat`. That field is a RENDER-ONLY template the server
 *   can neither return nor query; ADR-0079 retires it in favour of `nameField`,
 *   and an explicit or stamped `nameField` outranks it, so a declared template
 *   titles nothing. An ERROR, under the ruling of record on #29007 (6574393684,
 *   letter B): an object definition that declares it is refused at the
 *   metadata save gate (the runtime publish gate, which an active save, a draft
 *   promotion and a restore all run) and by `os validate` / `os build` /
 *   `os lint`. The schema still parses the key, so a stored object that carries
 *   it keeps loading and reading; it is refused only when it is next saved or
 *   validated. Its own registry entry, apart from the title pair below,
 *   because the two rules sit on different tiers.
 * - `title-unresolvable` ({@link validateRecordTitle}) —
 *   `objectTitleCompleteness` reports `status: 'none'`: no
 *   `nameField`/`displayNameField` pointer and no title-eligible field to
 *   derive one from. Records will have no meaningful title (the runtime falls
 *   back to the auto-provisioned primary / `Record #<id>` floor), so this is a
 *   warning, not an error — nothing is fully broken: the auto-provision
 *   transform and the id floor mean a green build never ships a fully
 *   title-less object. Reuses the shared spec predicate
 *   (`@objectstack/spec/data` → display-name) so cloud and framework classify
 *   titles identically.
 */

export const TITLE_FORMAT_RETIRED = 'title-format-retired';
export const TITLE_UNRESOLVABLE = 'title-unresolvable';

export type RecordTitleSeverity = 'error' | 'warning';

export interface RecordTitleFinding {
  /** `error` for `title-format-retired`, `warning` for `title-unresolvable` (see module note). */
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

/**
 * Refuse every object that declares a `titleFormat` (ADR-0079; the ruling of
 * record on #29007). Returns one `error` per declaring object, empty when none
 * does. The message and the fix line are the prescription the `titleFormat`
 * describe carries: a single-field title is `nameField`; a composite title is a
 * stored computed field `nameField` points at.
 *
 * Reads the authored key only, so it runs pre-parse: an empty string is no
 * declaration (the schema refuses a blank template on its own).
 */
export function validateTitleFormatRetired(stack: AnyRec): RecordTitleFinding[] {
  const findings: RecordTitleFinding[] = [];

  const objects = recordsOf(stack.objects);
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const objName = typeof obj.name === 'string' ? obj.name : `(object ${i})`;
    const where = `object "${objName}"`;
    const path = `objects[${i}]`;

    if (obj.titleFormat !== undefined && obj.titleFormat !== null && obj.titleFormat !== '') {
      findings.push({
        severity: 'error',
        rule: TITLE_FORMAT_RETIRED,
        where,
        path,
        message:
          `${objName}: titleFormat is retired (ADR-0079) — migrate to nameField ` +
          `(single field); a composite title that import, sort or search must match is a stored ` +
          `field with an expression designated nameField (a formula title is for display only)`,
        // [#22161] One remedy line; why the template is retired (render-only,
        // neither returned nor queryable) is `os explain title-format-retired`.
        hint:
          `Set nameField: '<field>' for one field; a composite title to import, sort or search by is a ` +
          `text field with an expression, stored on write (a text formula is display-only); drop titleFormat`,
      });
    }
  }

  return findings;
}

/**
 * Validate every object's record-title resolvability (`title-unresolvable`).
 * Returns the list of findings (empty = clean). Advisory (`warning`): the
 * caller must never fail the build on it alone — auto-provision + the
 * `Record #<id>` floor guarantee a resolvable title at runtime. A declared
 * `titleFormat` is {@link validateTitleFormatRetired}'s, not this rule's.
 */
export function validateRecordTitle(stack: AnyRec): RecordTitleFinding[] {
  const findings: RecordTitleFinding[] = [];

  const objects = recordsOf(stack.objects);
  for (let i = 0; i < objects.length; i++) {
    const obj = objects[i];
    const objName = typeof obj.name === 'string' ? obj.name : `(object ${i})`;
    const where = `object "${objName}"`;
    const path = `objects[${i}]`;

    // ── no resolvable title (status: 'none') ──
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
        // [#22161] One remedy line; the runtime's fallback title, and why this
        // is only a warning, are `os explain title-unresolvable`.
        hint:
          `Set nameField to a text/email field (a composite title to import, sort or search by: a text ` +
          `field with an expression; a text formula is display-only), or add a text field named "name"/"title"`,
      });
    }
  }

  return findings;
}
