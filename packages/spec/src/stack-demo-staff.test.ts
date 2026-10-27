// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25777 — an application declares the demo accounts its seed data is dealt to
 * (`demoStaff[]`), and the platform creates them on a development boot.
 *
 * ## The accept-set delta this file measures
 *
 * The top-level stack door has been strict since #8687, so before this change
 * `demoStaff` was an `unrecognized_keys` refusal. The delta is exactly: the
 * key is writable, each entry is strict from birth, and `defineStack` refuses
 * an entry that names a position or permission set the stack does not
 * declare, or that repeats another entry's name or address. The dark control
 * keeps "nothing else moved" honest: a neighbouring undeclared key still
 * refuses.
 *
 * ## Why the rejections assert `code` + `path` (or `code` + `status`)
 *
 * A bare throw assertion passes on an unrelated failure. Each schema refusal
 * names the Zod issue code and its path; each cross-reference refusal names the
 * ADR-0112 envelope's `code` and `status` and the finding it carries.
 */

import { describe, it, expect } from 'vitest';

import {
  ObjectStackDefinitionSchema,
  defineStack,
  composeStacks,
  COMPOSE_KEY_DISPOSITIONS,
  STACK_DEFINITION_KEYS,
} from './stack.zod';
import { DemoStaffSchema } from './system/demo-staff.zod';

const manifest = {
  id: 'com.example.legal',
  name: 'legal',
  version: '1.0.0',
  type: 'app' as const,
  namespace: 'legal',
};

/** A legal stack that declares one position and one permission set. */
const base = () => ({
  manifest,
  objects: [{ name: 'legal_matter', label: 'Matter', fields: { title: { type: 'text', label: 'Title' } } }],
  positions: [{ name: 'legal_counsel', label: 'Legal Counsel' }],
  permissions: [{ name: 'legal_counsel_access', label: 'Legal Counsel Access', objects: {} }],
});

const counsel = (n: number) => ({
  name: `Legal Counsel ${n}`,
  email: `counsel${n}@legal.example`,
  position: 'legal_counsel',
  permissionSets: ['legal_counsel_access'],
});

const parse = (raw: Record<string, unknown>) => ObjectStackDefinitionSchema.safeParse(raw);

/** Every issue of a failed parse as `code @ path`, for attributable assertions. */
const issuesOf = (verdict: ReturnType<typeof parse>): string[] =>
  verdict.success ? [] : verdict.error.issues.map((i) => `${i.code} @ ${i.path.map(String).join('.')}`);

type Envelope = Error & { code?: string; status?: number; issues?: readonly string[] };

/** The refusal `defineStack` raised, or undefined when it accepted. */
const refusalOf = (raw: Record<string, unknown>): Envelope | undefined => {
  try {
    defineStack(raw as never);
    return undefined;
  } catch (err) {
    return err as Envelope;
  }
};

// ─── GREEN ──────────────────────────────────────────────────────────

describe('accept — an application declares the people its seed data is dealt to', () => {
  it('accepts full entries and carries every field through the parse', () => {
    const verdict = parse({ ...base(), demoStaff: [counsel(1), { name: 'Paralegal', email: 'para@legal.example' }] });
    expect(issuesOf(verdict)).toEqual([]);
    expect(verdict.success && verdict.data.demoStaff).toEqual([
      counsel(1),
      { name: 'Paralegal', email: 'para@legal.example' },
    ]);
  });

  it('survives `defineStack` when every position and permission set it names is declared', () => {
    const stack = defineStack({ ...base(), demoStaff: [counsel(1), counsel(2)] } as never);
    expect(stack.demoStaff).toEqual([counsel(1), counsel(2)]);
  });

  it('accepts a name and a position declared by a package the stack composes', () => {
    const stack = defineStack({
      manifest,
      packages: [
        {
          manifest: {
            id: 'com.example.legal-roles',
            name: 'legal-roles',
            version: '1.0.0',
            type: 'app',
            positions: [{ name: 'legal_counsel', label: 'Legal Counsel' }],
          },
        },
      ],
      demoStaff: [{ name: 'Legal Counsel 1', email: 'counsel1@legal.example', position: 'legal_counsel' }],
    } as never);
    expect(stack.demoStaff).toHaveLength(1);
  });
});

// ─── RED — the entry is strict from birth ───────────────────────────

