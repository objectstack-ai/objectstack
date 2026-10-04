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

/**
 * The object schema every exit serves while the contract runs.
 *
 * Besides the four fields, it names them in every KIND of position an object
 * document has outside `fields` (ADR-0106 D1 removes a field WHOLE, so a
 * reference is part of the field): a rule entry whose condition reads one, a
 * rule entry that names one only through its `fields` pointer list, role
 * pointers, name lists, an expression, a field-group predicate, an index,
 * list views (a column list, a filter, a view KEYED by a field's name, an
 * object-form column naming one through its nested `prefix` / `summary`),
 * actions (a visibility predicate) — and, inside the READABLE fields, a name
 * list, a `dependsOn`, a predicate, a formula `expression` and an inline grid
 * (`inlineColumns` by name and by computed `expr`, `inlineAmountField`) that
 * read a sibling. The inline grid sits on `name` only so that a field every
 * restricted case can read carries it — the mask does not read `type`, and a
 * fifth field would change the field set every exit's suite counts. Each
 * position also carries a reference to a
 * field EVERY restricted case can read, so an over-eager mask that deletes the
 * position wholesale fails the `retained` half of the case.
 */
export const FLS_CONTRACT_OBJECT = {
    name: 'account',
    label: 'Account',
    nameField: 'name',
    stageField: 'salary_grade',
    titleFormat: '{name} ({salary_grade})',
    highlightFields: ['name', 'salary_grade', 'bonus_formula'],
    searchableFields: ['name', 'salary_grade'],
    fieldGroups: [
        { key: 'compensation', label: 'Compensation', visibleWhen: 'record.salary_grade != null' },
        { key: 'general', label: 'General', visibleWhen: 'record.name != null' },
    ],
    indexes: [
        { fields: ['salary_grade', 'name'] },
        { fields: ['name'] },
    ],
    validations: [
        {
            type: 'script',
            name: 'graded_account_needs_name',
            condition: { dialect: 'cel', source: 'record.salary_grade != null && record.name == null' },
            message: 'A graded account needs a name.',
        },
        {
            type: 'cross_field',
            name: 'bonus_needs_name',
            fields: ['bonus_formula', 'name'],
            condition: 'record.name == null',
            message: 'A bonus needs a name.',
        },
        {
            type: 'script',
            name: 'name_not_blank',
            condition: 'record.name == ""',
            message: 'Name must not be blank.',
        },
    ],
    listViews: {
        all: { label: 'All', type: 'grid', columns: ['name', 'salary_grade'] },
        graded: { label: 'Graded', type: 'grid', columns: ['name'], filter: [{ field: 'salary_grade', operator: 'is_not_null' }] },
        salary_grade: { label: 'By grade', type: 'grid', columns: ['name'] },
        // Object-form columns: a column's nested pointers (`prefix.field`,
        // `summary.field`) name fields of THIS object as surely as its `field`.
        compact: {
            label: 'Compact',
            type: 'grid',
            columns: [
                { field: 'name', width: 200 },
                { field: 'name', prefix: { field: 'salary_grade', type: 'badge' } },
                { field: 'id', summary: { type: 'sum', field: 'bonus_formula' } },
            ],
        },
    },
    actions: [
        { name: 'regrade', label: 'Regrade', type: 'script', visible: 'record.salary_grade != null' },
        { name: 'rename', label: 'Rename', type: 'script', visible: 'record.name != null' },
    ],
    fields: {
        id: { type: 'text', label: 'Id' },
        name: {
            type: 'text',
            label: 'Name',
            relatedListColumns: ['name', 'salary_grade'],
            dependsOn: ['id', 'salary_grade'],
            readonlyWhen: 'record.bonus_formula != null',
            requiredWhen: 'record.id != null',
            inlineColumns: [
                { name: 'id' },
                { name: 'salary_grade', label: 'Grade' },
                { name: 'name', label: 'Name', readonlyWhen: 'record.salary_grade != null' },
                { name: 'id', label: 'Bonus x2', computed: true, expr: 'bonus_formula * 2' },
            ],
            inlineAmountField: 'bonus_formula',
        },
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
            expression: 'salary_grade == "band_a" ? 0.2 : 0.1',
            visibleWhen: 'record.status == "active"',
        },
    },
} as const;

/** Every field name {@link FLS_CONTRACT_OBJECT} declares. */
export const FLS_CONTRACT_ALL_FIELDS = ['id', 'name', 'salary_grade', 'bonus_formula'] as const;

/** What the exit's `security` double answers, or that it throws. */
export type FlsContractReadable = readonly string[] | undefined | 'throw';

/**
 * One thing a masked document must STILL say — the control half of a
 * projection case. Without it a mask that deleted every position wholesale
 * (all validations, every pointer) would pass the absence checks while serving
 * a schema stripped of everything the caller IS entitled to.
 */
export interface FlsContractRetention {
    /** What is kept, in words — this is what a failure names. */
    readonly what: string;
    /** Holds on the served document. */
    readonly holds: (document: any) => boolean;
}

