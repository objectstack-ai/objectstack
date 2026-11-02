// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28574, ADR-0146 D10 / D2 / D3] An object extension is an authorable item
 * of a writable package.
 *
 * `object_extension` is the type the artifact loader already stores a code
 * package's `objectExtensions` under; since #28574 it is also a row a running
 * deployment writes. Studio's add-field on a base object (N-23c) writes
 * exactly this: an extension in the base's paired `.custom`, its fields
 * suffixed `__c`, the base untouched. The row is stored under the writing
 * package with the TARGET object's name as its row name — one extension per
 * package per target — and its body is `ObjectExtensionSchema` as it stands:
 * it carries `extend` and no `name`.
 *
 * Draft, publish, history, rollback and delete are the doors every item uses.
 * This module holds what those doors ask that is particular to the type, so
 * no door spells it twice:
 *
 *  - {@link objectExtensionItemRefusal} — the save / publish / restore gate,
 *    asked beside the `__c` judge it calls;
 *  - {@link registrableObjectExtension} — the whole parsed body every sync
 *    registers as the package's `'extend'` contributor
 *    (`SchemaRegistry.registerObjectExtension`).
 *
 * The body's SHAPE is judged by the doors' own schema gate
 * (`resolveOverlaySchema` → {@link OBJECT_EXTENSION_ITEM_SCHEMA}), with the
 * envelope every other type's 422 carries. What the gate here adds is the
 * body against its address, `VALIDATION_ERROR` / 400 — the envelope of the
 * doors' other body-against-address refusals (`savedItemNameRefusal`,
 * `permissionSetOwnerBindingRefusal`, the `__c` judge). No code is minted.
 */

import { z } from 'zod';
import { ObjectExtensionSchema } from '@objectstack/spec/data';
import { MetadataProtectionFields } from '@objectstack/spec/kernel';
import { closureDependencyRemedy, narrowObjectsToPackageClosure } from '@objectstack/lint/runtime';
import type { RuntimePackageScope } from '@objectstack/lint/runtime';
import { judgeExtensionFieldSuffix, extensionFieldSuffixRefusalError } from './protocol-extension-field-suffix.js';
import type { MetadataIssueEntry } from './protocol.js';

/** The metadata type of an object extension item. */
export const OBJECT_EXTENSION_TYPE = 'object_extension' as const;

/** The ADR-0010 envelope keys, read off the spec's own mixin. */
const PROTECTION_ENVELOPE_KEYS: readonly string[] = Object.keys(MetadataProtectionFields);

const isRecord = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * `body` without the ADR-0010 envelope a loader or a read stamps on it
 * (`_packageId`, `_provenance`, `_lock`, …): the keys the strict
 * `ObjectExtensionSchema` does not declare and an author never writes.
 * Returns `body` itself when it carries none.
 */
export function withoutProtectionEnvelope(body: unknown): unknown {
    if (!isRecord(body) || !PROTECTION_ENVELOPE_KEYS.some((k) => k in body)) return body;
    const out = { ...body };
    for (const k of PROTECTION_ENVELOPE_KEYS) delete out[k];
    return out;
}

/**
 * The schema the doors' shape gate judges an `object_extension` body by:
 * `ObjectExtensionSchema` itself, strict, over the body with its envelope
 * peeled off. Not bound in `BUILTIN_METADATA_TYPE_SCHEMAS` (the spec ruling on
 * #28574): the ADR-0010 envelope that map requires would change the schema a
 * manifest's `objectExtensions` parse with, so the envelope a read or a loader
 * stamps is taken off before the parse instead.
 */
export const OBJECT_EXTENSION_ITEM_SCHEMA = z.preprocess(withoutProtectionEnvelope, ObjectExtensionSchema);

/**
 * The name a list read slots an item under. An item's own `name`; for an
 * `object_extension` body, which carries `extend` and no `name`
 * (`ObjectExtensionSchema` refuses one), its target — the name its row is
 * stored under (one extension per package per target). The body is not
 * given a `name`: a read serves it as it is stored, so what a GET answers
 * PUTs back through the strict schema. `undefined` = not addressable.
 */
