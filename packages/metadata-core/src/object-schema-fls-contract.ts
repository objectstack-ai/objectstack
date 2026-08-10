// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 / #3682] The metadata-plane FLS contract, as ONE case table every
 * schema-serving exit is driven through.
 *
 * ## Why this is shared rather than per-suite
 *
 * ADR-0106 D5 states the invariant negatively — "every schema-serving outlet,
 * or the mask is decoration" — and the exits it names live in two packages and
 * six code paths: `@objectstack/rest`'s single cached read, single uncached
 * read, layered read, compound-name read and list read, plus
 * `@objectstack/runtime`'s `/metadata` catch-all (protocol-backed,
 * registry-backed, last-ditch, list, and the legacy one-segment spelling).
 * A per-suite table would let a new exit ship with no coverage and nothing
 * would go red; driving them all from this one means a forgotten exit fails
 * **by name**.
 *
 * The invariant itself is one sentence: for a restricted caller, an unreadable
 * field is COMPLETELY ABSENT from every exit — no third, quieter answer (not a
 * name with the details stripped, not a `null`, not a 200 with empty `fields`).
 *
 * Same shape, and the same reason, as `contract-suite.ts` next door: one
 * contract, several implementations, one table.
 */

/** The object schema every exit serves while the contract runs. */
export const FLS_CONTRACT_OBJECT = {
    name: 'account',
    label: 'Account',
    fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        // Everything ADR-0106's Context section names as leaking with the field:
        // a sensitive enumeration, the capability guarding it, and a formula
        // that is itself business IP.
        salary_grade: {
            type: 'select',
            label: 'Salary Grade',
            options: [{ value: 'band_a', label: 'Band A' }, { value: 'band_b', label: 'Band B' }],
            requiredPermissions: ['view_compensation'],
        },
        bonus_formula: {
            type: 'formula',
            label: 'Bonus',
            formula: 'salary_grade == "band_a" ? 0.2 : 0.1',
            visibleWhen: 'record.status == "active"',
        },
    },
} as const;

/** Every field name {@link FLS_CONTRACT_OBJECT} declares. */
export const FLS_CONTRACT_ALL_FIELDS = ['id', 'name', 'salary_grade', 'bonus_formula'] as const;

/** What the exit's `security` double answers, or that it throws. */
export type FlsContractReadable = readonly string[] | undefined | 'throw';

/** The one verdict every exit must reach for a case. */
export type FlsContractVerdict =
    /** These field names are present; those are COMPLETELY absent. */
    | { kind: 'fields'; present: readonly string[]; absent: readonly string[] }
    /** Every declared field survives — the passthrough tiers (D4 exemptions, D6 tier 1/2, D8). */
    | { kind: 'unmasked' }
    /** D6 tier 3 — the exit refuses: 5xx, no body carrying `fields`. */
    | { kind: 'fault' };

export interface ObjectSchemaMaskCase {
    /** Stable id — this is what a forgotten exit fails by. */
    readonly id: string;
    /** Why this row exists, in the ADR's terms. */
    readonly why: string;
    /** The caller's execution context, as the exit resolves it. */
    readonly context: Record<string, unknown>;
    /** What `security.getMetadataReadableFields` answers for `account`. */
    readonly readable: FlsContractReadable;
    /** ADR-0106 D8 — masking off for this deployment. */
    readonly maskingDisabled?: boolean;
    readonly expect: FlsContractVerdict;
}

/**
 * The ADR-0106 case table.
 *
 * Ordered by tier, not by convenience: the projection first, then the three D6
 * failure postures, then the D4 exemptions, then the D7 and D8 knobs.
 */