/** Names of the validation rules a served document carries. */
const ruleNames = (document: any): string[] => (Array.isArray(document?.validations)
    ? document.validations.map((rule: any) => rule?.name)
    : []);

const sameList = (actual: unknown, expected: readonly unknown[] | Readonly<Record<string, unknown>>): boolean =>
    JSON.stringify(actual) === JSON.stringify(expected);

/**
 * What a caller who reads `id` and `name` only is still served: every
 * reference to those two survives, every position keeps its non-denied part.
 */
const RETAINED_FOR_ID_AND_NAME: readonly FlsContractRetention[] = [
    { what: 'the `nameField` pointer to a readable field', holds: (d) => d?.nameField === 'name' },
    { what: 'the validation rule over readable fields only', holds: (d) => sameList(ruleNames(d), ['name_not_blank']) },
    { what: '`highlightFields`, minus the denied entries', holds: (d) => sameList(d?.highlightFields, ['name']) },
    { what: '`searchableFields`, minus the denied entry', holds: (d) => sameList(d?.searchableFields, ['name']) },
    { what: 'the index over readable fields only', holds: (d) => sameList(d?.indexes, [{ fields: ['name'] }]) },
    {
        what: 'both field groups, and the predicate that reads a readable field',
        holds: (d) => sameList(d?.fieldGroups?.map((g: any) => g?.key), ['compensation', 'general'])
            && d?.fieldGroups?.[1]?.visibleWhen === 'record.name != null',
    },
    {
        what: 'the readable field\'s own name lists, minus the denied entries',
        holds: (d) => sameList(d?.fields?.name?.relatedListColumns, ['name'])
            && sameList(d?.fields?.name?.dependsOn, ['id']),
    },
    { what: 'the readable field\'s predicate over a readable sibling', holds: (d) => d?.fields?.name?.requiredWhen === 'record.id != null' },
    {
        what: 'the inline grid\'s readable columns, minus a predicate over the denied field',
        holds: (d) => sameList(d?.fields?.name?.inlineColumns, [{ name: 'id' }, { name: 'name', label: 'Name' }]),
    },
    {
        what: 'the list views over readable fields, minus the denied columns — object-form columns included',
        holds: (d) => sameList(d?.listViews, {
            all: { label: 'All', type: 'grid', columns: ['name'] },
            compact: { label: 'Compact', type: 'grid', columns: [{ field: 'name', width: 200 }] },
        }),
    },
    { what: 'the action whose predicate reads a readable field', holds: (d) => sameList(d?.actions?.map((a: any) => a?.name), ['rename']) },
];

/**
 * What a caller who reads everything but `salary_grade` is still served —
 * including the readable formula field, minus only the formula that reads the
 * denied one.
 */
const RETAINED_WITH_BONUS_READABLE: readonly FlsContractRetention[] = [
    {
        what: 'the validation rules that do not read the denied field',
        holds: (d) => sameList(ruleNames(d), ['bonus_needs_name', 'name_not_blank']),
    },
    { what: '`highlightFields`, minus the denied entry', holds: (d) => sameList(d?.highlightFields, ['name', 'bonus_formula']) },
    { what: 'the readable field\'s predicate over a readable sibling', holds: (d) => d?.fields?.name?.readonlyWhen === 'record.bonus_formula != null' },
    {
        what: 'the readable formula field, minus its formula — its other facets stay',
        holds: (d) => d?.fields?.bonus_formula?.label === 'Bonus'
            && d?.fields?.bonus_formula?.visibleWhen === 'record.status == "active"'
            && !('expression' in (d?.fields?.bonus_formula ?? {})),
    },
    {
        what: 'the object-form column aggregating the readable formula field, minus the one prefixed by the denied field',
        holds: (d) => sameList(d?.listViews?.compact?.columns, [
            { field: 'name', width: 200 },
            { field: 'id', summary: { type: 'sum', field: 'bonus_formula' } },
        ]),
    },
    {
        what: 'the inline grid\'s column computed from the readable formula field, and its amount field',
        holds: (d) => d?.fields?.name?.inlineColumns?.length === 3
            && d?.fields?.name?.inlineColumns?.[2]?.expr === 'bonus_formula * 2'
            && d?.fields?.name?.inlineAmountField === 'bonus_formula',
    },
];

/** An unmasked answer is the whole fixture — every reference in every position. */
const RETAINED_UNMASKED: readonly FlsContractRetention[] = [
    { what: 'every validation rule', holds: (d) => ruleNames(d).length === 3 },
    { what: 'every role pointer', holds: (d) => d?.nameField === 'name' && d?.stageField === 'salary_grade' },
    { what: 'every name-list entry', holds: (d) => d?.highlightFields?.length === 3 && d?.indexes?.length === 2 },
    { what: 'the formula', holds: (d) => typeof d?.fields?.bonus_formula?.expression === 'string' },
    {
        what: 'every inline-grid column, every list view and every action',
        holds: (d) => d?.fields?.name?.inlineColumns?.length === 4
            && Object.keys(d?.listViews ?? {}).length === 4 && d?.listViews?.compact?.columns?.length === 3
            && d?.actions?.length === 2,
    },
];