export function listSlotNameOf(canonicalType: string, item: unknown): unknown {
    if (!isRecord(item)) return undefined;
    if ('name' in item) return item.name;
    if (canonicalType === OBJECT_EXTENSION_TYPE && typeof item.extend === 'string') return item.extend;
    return undefined;
}

/** The registry members the gate and the syncs read, reached through the engine. */
export interface ObjectExtensionRegistry {
    getObject?(name: string): unknown;
    extendContributionRefusal?(
        schema: { name?: unknown; defaultRowScope?: unknown; membershipKeys?: unknown },
        packageId: string | undefined,
    ): Error | undefined;
    registerObjectExtension?(extension: { extend: string; priority?: number } & Record<string, unknown>, packageId: string): string;
    withdrawObjectExtension?(name: string, packageId: string): boolean;
    getObjectContributors?(name: string): Array<{ packageId: string; ownership: string; definition?: unknown }>;
}

type GateRefusal = Error & { code: 'VALIDATION_ERROR'; status: 400; issues?: MetadataIssueEntry[] };

function refusal(message: string, path?: string): GateRefusal {
    const err = new Error(message) as GateRefusal;
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    if (path !== undefined) err.issues = [{ path, message, code: 'custom' }];
    return err;
}

/** What a door hands the gate: the item, the row name, and the package the row is written into. */
export interface ObjectExtensionItemSubject {
    /** The body as the door will store it. */
    item: unknown;
    /** The row name — the extension's target object. */
    name: string;
    /** The RESOLVED package the row is written into (the door's `saveWriteBinding`). */
    binding: string | null | undefined;
    /** The engine's registry. Absent ⇒ the target checks are not asked. */
    registry: ObjectExtensionRegistry | undefined;
    /**
     * The written package's closure (`resolveWritePackageScope`). `undefined`
     * when it cannot be read ⇒ the closure is not narrowed, the gate's
     * fail-open direction everywhere else (`narrowObjectsToPackageClosure`).
     */
    scope: RuntimePackageScope | undefined;
}

/**
 * The save, publish and restore doors' question for one `object_extension`
 * body, in order. `undefined` = admitted (or not this type). A body whose
 * `extend` is not a string is left to the schema gate, which refuses it with
 * the schema's own sentence (`extend` is required, and its aliases name it).
 *
 *  1. The row is a package's item: a write bound to no package is refused.
 *  2. The registry's own `extend` refusals (`defaultRowScope`,
 *     `membershipKeys`) with their sentences — asked BEFORE the strict parse
 *     would refuse the key with the generic unknown-key sentence, so the
 *     author reads the reason a sync would otherwise throw at registration.
 *  3. The row name is the target: `extend` equals the name it is filed under.
 *  4. The target object is registered, under the very key `extend` spells
 *     (#28834): `getObject` also folds a short name to a legacy
 *     `<ns>__<name>` key, while the registry files an extension under the
 *     name it is written with, so a folded spelling would open a second,
 *     phantom object beside the one it meant.
 *  5. The target lies inside the written package's dependency closure — the
 *     package's own objects, its declared dependencies' and platform objects
 *     (`narrowObjectsToPackageClosure`, the one predicate), refused with the
 *     closure prescription every save door prints (`closureDependencyRemedy`).
 *  6. The `__c` reservation (`judgeExtensionFieldSuffix`, #28564), judged as
 *     the package's `objectExtensions` entry; an extension of the package's
 *     own object adds to its own fields, as the judge reads it.
 *
 * Whether the package is writable is the door's own refusal
 * (`WRITABLE_PACKAGE_REQUIRED`), asked before any of this.
 */