describe('refuse — a `demoStaff` entry is closed and complete', () => {
  it('refuses an undeclared key inside an entry, at the entry`s path', () => {
    const verdict = parse({ ...base(), demoStaff: [{ ...counsel(1), bogus: 1 }] });
    expect(verdict.success).toBe(false);
    expect(issuesOf(verdict)).toContain('unrecognized_keys @ demoStaff.0');
  });

  it('refuses a `password` with guidance instead of a distance guess — no credential is committed', () => {
    const verdict = DemoStaffSchema.safeParse({ ...counsel(1), password: 'hunter22' });
    expect(verdict.success).toBe(false);
    if (verdict.success) return;
    expect(verdict.error.issues.map((i) => i.message).join('\n')).toContain('development seed password');
  });

  it('refuses an entry with no name — a seed reference resolves by name', () => {
    const verdict = parse({ ...base(), demoStaff: [{ email: 'a@legal.example' }] });
    expect(issuesOf(verdict)).toContain('invalid_type @ demoStaff.0.name');
  });

  it('refuses an address that is not one', () => {
    const verdict = parse({ ...base(), demoStaff: [{ name: 'A', email: 'not-an-address' }] });
    expect(verdict.success).toBe(false);
    expect(issuesOf(verdict).some((i) => i.endsWith('@ demoStaff.0.email'))).toBe(true);
  });
});

describe('refuse — `defineStack` cross-checks every entry against the stack', () => {
  it('refuses a position the stack does not declare, with the ADR-0112 envelope', () => {
    const refused = refusalOf({ ...base(), demoStaff: [{ ...counsel(1), position: 'chief_counsel' }] });
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    expect(refused?.issues?.join('\n')).toContain(
      "Demo account 'Legal Counsel 1' (stack.demoStaff[0]) is assigned position 'chief_counsel'",
    );
  });

  it('refuses a permission set the stack does not declare — a platform set is never one', () => {
    const refused = refusalOf({ ...base(), demoStaff: [{ ...counsel(1), permissionSets: ['admin_full_access'] }] });
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    expect(refused?.issues?.join('\n')).toContain("is granted permission set 'admin_full_access'");
  });

  it('refuses two entries with one name — a seed reference would resolve to either', () => {
    const refused = refusalOf({ ...base(), demoStaff: [counsel(1), { ...counsel(2), name: 'Legal Counsel 1' }] });
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    expect(refused?.issues?.join('\n')).toContain("Demo account name 'Legal Counsel 1' is declared twice");
  });

  it('refuses two entries with one address, compared without regard to case', () => {
    const refused = refusalOf({
      ...base(),
      demoStaff: [counsel(1), { ...counsel(2), email: 'COUNSEL1@legal.example' }],
    });
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    expect(refused?.issues?.join('\n')).toContain("Demo account address 'counsel1@legal.example' is declared twice");
  });
});

// ─── MANAGER — an entry names its line manager by address ─────────

