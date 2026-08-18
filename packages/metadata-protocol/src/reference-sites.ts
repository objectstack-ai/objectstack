// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DERIVED reference-site index — what may point at a metadata item, worked out
 * from the metadata type schemas instead of written down by hand (#9190).
 *
 * ## The defect this replaces
 *
 * `findReferencesToMeta` used to consult a hand-curated `REFERENCE_PATHS`
 * table: seven target keys, forty `fromType` + dotted-path tuples, maintained
 * by whoever last remembered to. The table drove the admin UI's "Used by"
 * panel, whose empty state reads — verbatim, `objectui`
 * `metadata-admin/i18n.ts` — *"Nothing in the metadata graph points at this
 * item. Safe to delete."* So an incomplete table is not a cosmetic gap; it is
 * a green light for a destructive action (ADR-0110 D3, the #8896 harm shape).
 *
 * It had drifted exactly as a hand-written list does. Measured against the
 * schemas on `origin/main` @ `739fe5b79`, **34 of the 40 curated paths did not
 * exist in the source type's own schema**:
 *
 *  - `app.navItems[]` / `app.tabs[]` — `AppSchema` declares `navigation[]` and
 *    `areas[].navigation[]`. Fourteen paths across six target types, dead. As
 *    those were the ONLY rows for `flow`, `dashboard` and `page`, all three
 *    were registry keys that answered `{ references: [] }` unconditionally —
 *    indistinguishable from a key that was never there;
 *  - `agent.tools[]` — the key was REMOVED in `@objectstack/spec` 17 (#3894);
 *    it converts to `{ not: {} }`, i.e. a refusal. Tools reach an agent through
 *    its skills (ADR-0064), so `tool` had no live row either;
 *  - `permission.objects[].name` — `PermissionSetSchema.objects` is a RECORD
 *    keyed by object name, not an array of `{ name }`;
 *  - `object.fields{}.referenceTo` — `FieldSchema` spells it `reference`;
 *  - `dashboard.widgets[].object` / `.view`, `page.viewName`, `view.objectName`,
 *    `flow.object` / `.context.object` / `.trigger.object` / `.targetObject` —
 *    none of these properties exist.
 *
 * Only SIX of the forty were live, reaching two target types (`object`,
 * `skill`). The endpoint advertised seven and answered for two. ⛔ Adding the
 * missing keys by hand reproduces the defect one generation later — #8908
 * measured a hand-written list of "four types" that shipped two members short.
 *
 * ## What is derived, and from what
 *
 * The one authority on which metadata types exist is
 * `DEFAULT_METADATA_TYPE_REGISTRY` (#8586: "the TOTAL universe of declared
 * metadata types"), and the one authority on an item's shape is
 * `getMetadataTypeSchema()`. This module joins them. Same shape #7894 used to
 * make the URL-spelling map non-recurring: a newly DECLARED type arrives
 * covered, because the walk reads its schema rather than a list someone has to
 * remember to extend.
 *
 * A property is a reference SITE for target `T` when BOTH hold:
 *
 *  1. **Its name spells `T`** — `T`, its camelCase form, `T + 'Name'`,
 *     `T + '_name'`, `'target' + Cap(T)`, or a plural of any of those. This is
 *     the same total, deliberately unclever rule `restPluralOfMetaType` uses
 *     one package over; ⛔ do NOT make it cleverer. A suffix rule (`endsWith
 *     Cap(T)`) was measured and REJECTED: it is ~15% signal. It reads
 *     `displayField`, `nameField`, `startDateField`, `stageField` and thirty
 *     more as references to the `field` METADATA TYPE when every one of them
 *     names a field inside an object, plus `fieldMapping`/`inputMapping` as
 *     `mapping` references and `tabPosition` as a `position` reference. A
 *     boundary that guesses is what #7894 and #4432 both refuse.
 *  2. **Its value is name-shaped** — an unconstrained `string`, an array or
 *     record of those, or objects carrying a `name`. The constraint half is
 *     load-bearing: `chartConfig.xAxis.position` is an `enum` of `'left' |
 *     'right'` and `flow.nodes[].position` is `{ x, y }`, so neither is read as
 *     a reference to a `position` item, while
 *     `permission.rowLevelSecurity[].positions[]` is.
 *
 * Three limbs feed the walk:
 *
 *  1. every declared type's own schema;
 *  2. `SCHEMALESS_NODE_CONFIG_SCHEMAS` attributed to `flow`. `FlowSchema`
 *     declares `nodes[].config` as `additionalProperties: {}` — wide open — so
 *     a flow's real references (`create_record` → object, `subflow` → flow)
 *     are invisible to limb 1 and reachable only through that separate
 *     registry;
 *  3. {@link SEMANTIC_REFERENCE_SITES}, the residue — read its header.
 *
 * ## What "no references" now means, and what it still cannot mean
 *
 * After derivation an empty answer is a DERIVED statement for every declared
 * type whose schema resolves: no declared source type carries a property that
 * names this type. That is a real answer, not a gap, and it is what collapses
 * the "no references" / "not computable" ambiguity the card names — without a
 * wire change, because the honest discriminator moved OFF the response and
 * INTO the build. {@link ReferenceSiteIndex.unwalkableSourceTypes} names every
 * declared type whose shape could not be read, and
 * `reference-sites.derivation.test.ts` pins that set, so a type that stops
 * being walkable is a red test rather than a silently shorter list.
 *
 * ⚠️ [#9327] That build-time discriminator covers the SOURCE side only, and the
 * distinction is load-bearing rather than pedantic. A source type that cannot
 * be read shortens some answers; a TARGET type whose key form no site can hold
 * makes EVERY answer for it empty, and moving that fact into the build leaves
 * the operator reading "Safe to delete." exactly as before. A build-time record
 * is the right home for a bounded gap and the wrong home for a total one, so
 * {@link ReferenceSiteIndex.unanswerableTargetTypes} is consumed as a REFUSAL
 * at the protocol seam (`findReferencesToMeta`) rather than merely recorded —
 * through the ADR-0112 error envelope the same route already refuses through
 * (#9326's `501 NOT_IMPLEMENTED`), so it adds no response field and no new
 * error code. The success-shape discriminator remains fenced to `packages/spec`
 * and is deliberately NOT what this uses.
 *
 * ⚠️ Two residues remain open and are NOT closed here — see this module's
 * card. Neither can be closed inside this package.
 *
 * @module
 */

import { z } from 'zod';
import { DEFAULT_METADATA_TYPE_REGISTRY, getMetadataTypeSchema } from '@objectstack/spec/kernel';
import { SCHEMALESS_NODE_CONFIG_SCHEMAS } from '@objectstack/spec/automation';

/**
 * One derived fact: an item of `fromType` may name a `target` item through a
 * property called `property`, wherever that property occurs in the document.
 *
 * Deliberately a PROPERTY and not a PATH. The hand-written table enumerated
 * fully-qualified paths, which is why it rotted: `AppSchema`'s navigation is
 * recursive (`navigation[].children[].children[]…`), so an exhaustive path list
 * is both unbounded and stale the moment a wrapper moves. The runtime walk
 * finds the property wherever it sits and reports the path it actually found it
 * at, so a nesting change cannot silently shorten the answer.
 */
export interface ReferenceSite {
    /** Metadata type of the item that may hold the reference. */
    readonly fromType: string;
    /** Property name that carries the target's name. */
    readonly property: string;
    /** Metadata type being referenced. */
    readonly target: string;
}

/** The derived index, plus the honest record of what could not be derived. */
export interface ReferenceSiteIndex {
    /** Target metadata type → every site that may point at it. */
    readonly byTarget: ReadonlyMap<string, readonly ReferenceSite[]>;
    /**
     * Declared types whose shape could NOT be read, so their references are
     * genuinely not computable rather than absent. Pinned by a test — see the
     * module header on why this lives here and not on the response.
     */
    readonly unwalkableSourceTypes: readonly string[];
    /**
     * Declared types that cannot be answered FOR as a target, because the key
     * the endpoint addresses them by is not a string any reference site can
     * hold. The SOURCE-side sibling above records a shape that could not be
     * read; this one records a shape that was read fine and still cannot
     * match. See {@link COMPOSITE_KEYED_TARGET_TYPES}.
     */
    readonly unanswerableTargetTypes: readonly string[];
}

/**
 * The RESIDUE: reference properties whose NAME does not spell their target, so
 * no naming rule can derive them.
 *
 * ⚠️ This map is hand-written and therefore, by #8908's measurement, incomplete
 * — that is a statement about the map, not an excuse for it. It exists for one
 * reason: dropping it would REGRESS the single highest-value edge in the graph
 * (which objects point at this object), which is one of the six curated paths
 * that were actually live. `FieldSchema.reference` is described as *"Target
 * object name (snake_case) for lookup/master_detail fields"* — the binding is
 * real, and it is stated in prose, which is not a machine-readable surface.
 *
 * ⛔ Do NOT grow this map to "improve coverage". Growing it IS the defect this
 * module exists to end. Other sites in the same class are already measured and
 * deliberately left out rather than curated in — `AppSchema.homePageId` names a
 * `page`, `AppSchema.defaultAgent` names an `agent` — precisely so that the
 * incompleteness stays visible instead of looking handled.
 *
 * The durable close is an annotation at the PRODUCER, so the binding is
 * declared where the property is declared and derivation reads it like any
 * other schema fact — the shape `flow-node-expression-paths.ts` already uses
 * for `.meta({ xExpression })`, and the "declared = enforced" side of ADR-0049.
 * That is a `packages/spec` change and is out of this card's scope by ruling.
 */
const SEMANTIC_REFERENCE_SITES: readonly ReferenceSite[] = [
    { fromType: 'object', property: 'reference', target: 'object' },
];

/**
 * The declared metadata-type universe, as a TYPE. Seeds below are keyed to it
 * so a member naming a type the registry does not declare is a compile error
 * rather than a row that silently never matches.
 */
type DeclaredMetadataType = (typeof DEFAULT_METADATA_TYPE_REGISTRY)[number]['type'];

/**
 * Target types whose ADDRESSABLE KEY is COMPOSITE — the string
 * `GET /api/v1/meta/:type/:name/references` is addressed by is built from more
 * than the item's own `name`, so it is not a value any reference site holds.
 *
 * ## Why this is a different fact from `unwalkableSourceTypes`
 *
 * The SOURCE-side record above is about a shape that could not be READ:
 * `external_catalog` resolves no schema, so nothing can be said about what it
 * points at. This set is the TARGET-side sibling and its cause is the
 * opposite — the shape reads perfectly. `field` is walked as a source, and
 * twelve derived sites across nine source types name it as a target. Every one
 * of them still misses, on every deployment, for every field, because the two
 * sides spell the same field differently:
 *
 *  - the ENDPOINT addresses a field item as `<object>.<field>` — the composite
 *    key `isNestedArtifactField` splits on its first dot (`account.owner`);
 *  - every SITE holds the bare field name (`owner`). Measured across the
 *    declared schemas: `view.list.columns[].field`, `dataset.dimensions[].field`,
 *    `object.validations[].field`, `object.fields{}` (a `z.record` keyed by the
 *    bare name), and 150 further non-recursive paths — all of them documented
 *    as *"Field name (snake_case)"*, none of them as a metadata item key.
 *
 * So the answer was `{ references: [] }` for every field, always, regardless of
 * real usage — and the admin "Used by" panel renders that empty case, verbatim,
 * as *"Nothing in the metadata graph points at this item. Safe to delete."*
 * An unanswerable question rendered as a positive clearance, on the screen
 * where someone decides to delete. ADR-0110 D3: a MISS and a FAULT are
 * different facts, and this one was never a miss.
 *
 * ## Why a seed here rather than a derivation
 *
 * "This type is addressed by a composite key" is a PROTOCOL fact, stated in
 * prose on `isNestedArtifactField` and nowhere a machine can read — the same
 * class as {@link SEMANTIC_REFERENCE_SITES}, and it gets the same treatment: a
 * seed small enough to argue, never a table to grow. `field` is the only member
 * and that is measured, not assumed — #7743 swept the whole registry and found
 * `field` is the ONE declared type whose artifacts are not standalone registry
 * items.
 *
 * ⛔ Do NOT add a member to make some other type "refuse cleanly". The seed is
 * a statement about KEY FORM, not a severity dial; a type whose key IS its
 * `name` answers honestly already, and refusing for it would trade this card's
 * false clearance for a false fault one type over.
 *
 * What is NOT hand-written is whether the seed is still TRUE — see
 * {@link nameVocabularyRejectsKey}. A member whose premise dissolves drops out
 * of the derived set on the next boot, so widening `FieldSchema.name` to admit
 * a dot turns the pin red instead of leaving a stale refusal in place.
 */
const COMPOSITE_KEYED_TARGET_TYPES: readonly {
    readonly type: DeclaredMetadataType;
    readonly separator: string;
}[] = [
    { type: 'field', separator: '.' },
];

/**
 * Is `type`'s composite key provably OUTSIDE the vocabulary its own `name`
 * declares — i.e. can no legal `name` ever equal the key the endpoint uses?
 *
 * This is the derived half of {@link COMPOSITE_KEYED_TARGET_TYPES}. `FieldSchema`
 * declares `name` as `^[a-z_][a-z0-9_]*$`, which cannot contain `.`, while the
 * key is `<object>.<field>` — so a site value and an addressed key are drawn
 * from disjoint sets and the match is impossible rather than merely absent.
 *
 * Deliberately conservative in both directions:
 *
 *  - an UNREADABLE shape answers `true` (it cannot promise the key is
 *    representable, and this module never converts an unknown into a clearance);
 *  - an UNCONSTRAINED `name` answers `false` — `email_template` and `capability`
 *    both declare dotted names, where the name IS the key and the question is
 *    answerable. Refusing those would be this card's harm inverted.
 */
function nameVocabularyRejectsKey(type: DeclaredMetadataType, separator: string): boolean {
    const schema = getMetadataTypeSchema(type);
    if (!schema) return true;
    let json: JsonSchemaNode;
    try {
        json = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as JsonSchemaNode;
    } catch {
        return true;
    }
    const nameNode = (json.properties as Record<string, JsonSchemaNode> | undefined)?.name;
    const pattern = nameNode?.pattern;
    if (typeof pattern !== 'string') return false;
    let compiled: RegExp;
    try {
        compiled = new RegExp(pattern);
    } catch {
        return false;
    }
    // A two-segment probe is enough: if the declared vocabulary admits the
    // separator at all, some composite key is representable and the type is
    // not unanswerable BY KEY FORM.
    return !compiled.test(`a${separator}b`);
}

/** `external_catalog` → `externalCatalog`. Identity for a type with no underscore. */
function camelCaseOf(type: string): string {
    return type.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
}

function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * The ONE pluralization rule, kept byte-identical to `restPluralOfMetaType` in
 * `@objectstack/spec/shared` on purpose: two spellings of "plural of a metadata
 * type" that can disagree is the #4432 defect wearing a different key.
 */
function pluralOf(type: string): string {
    if (/[^aeiou]y$/.test(type)) return `${type.slice(0, -1)}ies`;
    if (/(s|x|z|ch|sh)$/.test(type)) return `${type}es`;
    return `${type}s`;
}

/** Property spellings that name a single item of `type`. */
function singularSpellings(type: string): string[] {
    const camel = camelCaseOf(type);
    return [type, camel, `${type}_name`, `${camel}Name`, `target${capitalize(camel)}`];
}

/** Property spellings that name a COLLECTION of items of `type`. */
function pluralSpellings(type: string): string[] {
    const camel = camelCaseOf(type);
    return [pluralOf(type), pluralOf(camel), `${camel}Names`, `${pluralOf(camel)}Names`];
}

type JsonSchemaNode = Record<string, unknown>;

/**
 * Resolve `$ref`s and flatten `anyOf`/`oneOf`/`allOf` into the concrete
 * alternatives a node may take.
 *
 * The `$ref` cycle guard is per-branch rather than global: a recursive schema
 * (`AppSchema.navigation[].children[]`) must be enterable once on each branch
 * it appears on, and must not loop.
 */
function alternatives(
    node: unknown,
    defs: Record<string, JsonSchemaNode>,
    seenRefs: ReadonlySet<string>,
    depth: number,
): JsonSchemaNode[] {
    if (!node || typeof node !== 'object' || depth > 40) return [];
    const n = node as JsonSchemaNode;
    const ref = n.$ref;
    if (typeof ref === 'string') {
        const key = ref.replace('#/$defs/', '');
        if (seenRefs.has(key)) return [];
        return alternatives(defs[key], defs, new Set([...seenRefs, key]), depth + 1);
    }
    const out: JsonSchemaNode[] = [n];
    for (const combinator of ['anyOf', 'oneOf', 'allOf'] as const) {
        const members = n[combinator];
        if (Array.isArray(members)) {
            for (const member of members) out.push(...alternatives(member, defs, seenRefs, depth + 1));
        }
    }
    return out;
}

/**
 * Is this node an unconstrained name string?
 *
 * `enum` / `const` / `format` all mean the value is drawn from a closed or
 * typed vocabulary rather than naming an artifact — this is the half of the
 * rule that keeps `xAxis.position: 'left' | 'right'` out of the `position`
 * target's site list.
 */
function isNameString(node: JsonSchemaNode): boolean {
    return node.type === 'string' && node.enum === undefined && node.const === undefined && node.format === undefined;
}

/** Does this property's declared shape carry one or more item NAMES? */
function carriesNames(
    node: unknown,
    defs: Record<string, JsonSchemaNode>,
    expectCollection: boolean,
): boolean {
    for (const alt of alternatives(node, defs, new Set(), 0)) {
        if (!expectCollection && isNameString(alt)) return true;
        if (alt.type === 'array') {
            for (const item of alternatives(alt.items, defs, new Set(), 0)) {
                if (isNameString(item)) return true;
                const props = item.properties as Record<string, unknown> | undefined;
                if (props?.name && alternatives(props.name, defs, new Set(), 0).some(isNameString)) return true;
            }
        }
        // A record is name-keyed by construction (`z.record(name, …)`), so the
        // KEYS are the reference — `PermissionSetSchema.objects` is exactly
        // this, and the curated table's `objects[].name` could not express it.
        if (alt.type === 'object' && alt.additionalProperties && typeof alt.additionalProperties === 'object') return true;
        if (!expectCollection && alt.type === 'object') {
            const props = alt.properties as Record<string, unknown> | undefined;
            if (props?.name && alternatives(props.name, defs, new Set(), 0).some(isNameString)) return true;
        }
    }
    return false;
}

/**
 * Walk one source schema, recording every (property → target) binding it
 * declares. Depth-bounded and branch-cycle-guarded; the bound is on the SCHEMA
 * walk only, and cannot shorten a runtime answer, because what is collected is
 * a property NAME rather than a path.
 */
function collectSitesFromSchema(
    fromType: string,
    root: JsonSchemaNode,
    singular: ReadonlyMap<string, string>,
    plural: ReadonlyMap<string, string>,
    into: Map<string, ReferenceSite>,
): void {
    const defs = (root.$defs as Record<string, JsonSchemaNode> | undefined) ?? {};
    const visited = new Set<string>();

    const walk = (node: unknown, trail: string, depth: number): void => {
        if (depth > 12) return;
        for (const alt of alternatives(node, defs, new Set(), 0)) {
            const props = alt.properties as Record<string, unknown> | undefined;
            if (props) {
                for (const [key, child] of Object.entries(props)) {
                    const singularTarget = singular.get(key);
                    const pluralTarget = singularTarget ? undefined : plural.get(key);
                    const target = singularTarget ?? pluralTarget;
                    if (target && carriesNames(child, defs, pluralTarget !== undefined)) {
                        const site: ReferenceSite = { fromType, property: key, target };
                        into.set(`${fromType}|${key}|${target}`, site);
                    }
                    const branch = `${trail}.${key}`;
                    if (visited.has(branch)) continue;
                    visited.add(branch);
                    walk(child, branch, depth + 1);
                }
            }
            if (alt.items) walk(alt.items, `${trail}[]`, depth + 1);
            if (alt.additionalProperties && typeof alt.additionalProperties === 'object') {
                walk(alt.additionalProperties, `${trail}{}`, depth + 1);
            }
        }
    };

    walk(root, '', 0);
}

/**
 * Build the reference-site index from the metadata type schemas.
 *
 * Pure and side-effect free; {@link REFERENCE_SITES} memoizes one call of it at
 * module load. Exported so the derivation can be tested against the real
 * schemas rather than against a snapshot of itself.
 */
export function deriveReferenceSites(): ReferenceSiteIndex {
    const declaredTypes = DEFAULT_METADATA_TYPE_REGISTRY.map((entry) => entry.type);

    // Property spelling → target type. First writer wins, so a type never
    // steals a spelling another type already owns.
    const singular = new Map<string, string>();
    const plural = new Map<string, string>();
    for (const type of declaredTypes) {
        for (const spelling of singularSpellings(type)) if (!singular.has(spelling)) singular.set(spelling, type);
        for (const spelling of pluralSpellings(type)) if (!plural.has(spelling)) plural.set(spelling, type);
    }

    const sites = new Map<string, ReferenceSite>();
    const unwalkable: string[] = [];

    // Limb 1 — every declared type's own schema.
    for (const type of declaredTypes) {
        const schema = getMetadataTypeSchema(type);
        if (!schema) {
            unwalkable.push(type);
            continue;
        }
        let json: JsonSchemaNode;
        try {
            json = z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' }) as JsonSchemaNode;
        } catch {
            unwalkable.push(type);
            continue;
        }
        collectSitesFromSchema(type, json, singular, plural, sites);
    }

    // Limb 2 — flow node configs. See the module header: `FlowSchema` declares
    // `nodes[].config` as `additionalProperties: {}`, so limb 1 sees nothing
    // inside it and a flow's real references live only in this registry.
    for (const schema of Object.values(SCHEMALESS_NODE_CONFIG_SCHEMAS)) {
        try {
            const json = z.toJSONSchema(schema as z.ZodType, { unrepresentable: 'any', io: 'input' }) as JsonSchemaNode;
            collectSitesFromSchema('flow', json, singular, plural, sites);
        } catch {
            // A node config that cannot be converted contributes no sites. It
            // is not a declared metadata type, so it does not belong in
            // `unwalkableSourceTypes` — that set is about TYPES, and `flow`
            // itself remains walkable through limb 1.
        }
    }

    // Limb 3 — the residue. See {@link SEMANTIC_REFERENCE_SITES}.
    for (const site of SEMANTIC_REFERENCE_SITES) {
        sites.set(`${site.fromType}|${site.property}|${site.target}`, site);
    }

    const byTarget = new Map<string, ReferenceSite[]>();
    for (const site of sites.values()) {
        const bucket = byTarget.get(site.target);
        if (bucket) bucket.push(site);
        else byTarget.set(site.target, [site]);
    }
    // Stable order so the derived index reads the same on every boot.
    for (const bucket of byTarget.values()) {
        bucket.sort((a, b) => a.fromType.localeCompare(b.fromType) || a.property.localeCompare(b.property));
    }

    // The TARGET-side honest record. Derived from the declared universe like
    // everything else here: a seeded type that is not declared contributes
    // nothing, and a seeded type whose `name` vocabulary has since widened to
    // admit its own key drops out. See COMPOSITE_KEYED_TARGET_TYPES.
    const declared = new Set(declaredTypes);
    const unanswerableTargets = COMPOSITE_KEYED_TARGET_TYPES
        .filter(({ type, separator }) => declared.has(type) && nameVocabularyRejectsKey(type, separator))
        .map(({ type }) => type)
        .sort();

    return { byTarget, unwalkableSourceTypes: unwalkable.sort(), unanswerableTargetTypes: unanswerableTargets };
}

/**
 * The derived index, computed once per process.
 *
 * Module-load derivation is what makes the answer impossible to forget to
 * update: there is no list to edit, so a newly declared type is covered by the
 * next boot rather than by the next person who notices.
 */
export const REFERENCE_SITES: ReferenceSiteIndex = deriveReferenceSites();
