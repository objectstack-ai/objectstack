// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D10, first rule — the `__c` extension-field reservation, judged.
 *
 * Maintainer, verbatim: 「扩展字段用 __c 后缀，只有 .custom 包能用。」 A
 * customer's field on a base object is `region__c`, so a vendor's next version
 * can never take that name, and nobody mistakes the customer's field for the
 * vendor's. That holds only if every door that lets a field in asks the same
 * question, so this module is the ONE judge and every door calls it:
 *
 *   - the save, the restore and the draft promotion of `@objectstack/metadata-
 *     protocol` (`saveMetaItem`, `rollbackMetaItem`, and the promotion
 *     `publishMetaItem` / `publishPackageDrafts` share), for an `object` body,
 *     through {@link objectBodyExtensionFieldSuffixRefusal};
 *   - the same three doors for an `object_extension` item, as the package's one
 *     `objectExtensions` entry, through {@link judgeExtensionFieldSuffix}
 *     (`objectExtensionItemRefusal`, `protocol-object-extension-item.ts`);
 *   - `duplicatePackage`, for every object the copy would write, judged against
 *     the TARGET id before the copy mints anything;
 *   - `os validate` (`@objectstack/cli`) and the marketplace install
 *     (`@objectstack/cloud-connection`), for a whole package body, through
 *     {@link judgeExtensionFieldSuffix}.
 *
 * `installPackage` is covered by its closed manifest, not by a call here: its
 * `PackageInstallManifestSchema` is a `strictObject` whose `objects` are glob
 * strings and which has no `objectExtensions` key, so a field body never
 * reaches it (refused by that parse before any write).
 *
 * ## The two cases
 *
 * Given the package a body is written into and the objects and extensions it
 * declares:
 *
 *   - (a) `reserved_outside_pair` — in a package that is NOT a base's paired
 *     `.custom` ({@link isCustomizationPackage}), every field spelled `__c`
 *     ({@link isExtensionFieldName}), on its own objects or in its
 *     `objectExtensions`, is refused: rename it. A field one vendor package adds
 *     to another's object keeps the plain spelling (ADR-0029 D7).
 *   - (b) `unsuffixed_in_pair` — in a `.custom` pair, every
 *     `objectExtensions[].fields` key without the suffix is refused: suffix it,
 *     or change the base field's display properties in the extension's
 *     `fieldPatches` (the per-field patch slot, `data/object.zod.ts`).
 *
 * A `.custom` pair's own new objects are not judged, and neither is an
 * extension of one of them: their fields are the pair's own. A write bound to
 * no package is not judged: the reservation is a rule about packages, and a
 * package-unbound row is the environment's own (as the namespace-prefix judge,
 * `objectNamespacePrefixViolation`, skips it).
 *
 * The suffix and the pair rule are the spec's (`@objectstack/spec/data`
 * `field-customization.ts`, `@objectstack/spec/kernel`
 * `customization-package.ts`), never re-spelled here. Pure: no I/O, no throw
 * from {@link judgeExtensionFieldSuffix}. Each door keeps its own envelope;
 * the active doors' is {@link extensionFieldSuffixRefusalError}'s
 * `VALIDATION_ERROR` / 400, the envelope of their other body-against-address
 * refusals (`savedItemNameRefusal`, `permissionSetOwnerBindingRefusal`). No
 * code is minted.
 */

import { isExtensionFieldName } from '@objectstack/spec/data';
import { isCustomizationPackage } from '@objectstack/spec/kernel';
import type { MetadataIssueEntry } from './protocol.js';

/** Which of the two cases refused a field. */
export type ExtensionFieldSuffixRule = 'reserved_outside_pair' | 'unsuffixed_in_pair';

/** One refused field, located. */
export interface ExtensionFieldSuffixRefusal {
    rule: ExtensionFieldSuffixRule;
    /** Where the field sits in the judged body, e.g. `objectExtensions[0].fields.region`. */
    path: string;
    /** The object the field is on: the object's own name, or the extension's `extend` target. */
    object: string;
    /** The field name as written. */
    field: string;
    /** The package the body is written into. */
    packageId: string;
    /** The door's sentence: what is wrong, then the prescription. */
    message: string;
}

