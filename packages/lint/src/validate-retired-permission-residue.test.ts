// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #17425, director ruling D. The rule's job is to be the ONE author-facing
// voice on a value the parse consumes in silence, so almost every assertion
// here is paired: a LIT control that must fire and a DARK control that must
// not. A rule of this shape fails in two directions and only one of them is
// noisy — a rule that never fires looks exactly like a clean codebase.

import { describe, expect, it } from 'vitest';
import { ObjectPermissionSchema } from '@objectstack/spec/security';
import { normalizeStackInput } from '@objectstack/spec';

import {
  PERMISSION_RETIRED_LIFECYCLE_RESIDUE,
  retiredKeyPrescription,
  validateRetiredPermissionResidue,
} from './validate-retired-permission-residue.js';
import { AUTHORING_COMMANDS, authoringRulesFor, runAuthoringRules } from './authoring-rules.js';

type AnyRec = Record<string, unknown>;

/** The two keys and the single value each one's residue stage swallows. */
const RETIRED: ReadonlyArray<readonly [string, boolean]> = [
  ['allowRestore', false],
  ['allowPurge', false],
];

/** A raw authored stack, map-shaped, exactly as a non-TypeScript source spells it. */
function rawStack(entry: AnyRec): AnyRec {
  return {
    permissions: {
      support_agent: {
        label: 'Support Agent',
        objects: { crm_ticket: { allowRead: true, ...entry } },
      },
    },
  };
}

/** The `normalizeStackInput` output every authoring command hands a `normalized` rule. */
function normalized(entry: AnyRec): AnyRec {
  return normalizeStackInput(structuredClone(rawStack(entry)) as AnyRec) as AnyRec;
}