export const OBJECT_SCHEMA_MASK_CASES: readonly ObjectSchemaMaskCase[] = [
    {
        id: 'restricted-caller/field-vanishes-whole',
        why: 'D1 — an unreadable field is removed whole: name, label, type, options, formula, visibleWhen and requiredPermissions all go with it.',
        context: { userId: 'u_portal', systemPermissions: [] },
        readable: ['id', 'name'],
        expect: { kind: 'fields', present: ['id', 'name'], absent: ['salary_grade', 'bonus_formula'] },
    },
    {
        id: 'restricted-caller/required-permissions-cause',
        why: 'D1 — the two causes of unreadability (an explicit `readable:false` and a missing `requiredPermissions` capability) are already folded together by `getReadableFields`, so an exit sees one answer and must not distinguish them.',
        context: { userId: 'u_portal', systemPermissions: [] },
        readable: ['id', 'name', 'bonus_formula'],
        expect: { kind: 'fields', present: ['id', 'name', 'bonus_formula'], absent: ['salary_grade'] },
    },
    {
        id: 'unrestricted-caller/byte-identical',
        why: 'D3 — a caller who denies nothing gets the pre-ADR response: every field, no fingerprint, no ETag change.',
        context: { userId: 'u_staff', systemPermissions: [] },
        readable: [...FLS_CONTRACT_ALL_FIELDS],
        expect: { kind: 'unmasked' },
    },
    {
        id: 'no-security-service/tier-1',
        why: 'D6 tier 1 — the deployment has no FLS posture at all; the data plane does not mask either, so tightening the metadata plane alone would be theater.',
        context: { userId: 'u_staff', systemPermissions: [] },
        readable: undefined,
        expect: { kind: 'unmasked' },
    },
    {
        id: 'undetermined/tier-2',
        why: 'D6 tier 2 — the field universe is unresolvable (registry hydration). Serve unmasked rather than brick every render of the object, but loudly and without a shared validator.',
        context: { userId: 'u_staff', systemPermissions: [] },
        readable: undefined,
        expect: { kind: 'unmasked' },
    },
    {
        id: 'evaluation-throws/tier-3',
        why: 'D6 tier 3 — an unhealthy security service must not auto-open a disclosure hole. The exit refuses; it never falls back to the cached full body.',
        context: { userId: 'u_portal', systemPermissions: [] },
        readable: 'throw',
        expect: { kind: 'fault' },
    },
    {
        id: 'empty-readable-set/no-empty-fields-200',
        why: 'D6 — `getReadableFields` answers `[]` only where its own posture read failed closed (#3545). An empty-fields 200 is "silently wrong UI AND cacheable poison", so the exit refuses instead.',
        context: { userId: 'u_portal', systemPermissions: [] },
        readable: [],
        expect: { kind: 'fault' },
    },
    {
        id: 'is-system/exempt',
        why: 'D4 — `isSystem` bypasses, and the exemption is a CALLER property: it short-circuits before the security service is consulted at all.',
        context: { isSystem: true },
        readable: ['id'],
        expect: { kind: 'unmasked' },
    },
    {
        id: 'platform-admin/exempt',
        why: 'D4 — Studio/Setup authoring needs the full schema; judged by the same `systemPermissions` reading the `app` filter uses.',
        context: { userId: 'u_admin', systemPermissions: ['studio.access'] },
        readable: ['id'],
        expect: { kind: 'unmasked' },
    },
    {
        id: 'write-capable-caller/exempt',
        why: '[#7020] D4 is DERIVED from the #6603 write gate — whoever may write a schema sees all of it, by construction. A `manage_metadata`-only caller passes every write gate, so a projected GET here is the round trip that PUTs the invisible fields away. Holds NEITHER builder capability on purpose: that is the shape the two hand-kept sets used to separate.',
        context: { userId: 'u_author', systemPermissions: ['manage_metadata'] },
        readable: ['id'],
        expect: { kind: 'unmasked' },
    },
    {
        id: 'guest-fallback/D7',
        why: 'D7 — a caller resolving to zero permission sets goes through the fallback set rather than the everything-default; the exit sees whatever that resolution answers and projects it like any other. (The resolution itself is pinned in plugin-security; a truly ANONYMOUS caller never reaches an exit on a requireAuth deployment, which D7 says in as many words.)',
        context: { userId: 'u_guest', positions: [], permissions: [], systemPermissions: [] },
        readable: ['id', 'name'],
        expect: { kind: 'fields', present: ['id', 'name'], absent: ['salary_grade', 'bonus_formula'] },
    },
    {
        id: 'masking-disabled/D8',
        why: 'D8 — the escape hatch opts a deployment out of the metadata-plane mask entirely; the security service is not consulted.',
        context: { userId: 'u_portal', systemPermissions: [] },
        readable: ['id'],
        maskingDisabled: true,
        expect: { kind: 'unmasked' },
    },
];