/** The one verdict every exit must reach for a case. */
export type FlsContractVerdict =
    /**
     * These field names are present; those are COMPLETELY absent — from
     * `fields` AND from every other position, expressions included — and the
     * `retained` facts still hold.
     */
    | { kind: 'fields'; present: readonly string[]; absent: readonly string[]; retained?: readonly FlsContractRetention[] }
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
        why: 'D1 — an unreadable field is removed whole: name, label, type, options, formula, visibleWhen and requiredPermissions all go with it, and so does every reference to it elsewhere in the document — the rules that read it, the pointers and lists that name it, the readable fields\' predicates over it.',
        context: { userId: 'u_portal', systemPermissions: [] },
        readable: ['id', 'name'],
        expect: { kind: 'fields', present: ['id', 'name'], absent: ['salary_grade', 'bonus_formula'], retained: RETAINED_FOR_ID_AND_NAME },
    },
    {
        id: 'restricted-caller/required-permissions-cause',
        why: 'D1 — the two causes of unreadability (an explicit `readable:false` and a missing `requiredPermissions` capability) are already folded together by `getReadableFields`, so an exit sees one answer and must not distinguish them. The READABLE formula field stays, but not the formula that reads the denied one.',
        context: { userId: 'u_portal', systemPermissions: [] },
        readable: ['id', 'name', 'bonus_formula'],
        expect: { kind: 'fields', present: ['id', 'name', 'bonus_formula'], absent: ['salary_grade'], retained: RETAINED_WITH_BONUS_READABLE },
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
        why: 'D6 — `getReadableFields` answers `[]` only where its own posture read failed closed. An empty-fields 200 is "silently wrong UI AND cacheable poison", so the exit refuses instead.',
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
        why: 'D4 is DERIVED from the schema write gate (`manage_metadata`) — whoever may write a schema sees all of it, by construction. A `manage_metadata`-only caller passes every write gate, so a projected GET here is the round trip that PUTs the invisible fields away. Holds NEITHER builder capability on purpose: that is the shape the two hand-kept sets used to separate.',
        context: { userId: 'u_author', systemPermissions: ['manage_metadata'] },
        readable: ['id'],
        expect: { kind: 'unmasked' },
    },
    {
        id: 'guest-fallback/D7',
        why: 'D7 — a caller resolving to zero permission sets goes through the fallback set rather than the everything-default; the exit sees whatever that resolution answers and projects it like any other. (The resolution itself is pinned in plugin-security; a truly ANONYMOUS caller never reaches an exit on a requireAuth deployment, which D7 says in as many words.)',
        context: { userId: 'u_guest', positions: [], permissions: [], systemPermissions: [] },
        readable: ['id', 'name'],
        expect: { kind: 'fields', present: ['id', 'name'], absent: ['salary_grade', 'bonus_formula'], retained: RETAINED_FOR_ID_AND_NAME },
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
        ? { present: [...FLS_CONTRACT_ALL_FIELDS], absent: [] as readonly string[], retained: RETAINED_UNMASKED }
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
        // The whole-field rule: no residue anywhere in the served document.
        // A partial redaction (a name kept, the details stripped) still leaks
        // existence, which D1 rules out in as many words — and so does a
        // REFERENCE: a rule whose condition reads the field, a formula over it,
        // a pointer naming it. Judged by identifier token, so a name embedded
        // in an expression (`record.<name> > 0`) is caught, not only a quoted one.
        const residue = findIdentifierResidue(outcome.document, name);
        if (residue) {
            throw new Error(
                `${where}: '${name}' is gone from \`fields\` but is still referenced at ${residue} — D1 removes the field WHOLE.`,
            );
        }
    }
    for (const fact of expected.retained ?? []) {
        if (!fact.holds(outcome.document)) {
            throw new Error(
                `${where}: the mask over-reached — the served document no longer carries ${fact.what}. ${testCase.why}`,
            );
        }
    }
}

const IDENTIFIER_TOKEN = /[A-Za-z_][A-Za-z0-9_]*/g;

/**
 * Where `name` occurs as an identifier token — in any string leaf or object
 * key of `value` — as a dotted path, or `undefined` when it occurs nowhere.
 *
 * Deliberately independent of the mask's own reference detector: a matcher
 * that shared it would go blind exactly where the mask does.
 */
function findIdentifierResidue(value: unknown, name: string, path = '$'): string | undefined {
    const tokenIs = (text: string): boolean => (text.match(IDENTIFIER_TOKEN) ?? ([] as string[])).includes(name);
    if (typeof value === 'string') return tokenIs(value) ? path : undefined;
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const hit = findIdentifierResidue(value[i], name, `${path}[${i}]`);
            if (hit) return hit;
        }
        return undefined;
    }
    if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
            if (tokenIs(key)) return `${path}.${key} (key)`;
            const hit = findIdentifierResidue(inner, name, `${path}.${key}`);
            if (hit) return hit;
        }
    }
    return undefined;
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