/** What a door hands the judge: the package written into and what it declares. */
export interface ExtensionFieldSuffixSubject {
    /** The package the body is written into. Not a non-empty string ⇒ not judged. */
    packageId: string | null | undefined;
    /** The package's own objects: an array of object bodies, or a record of them keyed by name. */
    objects?: unknown;
    /** The package's `objectExtensions` entries. */
    objectExtensions?: unknown;
    /** Prefix of every reported path, e.g. `packages[1].manifest.`. */
    at?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * The field names an object or extension body declares, each with its path
 * segment: a record keyed by name (the declared shape), or an array of
 * `{ name }` entries (a pre-protocol dialect a door may still be handed).
 */
function declaredFieldNames(fields: unknown): Array<{ name: string; segment: string }> {
    if (isRecord(fields)) return Object.keys(fields).map((name) => ({ name, segment: `fields.${name}` }));
    if (!Array.isArray(fields)) return [];
    const out: Array<{ name: string; segment: string }> = [];
    fields.forEach((entry, i) => {
        if (isRecord(entry) && typeof entry.name === 'string') out.push({ name: entry.name, segment: `fields[${i}]` });
    });
    return out;
}

/** The entries of an `objects` collection with their path segments: an array, or a record keyed by name. */
function objectEntries(objects: unknown): Array<{ body: Record<string, unknown>; name: string; segment: string }> {
    const out: Array<{ body: Record<string, unknown>; name: string; segment: string }> = [];
    if (Array.isArray(objects)) {
        objects.forEach((body, i) => {
            if (isRecord(body)) out.push({ body, name: typeof body.name === 'string' ? body.name : '', segment: `objects[${i}]` });
        });
    } else if (isRecord(objects)) {
        for (const [key, body] of Object.entries(objects)) {
            if (isRecord(body)) out.push({ body, name: typeof body.name === 'string' ? body.name : key, segment: `objects.${key}` });
        }
    }
    return out;
}

/** Case (a)'s sentence. Prescription first: a 4xx message crosses the REST boundary capped at 500 characters. */
function reservedOutsidePairMessage(field: string, object: string, packageId: string): string {
    return `Field '${field}' on object '${object}' in package '${packageId}': the \`__c\` suffix is reserved to a base's `
        + 'paired `.custom` package (ADR-0146 D10); rename the field.';
}

/** Case (b)'s sentence. */
function unsuffixedInPairMessage(field: string, object: string, packageId: string): string {
    return `Extension field '${field}' on object '${object}' in package '${packageId}': name it \`${field}__c\`, or change `
        + 'a base field\'s display properties in the extension\'s patch (`fieldPatches`).';
}

/**
 * Every field the reservation refuses in what `subject` declares, in
 * declaration order (objects first, then extensions). Empty when the subject
 * names no package or nothing is refused.
 */
export function judgeExtensionFieldSuffix(subject: ExtensionFieldSuffixSubject): ExtensionFieldSuffixRefusal[] {
    const { packageId } = subject;
    if (typeof packageId !== 'string' || packageId === '') return [];
    const at = subject.at ?? '';
    const pair = isCustomizationPackage(packageId);
    const refusals: ExtensionFieldSuffixRefusal[] = [];
    const own = objectEntries(subject.objects);

    // (a) The package's own objects. A pair's own objects are not judged.
    if (!pair) {
        for (const { body, name, segment } of own) {
            for (const field of declaredFieldNames(body.fields)) {
                if (!isExtensionFieldName(field.name)) continue;
                refusals.push({
                    rule: 'reserved_outside_pair', path: `${at}${segment}.${field.segment}`,
                    object: name, field: field.name, packageId,
                    message: reservedOutsidePairMessage(field.name, name, packageId),
                });
            }
        }
    }

    // (a) or (b) on the extensions, by whether the package is the pair.
    if (Array.isArray(subject.objectExtensions)) {
        const ownNames = new Set(own.map((o) => o.name).filter((n) => n !== ''));
        subject.objectExtensions.forEach((ext, i) => {
            if (!isRecord(ext)) return;
            const target = typeof ext.extend === 'string' ? ext.extend : '';
            // An extension of the pair's own object adds to the pair's own fields.
            if (pair && ownNames.has(target)) return;
            for (const field of declaredFieldNames(ext.fields)) {
                const suffixed = isExtensionFieldName(field.name);
                if (pair === suffixed) continue;
                refusals.push({
                    rule: pair ? 'unsuffixed_in_pair' : 'reserved_outside_pair',
                    path: `${at}objectExtensions[${i}].${field.segment}`,
                    object: target, field: field.name, packageId,
                    message: pair
                        ? unsuffixedInPairMessage(field.name, target, packageId)
                        : reservedOutsidePairMessage(field.name, target, packageId),
                });
            }
        });
    }
    return refusals;
}

/**
 * The active doors' envelope around a non-empty refusal list: `VALIDATION_ERROR`
 * / 400, the message the first refusal's sentence (and how many more), and
 * `issues[]` locating every field, the shape the Studio designer keys on.
 */
export function extensionFieldSuffixRefusalError(
    refusals: readonly ExtensionFieldSuffixRefusal[],
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
 * The save, restore and promotion doors' question for one item: an `object`
 * body written into `binding` (the RESOLVED package of the row, as
 * `permissionSetOwnerBindingRefusal` reads it), judged as that package's own
 * object. Any other type, and a write bound to no package, answer `undefined`.
 */
export function objectBodyExtensionFieldSuffixRefusal(
    singularType: string,
    item: unknown,
    name: string,
    binding: string | null | undefined,
): (Error & { code: 'VALIDATION_ERROR'; status: 400; issues: MetadataIssueEntry[] }) | undefined {
    if (singularType !== 'object' || !isRecord(item)) return undefined;
    const refusals = judgeExtensionFieldSuffix({ packageId: binding, objects: { [name]: { ...item, name } } })
        // The body is the whole item, so its paths start at the item, not at `objects.<name>`.
        .map((r) => ({ ...r, path: r.path.slice(`objects.${name}.`.length) }));
    return refusals.length > 0 ? extensionFieldSuffixRefusalError(refusals) : undefined;
}
