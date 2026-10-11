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
  retiredKeyRemedy,
  validateRetiredPermissionResidue as validateRetiredPermissionResidueUnrecorded,
} from './validate-retired-permission-residue.js';
import { AUTHORING_COMMANDS, authoringRulesFor, runAuthoringRules } from './authoring-rules.js';
import { explainRule } from './rule-explanations.js';

// [#22161] Each finding is one verdict sentence; the reasoning it used to
// carry is `os explain permission-retired-lifecycle-residue`. Every direct
// call below records what it fired, and the last cases in this file hold each
// recorded verdict to one line of at most 200 characters — every firing
// variant this suite exercises, not a chosen few. Run the whole file: those
// cases read what the cases above fired.
const fired: Array<{ rule: string; message: string; hint: string }> = [];
const validateRetiredPermissionResidue: typeof validateRetiredPermissionResidueUnrecorded = (...args) => {
  const findings = validateRetiredPermissionResidueUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

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
      // [#22161] The `fix:` line is the prescription's remedy sentence, CUT
      // from it — never retyped — so it is a piece of the schema's own text.
      expect(finding.hint).toBe(retiredKeyRemedy(fromSchema));
      expect(fromSchema).toContain(finding.hint);
      // Anti-vacuity: an empty derivation would make the assertions above true
      // and the rule silent. The prescription's two load-bearing clauses, and
      // the remedy the `fix:` line keeps.
      expect(fromSchema).toContain('Delete the key');
      expect(fromSchema).toContain('os migrate meta --from 17');
      expect(finding.hint).toBe('Delete the key');
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

describe('[#22161] one-line verdicts — permission-retired-lifecycle-residue', () => {
  it('reads as one sentence', () => {
    const findings = validateRetiredPermissionResidue(normalized({ allowRestore: false }));
    expect(findings.map((f) => f.message)).toEqual([
      'sets `allowRestore: false`, the retired default of a key removed in @objectstack/spec 17, which the '
        + 'parse strips in silence, so this line grants nothing',
    ]);
  });

  it('`os explain` carries what the verdict no longer says', () => {
    const entry = explainRule(PERMISSION_RETIRED_LIFECYCLE_RESIDUE);
    expect(entry, 'no `os explain permission-retired-lifecycle-residue` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    // The residue table, the refusal of every other value and the
    // prescription's source are each held to the rule by the cases above.
    for (const fact of [
      '`allowRestore` and `allowPurge`',
      'ADR-0049',
      'retired default, `false`',
      'every other value is refused at the parse',
      '`definePermissionSet`',
      'ADR-0087 D2',
      'never on the load path',
      'before the parse',
      'read from the tombstone on `ObjectPermissionSchema`',
    ]) {
      expect(text, `explanation names ${fact}`).toContain(fact);
    }
    for (const [key, residue] of RETIRED) {
      expect(text, key).toContain(`\`${key}\``);
      expect(residue).toBe(false);
    }
  });

  it('every verdict the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === PERMISSION_RETIRED_LIFECYCLE_RESIDUE);
    // The coverage control first: both retired keys fired.
    expect(converted.some((f) => f.message.startsWith('sets `allowRestore: false`'))).toBe(true);
    expect(converted.some((f) => f.message.startsWith('sets `allowPurge: false`'))).toBe(true);
    for (const f of converted) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, `${f.rule}: ${f.message}`).toBeLessThanOrEqual(200);
    }
  });
});

// [#22161] Slice 11: the `fix:` line. The finding used to carry the whole
// retirement prescription (573 and 681 characters); it carries the remedy
// sentence, cut from it, and the explanation says what deleting the key leaves.
describe('[#22161] one-line fixes — permission-retired-lifecycle-residue', () => {
  it('every `fix:` line the cases in this file fired is one line of at most 200 characters', () => {
    const converted = fired.filter((f) => f.rule === PERMISSION_RETIRED_LIFECYCLE_RESIDUE);
    expect(converted.some((f) => f.message.startsWith('sets `allowRestore: false`'))).toBe(true);
    expect(converted.some((f) => f.message.startsWith('sets `allowPurge: false`'))).toBe(true);
    for (const f of converted) {
      expect(f.hint, f.rule).not.toContain('\n');
      expect(f.hint.length, `${f.rule}: ${f.hint}`).toBeLessThanOrEqual(200);
    }
  });

  it('retiredKeyRemedy cuts the "Delete the key" sentence, at its dash only past 200, and never invents', () => {
    expect(retiredKeyRemedy('`k` was removed. Delete the key — x. Run it.')).toBe('Delete the key — x');
    expect(retiredKeyRemedy(`\`k\` was removed. Delete the key — ${'x'.repeat(200)}. Run it.`)).toBe('Delete the key');
    // No remedy sentence: the prescription is returned whole, never replaced.
    expect(retiredKeyRemedy('`k` was removed.')).toBe('`k` was removed.');
  });

  it('`os explain` says what deleting the key leaves, and names no tracker id', () => {
    const text = explainRule(PERMISSION_RETIRED_LIFECYCLE_RESIDUE)!.paragraphs.join('\n');
    expect(text).toContain('stays denied fail-closed by the permission evaluator\'s destructive-operation backstop');
    expect(text).toContain('the M2 lifecycle initiative');
    expect(text).not.toMatch(/os migrate meta --from/);
    expect(text).not.toMatch(/#\d{3,}/);
  });
});
