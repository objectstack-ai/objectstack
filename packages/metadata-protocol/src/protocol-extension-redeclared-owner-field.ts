// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D10, second rule — a base field changes only within the
 * display-property whitelist, judged where an extension re-declares it.
 *
 * An `objectExtensions[].fields` entry whose key names a field the extended
 * object's OWNER declares does not add a field: the registry fold
 * (`mergeObjectDefinitions`, `@objectstack/objectql`) spreads the extension's
 * `fields` over the owner's, so the entry REPLACES the owner's field whole. A
 * module package could turn an owner's writable `amount: number` into `text`,
 * `readonly: true` or a formula, and every reader then judges the field on the
 * extension's definition. D10: "Everything else on a base field — type,
 * `required`, `unique`, `reference`, `defaultValue`, formulas, `options`
 * membership — is refused on the extension with a prescription naming the
 * whitelist." The display change has its own slot, `fieldPatches`.
 *
 * This module is the ONE judge, and three doors ask it:
 *
 *   - the save, publish and restore doors of an `object_extension` item
 *     (`objectExtensionItemRefusal`, `protocol-object-extension-item.ts`),
 *     against the registry's owner declaration (`getObjectOwner`);
 *   - `os validate` (`@objectstack/cli`), for an extension whose target
 *     another package of the same artifact declares;
 *   - the marketplace install door (`@objectstack/cloud-connection`), against
 *     an object the artifact delivers or the installed owner's declaration.
 *
 * The registry's `reportRedeclaredFields` warning stays: it names what is
 * served for a body no door judged (a code package registered at boot).
 *
 * ## What is refused
 *
 * A re-declaration is refused when it changes anything outside the whitelist
 * (`BASE_FIELD_DISPLAY_WHITELIST`, `@objectstack/spec/data`, read here and
 * never re-spelled). Both bodies are first read through `FieldSchema`, so a
 * default the parse stamps on one side and not the other is no change; then
 * every key is compared except the whitelisted ones, the field's `name` (the
 * key is its identity) and the ADR-0010 envelope (`_`-prefixed). `options` is
 * compared as membership: each option without its whitelisted keys, keyed by
 * its stored `value`, so a relabel or a reorder is no change. A re-declaration
 * that differs only in display properties is admitted: what it serves is what
 * the same `fieldPatches` entry would.
 *
 * Not judged: an extension of an object its own package owns (it changes its
 * own field), an object no owner is known for at the door (another door, or
 * the registry's own report, answers it), and an entry whose key the owner
 * does not declare (an added field). A `.custom` pair's unsuffixed key is
 * refused first by the `__c` judge (`judgeExtensionFieldSuffix`), whose
 * prescription names `fieldPatches` too.
 *
 * Pure: no I/O, no throw from {@link judgeRedeclaredOwnerFields}. Each door
 * keeps its own envelope; the save doors' is
 * {@link redeclaredOwnerFieldRefusalError}'s `VALIDATION_ERROR` / 400. No code
 * is minted.
 */

import { BASE_FIELD_DISPLAY_WHITELIST, FieldSchema } from '@objectstack/spec/data';
import type { MetadataIssueEntry } from './protocol.js';

/** One owner field an extension re-declares with a change outside the whitelist, located. */
export interface RedeclaredOwnerFieldRefusal {
    /** Where the entry sits in the judged body, e.g. `objectExtensions[0].fields.amount`. */
    path: string;
    /** The extended object (the extension's `extend`). */
    object: string;
    /** The re-declared field. */
    field: string;
    /** The package the extension is written into. */
    packageId: string | undefined;
    /** The package that owns the object, when the door knows it. */
    ownerPackageId: string | undefined;
    /** The keys of the field the entry changes, every one outside the whitelist, sorted. */
    changed: string[];
    /** The door's sentence: the prescription, then why. */
    message: string;
}

/** The owner of an object as a door knows it: its package and its own declaration. */
export interface ObjectOwnerDeclaration {
    packageId: string | undefined;
    /** The object body the owner declares, never the resolved object (that one carries every extension's fields). */
    definition: unknown;
}

/** What a door hands the judge. */
export interface RedeclaredOwnerFieldSubject {
    /** The package the extensions are written into. */
    packageId: string | null | undefined;
    /** The package's `objectExtensions` entries. */
    objectExtensions: unknown;
    /** The owner of an object by name; `undefined` ⇒ that extension is not judged here. */
    ownerOf: (object: string) => ObjectOwnerDeclaration | undefined;
    /** Prefix of every reported path, e.g. `packages[1].manifest.`. */
    at?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);

const FIELD_DISPLAY_KEYS: ReadonlySet<string> = new Set(BASE_FIELD_DISPLAY_WHITELIST.field);
const OPTION_DISPLAY_KEYS: ReadonlySet<string> = new Set(BASE_FIELD_DISPLAY_WHITELIST.option);

/** The whitelist as an author reads it, from the spec constant. */
const WHITELIST_TEXT = [
    ...BASE_FIELD_DISPLAY_WHITELIST.field.map((k) => `\`${k}\``),
    ...BASE_FIELD_DISPLAY_WHITELIST.option.map((k) => `an option's \`${k}\``),
].join(', ');

/** The fields an object or extension body declares, each with its path segment: a name-keyed record or a `name`-bearing array. */
function declaredFields(fields: unknown): Array<{ name: string; segment: string; body: unknown }> {
    if (isRecord(fields)) return Object.entries(fields).map(([name, body]) => ({ name, segment: `fields.${name}`, body }));
    if (!Array.isArray(fields)) return [];
    const out: Array<{ name: string; segment: string; body: unknown }> = [];
    fields.forEach((entry, i) => {
        if (isRecord(entry) && typeof entry.name === 'string') out.push({ name: entry.name, segment: `fields[${i}]`, body: entry });
    });
    return out;
}

/** A field of an object body by name, in either spelling. */
function ownerFieldOf(definition: unknown, name: string): Record<string, unknown> | undefined {
    if (!isRecord(definition)) return undefined;
    const found = declaredFields(definition.fields).find((f) => f.name === name);
    return found && isRecord(found.body) ? found.body : undefined;
}

/** `value` with every object's keys sorted, so two equal bodies serialise alike. */
function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, v: unknown) => {
        if (!isRecord(v)) return v;
        const sorted: Record<string, unknown> = {};
        for (const k of Object.keys(v).sort()) sorted[k] = v[k];
        return sorted;
    }) ?? 'undefined';
}