describe('manager — an entry names another entry of the same list by its email', () => {
  const lead = { name: 'Legal Lead', email: 'lead@legal.example', position: 'legal_counsel' };

  it('accepts a manager declared after the entry, compared without regard to case', () => {
    const stack = defineStack({
      ...base(),
      demoStaff: [{ ...counsel(1), manager: 'LEAD@legal.example' }, { ...counsel(2), manager: lead.email }, lead],
    } as never);
    expect(stack.demoStaff?.map((entry) => entry.manager)).toEqual(['LEAD@legal.example', lead.email, undefined]);
  });

  it('accepts a chain several levels deep that reaches someone with no manager', () => {
    const verdict = refusalOf({
      ...base(),
      demoStaff: [
        { ...counsel(1), manager: counsel(2).email },
        { ...counsel(2), manager: counsel(3).email },
        { ...counsel(3), manager: lead.email },
        lead,
      ],
    });
    expect(verdict).toBeUndefined();
  });

  it('refuses a manager named by display name, at the entry`s path, saying it takes an address', () => {
    const verdict = parse({ ...base(), demoStaff: [{ ...counsel(1), manager: 'Legal Lead' }, lead] });
    expect(issuesOf(verdict).some((i) => i.endsWith('@ demoStaff.0.manager'))).toBe(true);
    if (verdict.success) return;
    expect(verdict.error.issues.find((i) => i.path.join('.') === 'demoStaff.0.manager')?.message).toContain(
      'named by the email of another demoStaff entry',
    );
  });

  it('refuses `reportsTo` and `managerEmail` with the canonical key, not a distance guess', () => {
    for (const key of ['reportsTo', 'managerEmail']) {
      const verdict = DemoStaffSchema.safeParse({ ...counsel(1), [key]: lead.email });
      expect(verdict.success, `'${key}' must refuse`).toBe(false);
      if (verdict.success) continue;
      expect(verdict.error.issues.map((i) => i.message).join('\n'), key).toContain('manager');
    }
  });

  it('refuses a manager that names no entry, with the ADR-0112 envelope', () => {
    const refused = refusalOf({ ...base(), demoStaff: [{ ...counsel(1), manager: 'nobody@legal.example' }, lead] });
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    expect(refused?.issues?.join('\n')).toContain(
      "Demo account 'Legal Counsel 1' (stack.demoStaff[0]) names manager 'nobody@legal.example', which is the " +
        'address of no demoStaff entry.',
    );
  });

  it('refuses an entry that names itself — compared without regard to case', () => {
    const refused = refusalOf({ ...base(), demoStaff: [{ ...counsel(1), manager: 'Counsel1@Legal.example' }] });
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    expect(refused?.issues?.join('\n')).toContain(
      "Demo account 'Legal Counsel 1' (stack.demoStaff[0]) names itself as its manager",
    );
  });

  it('refuses a two-entry loop, once, naming both entries', () => {
    const refused = refusalOf({
      ...base(),
      demoStaff: [{ ...counsel(1), manager: counsel(2).email }, { ...counsel(2), manager: counsel(1).email }],
    });
    expect(refused?.code).toBe('STACK_CROSS_REFERENCE_INVALID');
    expect(refused?.status).toBe(422);
    const loops = (refused?.issues ?? []).filter((i) => i.includes('form a loop'));
    expect(loops).toHaveLength(1);
    expect(loops[0]).toContain("'Legal Counsel 1' → 'Legal Counsel 2' → 'Legal Counsel 1'");
    expect(loops[0]).toContain('stack.demoStaff[0] and stack.demoStaff[1]');
  });

  it('refuses a loop that an entry outside it hangs from, naming only the loop', () => {
    const refused = refusalOf({
      ...base(),
      demoStaff: [
        { ...counsel(1), manager: counsel(2).email },
        { ...counsel(2), manager: counsel(3).email },
        { ...counsel(3), manager: lead.email },
        { ...lead, manager: counsel(2).email },
      ],
    });
    const loops = (refused?.issues ?? []).filter((i) => i.includes('form a loop'));
    expect(loops).toHaveLength(1);
    expect(loops[0]).toContain("'Legal Counsel 2' → 'Legal Counsel 3' → 'Legal Lead' → 'Legal Counsel 2'");
    expect(loops[0]).not.toContain('stack.demoStaff[0]');
  });
});

// ─── DARK CONTROL ───────────────────────────────────────────────────

describe('control — one key was declared, the door did not open', () => {
  it('a neighbouring undeclared key still refuses', () => {
    for (const key of ['demoStaf', 'demoUsers', 'demo']) {
      const verdict = parse({ ...base(), [key]: [] });
      expect(verdict.success, `'${key}' must still refuse`).toBe(false);
      expect(issuesOf(verdict), `'${key}' must raise unrecognized_keys`).toContain('unrecognized_keys @ ');
    }
  });

  it('is a declared top-level key that concatenates', () => {
    // That it is an artifact ENVELOPE key — refused inside `packages[].manifest`
    // — is pinned with its siblings by `assembled-package-body.test.ts`.
    expect(STACK_DEFINITION_KEYS).toContain('demoStaff');
    expect(COMPOSE_KEY_DISPOSITIONS.demoStaff).toBe('concat');
  });
});

// ─── COMPOSITION ────────────────────────────────────────────────────

describe('compose — every publisher`s demo accounts survive', () => {
  it('concatenates entries in stack order', () => {
    const a = defineStack({ ...base(), demoStaff: [counsel(1)] } as never);
    const b = defineStack({
      ...base(),
      manifest: { ...manifest, id: 'com.example.legal2', name: 'legal2', namespace: 'legal2' },
      positions: [{ name: 'legal_partner', label: 'Partner' }],
      permissions: [{ name: 'legal_partner_access', label: 'Partner Access', objects: {} }],
      objects: [{ name: 'legal2_case', label: 'Case', fields: { title: { type: 'text', label: 'Title' } } }],
      demoStaff: [{ name: 'Partner 1', email: 'partner1@legal.example', position: 'legal_partner' }],
    } as never);
    expect(composeStacks([a, b]).demoStaff).toEqual([
      counsel(1),
      { name: 'Partner 1', email: 'partner1@legal.example', position: 'legal_partner' },
    ]);
  });
});