describe('validateRetiredPermissionResidue (#17425)', () => {
  describe('the premise the rule stands on', () => {
    // Everything below is vacuous if the load path strips the key before a rule
    // can see it — which is what the ADR-0087 conversion does when it is asked
    // to. It is `retiredFromLoadPath`, so it is not asked to here.
    it('LIT — the residue survives normalizeStackInput, which is the tier this rule reads', () => {
      const perm = (normalized({ allowRestore: false, allowPurge: false }).permissions as AnyRec[])[0];
      const ticket = (perm.objects as AnyRec).crm_ticket as AnyRec;
      expect(Object.prototype.hasOwnProperty.call(ticket, 'allowRestore')).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(ticket, 'allowPurge')).toBe(true);
    });

    it('DARK — the same key does NOT survive the parse, which is why a `parsed` rule could not do this', () => {
      const parsed = ObjectPermissionSchema.safeParse({ allowRead: true, allowRestore: false });
      expect(parsed.success).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(parsed.data!, 'allowRestore')).toBe(false);
    });

    it.each(RETIRED)('the accept set for `%s` is exactly the value this rule fires on', (key, residue) => {
      // The rule's private table has to agree with the schema's captured
      // literal, and the schema does not export it — so the agreement is
      // asserted through the behaviour the capture produces.
      expect(ObjectPermissionSchema.safeParse({ allowRead: true, [key]: residue }).success).toBe(true);
      for (const other of [true, 'false', 0, null, '']) {
        const refused = ObjectPermissionSchema.safeParse({ allowRead: true, [key]: other });
        expect(refused.success, `${key}: ${JSON.stringify(other)} must stay refused`).toBe(false);
      }
    });
  });

  describe('the finding', () => {
    it('LIT — fires on the residue, once per key, naming the site', () => {
      const findings = validateRetiredPermissionResidue(normalized({ allowRestore: false, allowPurge: false }));
      expect(findings.map((f) => f.rule)).toEqual([
        PERMISSION_RETIRED_LIFECYCLE_RESIDUE,
        PERMISSION_RETIRED_LIFECYCLE_RESIDUE,
      ]);
      expect(findings.map((f) => f.path)).toEqual([
        'permissions[0].objects.crm_ticket.allowRestore',
        'permissions[0].objects.crm_ticket.allowPurge',
      ]);
      expect(findings[0].where).toBe("permission set 'support_agent' · object 'crm_ticket'");
      expect(findings.every((f) => f.severity === 'warning')).toBe(true);
    });

    it('carries the retirement’s OWN prescription, not a second wording', () => {
      const [finding] = validateRetiredPermissionResidue(normalized({ allowRestore: false }));
      const fromSchema = String(
        (ObjectPermissionSchema as unknown as { shape: Record<string, { description?: string }> })
          .shape.allowRestore.description,
      ).replace(/^\[REMOVED\]\s*/, '');
      expect(finding.hint).toBe(fromSchema);
      // Anti-vacuity: an empty derivation would make the assertion above true
      // and the rule silent. The prescription's two load-bearing clauses.
      expect(finding.hint).toContain('Delete the key');
      expect(finding.hint).toContain('os migrate meta --from 17');
    });

    it('the prescription resolves for every key the rule knows about', () => {
      for (const [key] of RETIRED) {
        expect(retiredKeyPrescription(key), `no prescription resolved for ${key}`).not.toBeNull();
      }
      // The resolver is not a constant function: a key with no tombstone has none.
      expect(retiredKeyPrescription('allowTransfer')).not.toContain('was removed');
      expect(retiredKeyPrescription('allowTeleport')).toBeNull();
    });
  });

  describe('DARK controls — what must stay silent', () => {
    it('a clean permission set earns nothing', () => {
      expect(validateRetiredPermissionResidue(normalized({}))).toEqual([]);
    });

    it('COST DIRECTION — a live lifecycle bit set falsy is NOT residue', () => {
      // `allowTransfer` is the surviving lifecycle key (#3004, enforced). It is
      // the nearest miss in the shape: same family, same object, same `false`.
      // Flagging it would tell an author to delete an enforced grant.
      expect(validateRetiredPermissionResidue(normalized({ allowTransfer: false }))).toEqual([]);
      expect(validateRetiredPermissionResidue(normalized({ allowCreate: false, allowDelete: false }))).toEqual([]);
    });

    it('a non-residue VALUE is the tombstone’s business, not this rule’s', () => {
      // Each of these is refused at the parse with the prescription attached.
      for (const other of [true, 'false', 0, null]) {
        expect(
          validateRetiredPermissionResidue(normalized({ allowRestore: other })),
          `${JSON.stringify(other)} must not be double-reported`,
        ).toEqual([]);
      }
    });

    it('a fabricated key earns nothing', () => {
      expect(validateRetiredPermissionResidue(normalized({ allowTeleport: false }))).toEqual([]);
    });

    it('never throws on malformed input, and reports nothing about it', () => {
      for (const junk of [{}, { permissions: null }, { permissions: [null, 7] }, { permissions: [{ objects: 3 }] },
        { permissions: [{ objects: { a: null } }] }]) {
        expect(validateRetiredPermissionResidue(junk as AnyRec)).toEqual([]);
      }
    });
  });

  describe('wiring — the rule really runs, on every command', () => {
    it.each([...AUTHORING_COMMANDS])('os %s runs it', (command) => {
      expect(authoringRulesFor(command).map((r) => r.name)).toContain('validateRetiredPermissionResidue');
    });

    it('LIT — reaches an author through the registry runner on all three commands', () => {
      for (const command of AUTHORING_COMMANDS) {
        const findings = runAuthoringRules(command, {
          normalized: normalized({ allowRestore: false }),
          // The parsed tier CANNOT carry the evidence; handing it over proves
          // the entry reads `normalized` rather than falling back.
          parsed: normalized({}),
        }).filter((f) => f.rule === PERMISSION_RETIRED_LIFECYCLE_RESIDUE);
        expect(findings.map((f) => f.path), `os ${command}`).toEqual([
          'permissions[0].objects.crm_ticket.allowRestore',
        ]);
        expect(findings[0].severity).toBe('warning');
      }
    });

    it('DARK — the same runner is silent on a clean stack', () => {
      for (const command of AUTHORING_COMMANDS) {
        expect(
          runAuthoringRules(command, { normalized: normalized({}) })
            .filter((f) => f.rule === PERMISSION_RETIRED_LIFECYCLE_RESIDUE),
          `os ${command}`,
        ).toEqual([]);
      }
    });
  });
});