/** What an exit answered when the contract drove it. */
export type ObjectSchemaMaskOutcome =
    | { kind: 'document'; document: unknown }
    | { kind: 'fault'; status: number };

/** One schema-serving outlet under test. */
export interface ObjectSchemaMaskExit {
    /** Human name — this is what a broken exit is reported as. */
    readonly name: string;
    /** Serve {@link FLS_CONTRACT_OBJECT} through this outlet under `testCase`. */
    run(testCase: ObjectSchemaMaskCase): Promise<ObjectSchemaMaskOutcome>;
}

/** Pull the served `fields` record out of whatever envelope an outlet answers. */
function servedFields(document: unknown): Record<string, unknown> | undefined {
    if (!document || typeof document !== 'object') return undefined;
    const rec = document as Record<string, unknown>;
    const fields = rec.fields;
    if (fields && typeof fields === 'object' && !Array.isArray(fields)) return fields as Record<string, unknown>;
    return undefined;
}

/**
 * Assert one exit's answer against one case.
 *
 * Framework-free on purpose (throws plain `Error`s) so the table can be driven
 * from a vitest suite in either package without this module importing vitest —
 * `contract-suite.ts` pays that import cost because it *is* a suite; this is a
 * matcher.
 */
export function assertObjectSchemaMaskCase(
    exitName: string,
    testCase: ObjectSchemaMaskCase,
    outcome: ObjectSchemaMaskOutcome,
): void {
    const where = `${exitName} :: ${testCase.id}`;
    if (testCase.expect.kind === 'fault') {
        if (outcome.kind !== 'fault') {
            throw new Error(
                `${where}: expected the exit to REFUSE (5xx) but it served a body. ${testCase.why}`,
            );
        }
        if (outcome.status < 500) {
            throw new Error(`${where}: expected a 5xx refusal, got ${outcome.status}. ${testCase.why}`);
        }
        return;
    }

    if (outcome.kind === 'fault') {
        throw new Error(`${where}: expected a served body, got a ${outcome.status} refusal. ${testCase.why}`);
    }
    const fields = servedFields(outcome.document);
    if (!fields) {
        throw new Error(`${where}: the served body carries no \`fields\` record — ${JSON.stringify(outcome.document)}`);
    }

    const expected = testCase.expect.kind === 'unmasked'
        ? { present: [...FLS_CONTRACT_ALL_FIELDS], absent: [] as readonly string[] }
        : testCase.expect;

    for (const name of expected.present) {
        if (!(name in fields)) {
            throw new Error(`${where}: expected field '${name}' to be served, it was not. ${testCase.why}`);
        }
    }
    for (const name of expected.absent) {
        if (name in fields) {
            throw new Error(
                `${where}: field '${name}' must be COMPLETELY ABSENT for this caller, but the exit served it. ${testCase.why}`,
            );
        }
        // The whole-field rule: no residue anywhere in the serialized document.
        // A partial redaction (a name kept, the details stripped) still leaks
        // existence, which D1 rules out in as many words.
        if (JSON.stringify(outcome.document).includes(`"${name}"`)) {
            throw new Error(
                `${where}: '${name}' is gone from \`fields\` but still appears elsewhere in the served document — D1 removes the field WHOLE.`,
            );
        }
    }
}

/**
 * The `security` service double a case implies.
 *
 * Registers `getMetadataReadableFields` (ADR-0106 D7's entry point) AND
 * `getReadableFields` at the same answer, so an exit that feature-detects
 * either one is driven identically — the fallback path is exercised by the
 * dedicated plugin-security suite, not by making outlets disagree here.
 * Returns `undefined` for the no-service tier so the caller can register
 * nothing at all.
 */
export function securityDoubleFor(testCase: ObjectSchemaMaskCase): Record<string, unknown> | undefined {
    if (testCase.id === 'no-security-service/tier-1') return undefined;
    const answer = () => {
        if (testCase.readable === 'throw') throw new Error('security service unhealthy (test)');
        return testCase.readable === undefined ? undefined : [...testCase.readable];
    };
    return {
        getReadableFields: async () => answer(),
        getMetadataReadableFields: async () => answer(),
    };
}