/** An option without its display keys. */
function optionMembership(option: unknown): unknown {
    if (!isRecord(option)) return option;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(option)) if (!OPTION_DISPLAY_KEYS.has(k) && v !== undefined) out[k] = v;
    return out;
}

/**
 * What a field body decides outside the whitelist: its `FieldSchema` reading
 * (the body as written when it does not parse; the schema gate refuses it with
 * its own sentence) without the display keys, its `name` and its envelope, and
 * `options` as membership keyed by stored value.
 */
function structuralView(field: Record<string, unknown>): Record<string, unknown> {
    const bare: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(field)) if (!k.startsWith('_')) bare[k] = v;
    const parsed = FieldSchema.safeParse(bare);
    const body = parsed.success ? (parsed.data as Record<string, unknown>) : bare;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
        if (v === undefined || k === 'name' || FIELD_DISPLAY_KEYS.has(k)) continue;
        if (k === 'options' && Array.isArray(v)) {
            const byValue: Record<string, unknown> = {};
            v.forEach((o, i) => { byValue[isRecord(o) && typeof o.value === 'string' ? o.value : `#${i}`] = optionMembership(o); });
            out[k] = byValue;
            continue;
        }
        out[k] = v;
    }
    return out;
}

/**
 * The keys of `ownerField` that `extensionField`, put in its place, changes
 * outside the display-property whitelist, sorted. `[]` = a display-only
 * re-declaration.
 */
export function redeclaredFieldChanges(extensionField: unknown, ownerField: unknown): string[] {
    if (!isRecord(extensionField) || !isRecord(ownerField)) return [];
    const a = structuralView(extensionField);
    const b = structuralView(ownerField);
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    return [...keys].filter((k) => canonical(a[k]) !== canonical(b[k])).sort();
}

