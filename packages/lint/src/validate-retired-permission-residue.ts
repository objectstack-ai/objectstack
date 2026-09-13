// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Author-time signal for the ONE value the retired `allowRestore` /
 * `allowPurge` tombstones accept in silence (#17425, director ruling D).
 *
 * ## The gap this closes, and the gap it deliberately does NOT close
 *
 * `ObjectPermissionSchema` wraps its closed shape in
 * `acceptRetiredDefaultResidue(...)` — the class helper of #12840, at the exact
 * keys it was written for. That ruling is marked NOT re-adjudicable and nothing
 * here touches it: the parse keeps accepting the retired default and keeps
 * refusing every other value. The helper's own docblock states why the accept
 * is silent, and in the same sentence names the channels that stay loud:
 *
 *   > the strip is deliberately SILENT — real artifacts carry the residue once
 *   > per permission entry, and a per-occurrence notice would be a 75-line storm
 *   > that teaches operators to skim; the loud channels for authored sources
 *   > (tsc `never`, `os migrate meta`, the D2 conversion) are unchanged.
 *
 * Read that list against a JSON/YAML author and the gap is exactly one entry
 * wide. `tsc never` is a TypeScript channel — an author using `definePermissionSet`
 * cannot write the key at all. `os migrate meta` and the ADR-0087 D2 conversion
 * are the same channel twice: `permission-allow-restore-purge-removed` is
 * declared `retiredFromLoadPath: true`, so it fires only when someone RUNS the
 * migration, never on the load path (measured: `normalizeStackInput` on a raw
 * stack carrying `allowRestore: false` emits zero conversion notices and hands
 * the key straight through). So an author who writes the key in a non-TypeScript
 * source and never runs `os migrate meta` gets a clean parse and no signal — the
 * thing a tombstone exists to prevent, which is the whole of #17425's complaint.
 *
 * This rule is that missing channel, sited where the two paths ARE
 * distinguishable: BEFORE the parse (`input: 'normalized'`), on the raw authored
 * stack, where the residue is still present and still attributable to a line
 * somebody wrote. It says nothing about built artifacts, because a built
 * artifact never reaches an authoring command.
 *
 * ## Why only the residue VALUE
 *
 * The rule fires on the captured residue literal and on nothing else. Every
 * other value — `true`, `'false'`, `0`, `null` — already lands on the
 * tombstone's own refusal with the prescription attached, at the key's own path;
 * repeating it here would be a second voice saying the same thing one layer
 * earlier. The residue value is precisely the one the parse consumes without a
 * word, so it is precisely the one an author-time rule is needed for.
 *
 * ## Why the prescription is READ, not retyped
 *
 * `retiredKey()` publishes its guidance as the key's own `description`
 * (`[REMOVED] <guidance>`), and that string is the retirement's single wording —
 * pinned class-wide by `retired-key-migrate-sentence.test.ts` over in
 * `packages/spec`. A copy here would be a second wording free to drift from the
 * parse-time one the same author sees through the other door, so the hint is
 * resolved from `ObjectPermissionSchema`'s own shape at call time. An
 * unresolvable prescription yields NO finding rather than a hint this module
 * invented — the same posture `lintLivenessProperties` takes to an unreadable
 * ledger, and the reason this module's test carries an anti-vacuity guard.
 */

import { ObjectPermissionSchema } from '@objectstack/spec/security';
import { recordsOf } from './object-graph.js';

type AnyRec = Record<string, unknown>;

export interface RetiredPermissionResidueFinding {
  where: string;
  /** Positional config path, e.g. `permissions[0].objects.crm_ticket.allowRestore`. */
  path: string;
  message: string;
  hint: string;
  rule: string;
  severity: 'warning';
}

export const PERMISSION_RETIRED_LIFECYCLE_RESIDUE = 'permission-retired-lifecycle-residue';

/**
 * The retired object-permission keys and the ONE value each one's residue stage
 * swallows — the same discrimination `OBJECT_PERMISSION_RETIRED_KEY_RESIDUE`
 * makes, by identity against the literal captured at retirement time.
 *
 * ⛔ Not derived from anything live, for the reason `RetiredDefaultResidue`
 * states: the default no longer exists in the schema, so a literal written down
 * at retirement is the only trustworthy record of what the released toolchain
 * materialized. This table is the authoring-door copy of that same capture, and
 * `validate-retired-permission-residue.test.ts` holds it equal to the spec's.
 */
const RETIRED_LIFECYCLE_RESIDUE: ReadonlyArray<readonly [key: string, residue: boolean]> = [
  ['allowRestore', false],
  ['allowPurge', false],
];

/** Strip the `[REMOVED] ` marker `retiredKey()` prefixes onto its guidance. */
const REMOVED_MARKER = /^\[REMOVED\]\s*/;

/**
 * The retirement's own prescription for `key`, read from the tombstone's
 * published description. `null` when the shape or the description cannot be
 * resolved — see the module docblock for why that is silence rather than a
 * substitute wording.
 */
export function retiredKeyPrescription(key: string): string | null {
  const shape = (ObjectPermissionSchema as unknown as { shape?: Record<string, { description?: unknown }> }).shape;
  const described = shape?.[key]?.description;
  if (typeof described !== 'string' || described.length === 0) return null;
  const prescription = described.replace(REMOVED_MARKER, '').trim();
  return prescription.length > 0 ? prescription : null;
}

/**
 * Flag every authored object-permission entry carrying a retired lifecycle
 * key at its inert residue value. Advisory only — returns findings, never
 * throws, never emits `error`.
 */
export function validateRetiredPermissionResidue(stack: AnyRec): RetiredPermissionResidueFinding[] {
  const findings: RetiredPermissionResidueFinding[] = [];
  const sets = recordsOf(stack.permissions);
  for (let i = 0; i < sets.length; i++) {
    const set = sets[i];
    const objects = set.objects;
    if (!objects || typeof objects !== 'object' || Array.isArray(objects)) continue;
    const setName = typeof set.name === 'string' ? set.name : '(unnamed permission set)';
    for (const [objectName, perm] of Object.entries(objects as AnyRec)) {
      if (!perm || typeof perm !== 'object' || Array.isArray(perm)) continue;
      const entry = perm as AnyRec;
      for (const [key, residue] of RETIRED_LIFECYCLE_RESIDUE) {
        if (!Object.prototype.hasOwnProperty.call(entry, key)) continue;
        // Identity against the captured literal, exactly as the residue stage
        // compares. `0`/`''`/`null` are NOT this value and are refused at the
        // parse with the prescription already attached.
        if (entry[key] !== residue) continue;
        const hint = retiredKeyPrescription(key);
        if (hint === null) continue;
        findings.push({
          rule: PERMISSION_RETIRED_LIFECYCLE_RESIDUE,
          severity: 'warning',
          where: `permission set '${setName}' · object '${objectName}'`,
          path: `permissions[${i}].objects.${objectName}.${key}`,
          message:
            `sets \`${key}: ${JSON.stringify(residue)}\`, the retired default of a key removed in ` +
            '@objectstack/spec 17 (ADR-0049). It is accepted as inert residue and silently stripped ' +
            'on parse, so it grants nothing and nothing reports it — this line has no effect.',
          hint,
        });
      }
    }
  }
  return findings;
}