export function objectExtensionItemRefusal(
    singularType: string,
    subject: ObjectExtensionItemSubject,
): Error | undefined {
    if (singularType !== OBJECT_EXTENSION_TYPE) return undefined;
    const { item, name, binding, registry, scope } = subject;
    if (!isRecord(item)) return undefined;

    // 1.
    if (typeof binding !== 'string' || binding === '') {
        return refusal(
            `Object extension '${name}': an object extension is an item of a package, and this write names none. `
            + 'Save it into the writable package it belongs to (`?package=`): for a base\'s object, the base\'s '
            + 'paired `.custom` package.',
        );
    }

    // 2.
    const target = typeof item.extend === 'string' ? item.extend : undefined;
    const registryRefusal = registry?.extendContributionRefusal?.({ ...item, name: target ?? name }, binding);
    if (registryRefusal) {
        const key = item.defaultRowScope !== undefined ? 'defaultRowScope' : 'membershipKeys';
        return refusal(registryRefusal.message, key);
    }
    if (target === undefined) return undefined;

    // 3.
    if (target !== name) {
        return refusal(
            `Object extension '${name}' extends '${target}': an object extension is stored under the name of the `
            + `object it extends. Save it as '${target}', or set \`extend\` to '${name}'.`,
            'extend',
        );
    }

    // 4. and 5.
    if (registry && typeof registry.getObject === 'function') {
        const object = registry.getObject(target);
        if (!isRecord(object)) {
            return refusal(
                `Object extension '${name}': no object named '${target}' is registered, so there is nothing to `
                + 'extend. Name an installed object in `extend`.',
                'extend',
            );
        }
        if (typeof object.name === 'string' && object.name !== target) {
            return refusal(
                `Object extension '${name}' extends '${target}', but that object is registered as '${object.name}': `
                + `an extension is filed under the name it is written with, so '${target}' would open a second object `
                + `beside '${object.name}'. Save it as '${object.name}', with \`extend\` set to '${object.name}'.`,
                'extend',
            );
        }
        if (narrowObjectsToPackageClosure([object], scope).length === 0) {
            return refusal(
                `Object extension '${name}' in package '${binding}': object '${target}' is outside the package's `
                + `dependency closure. ${closureDependencyRemedy(target, binding, 'extend an object the package can reach')}.`,
                'extend',
            );
        }
    }

    // 6.
    const owner = (registry?.getObject?.(target) as { _packageId?: unknown } | undefined)?._packageId;
    const suffix = judgeExtensionFieldSuffix({
        packageId: binding,
        objects: owner === binding ? { [target]: { name: target } } : undefined,
        objectExtensions: [item],
    }).map((r) => ({ ...r, path: r.path.slice('objectExtensions[0].'.length) }));
    if (suffix.length > 0) return extensionFieldSuffixRefusalError(suffix);
    return undefined;
}

/**
 * The body a sync registers for a stored `object_extension` row: the WHOLE
 * parsed body (`ObjectExtensionSchema`: its defaults, such as `priority`, and
 * its rewrites applied), with the envelope peeled off first and the row's
 * tenant provenance stated (ADR-0010 `_provenance: 'org'`, as every stored
 * `object` row registers). Throws the parse's error for a body the schema
 * refuses, so each sync's own per-row handling names it.
 */
export function registrableObjectExtension(
    body: unknown,
): { extend: string; priority?: number } & Record<string, unknown> {
    const parsed = OBJECT_EXTENSION_ITEM_SCHEMA.safeParse(body);
    if (!parsed.success) {
        const first = parsed.error.issues[0];
        const err = new Error(
            `stored object extension does not parse as ObjectExtensionSchema`
            + (first ? ` (${first.path.join('.') || '<root>'}: ${first.message})` : ''),
        ) as Error & { code: string; status: number };
        err.code = 'INVALID_METADATA';
        err.status = 422;
        throw err;
    }
    const registrable = parsed.data as { extend: string; priority?: number } & Record<string, unknown>;
    return { ...registrable, _provenance: 'org' };
}