/** The sentence. Prescription first: a 4xx message crosses the REST boundary capped at 500 characters. */
function refusalMessage(field: string, object: string, ownerPackageId: string | undefined, changed: readonly string[]): string {
    const shown = changed.slice(0, 3).map((k) => `\`${k}\``).join(', ');
    const more = changed.length > 3 ? ` and ${changed.length - 3} more` : '';
    const owner = ownerPackageId ? `package '${ownerPackageId}'` : 'its owner';
    return `Extension field '${field}' on object '${object}' re-declares the field ${owner} declares and changes `
        + `${shown}${more}: change a base field's display properties (${WHITELIST_TEXT}) in \`fieldPatches\`, or add `
        + 'a field of your own under a new name. An extension\'s `fields` entry replaces the owner\'s field whole, and '
        + 'everything else on it stays the owner\'s (ADR-0146 D10).';
}

/**
 * Every `objectExtensions[].fields` entry of `subject` that re-declares a field
 * the extended object's owner declares and changes something outside the
 * whitelist, in declaration order.
 */
export function judgeRedeclaredOwnerFields(subject: RedeclaredOwnerFieldSubject): RedeclaredOwnerFieldRefusal[] {
    if (!Array.isArray(subject.objectExtensions)) return [];
    const at = subject.at ?? '';
    const packageId = typeof subject.packageId === 'string' && subject.packageId !== '' ? subject.packageId : undefined;
    const refusals: RedeclaredOwnerFieldRefusal[] = [];
    subject.objectExtensions.forEach((ext, i) => {
        if (!isRecord(ext) || typeof ext.extend !== 'string') return;
        const object = ext.extend;
        const owner = subject.ownerOf(object);
        // No owner known here, or the package extends its own object.
        if (!owner || owner.packageId === packageId) return;
        for (const entry of declaredFields(ext.fields)) {
            const ownerField = ownerFieldOf(owner.definition, entry.name);
            if (!ownerField) continue;
            const changed = redeclaredFieldChanges(entry.body, ownerField);
            if (changed.length === 0) continue;
            refusals.push({
                path: `${at}objectExtensions[${i}].${entry.segment}`,
                object, field: entry.name, packageId, ownerPackageId: owner.packageId, changed,
                message: refusalMessage(entry.name, object, owner.packageId, changed),
            });
        }
    });
    return refusals;
}

/**
 * The save doors' envelope around a non-empty refusal list: `VALIDATION_ERROR`
 * / 400, the first refusal's sentence (and how many more), and `issues[]`
 * locating every entry — the envelope of the `__c` judge beside it.
 */
export function redeclaredOwnerFieldRefusalError(
    refusals: readonly RedeclaredOwnerFieldRefusal[],
): Error & { code: 'VALIDATION_ERROR'; status: 400; issues: MetadataIssueEntry[] } {
    const [first] = refusals;
    const more = refusals.length - 1;
    const err = new Error(
        `${first!.message}${more > 0 ? ` (${more} more field${more === 1 ? '' : 's'} in \`issues\`.)` : ''}`,
    ) as Error & { code: 'VALIDATION_ERROR'; status: 400; issues: MetadataIssueEntry[] };
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    err.issues = refusals.map((r) => ({ path: r.path, message: r.message, code: 'custom' }));
    return err;
}

/**
 * The install door's sentence for a non-empty refusal list: how many, the first
 * one whole, and that nothing was installed. Every refusal is listed in the
 * answer's `details.refusals`.
 */
export function redeclaredOwnerFieldInstallMessage(packageId: string, refusals: readonly RedeclaredOwnerFieldRefusal[]): string {
    const n = refusals.length;
    return `Package '${packageId}' cannot be installed: ${n} extension field${n > 1 ? 's re-declare' : ' re-declares'} `
        + `an owner's field beyond its display properties (ADR-0146 D10). ${refusals[0]?.path}: ${refusals[0]?.message}`
        + (n > 1 ? ` (${n - 1} more in \`details.refusals\`.)` : '')
        + ' Nothing was installed or written.';
}
