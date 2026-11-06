// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0070 D4, #30794] ⭐ THE ONE RENAME ENGINE: a package's items, re-namespaced
 * from the source namespace into a target namespace, as pure functions over
 * item bodies — no store, no host, no write.
 *
 * Two doors copy a package under a namespace of its own, and both call this:
 *
 *  - `duplicatePackage` (ADR-0070 D4), over the source base's stored rows;
 *  - the `unmanaged` install's copy-once import (ADR-0131 D6, `targetNamespace`),
 *    over the package body it is handed, after the view containers are
 *    expanded into the names they serve (`package-unmanaged-install.ts`).
 *
 * ⛔ There is no second copy of these rules. The rename logic below was the body
 * of `duplicatePackage` (fixes #19417, #19577, #23510, #24547, and the objectql
 * `protocol-duplicate-package-*` battery); it moved here whole, and the
 * duplicate now calls it. The same package sent through either door with one
 * target namespace yields identical items — the parity the objectql battery
 * pins.
 *
 * What a caller does around it, and what this module never does:
 *  - it hands every item it will copy ({@link NamespaceRenameItem}), its body
 *    parsed (`undefined` for a body that does not parse — the caller reports
 *    that one at its own name);
 *  - it asks {@link NamespaceRename.objectRefusal} before it writes an object,
 *    {@link NamespaceRename.copyName} for the name each item is written under,
 *    and {@link NamespaceRename.rewrite} for the body, after converting the
 *    body to today's protocol;
 *  - it delivers each refusal its own way: the duplicate is per-item
 *    best-effort (`failed[]`), the import is all or nothing (one refusal
 *    before the base exists).
 */

import { SysMetadataObject } from '@objectstack/metadata-core';
import { METADATA_ITEM_NAME_PATTERN, PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { REFERENCE_SITES } from './reference-sites.js';

/** One item a copy writes, as the rename engine reads it. */
export interface NamespaceRenameItem {
    /** The type as the caller holds it (a stored row's spelling, or the canonical singular). */
    type: string;
    /** The item's name in the SOURCE package. */
    name: string;
    /** The parsed body; `undefined` when it does not parse. */
    body: unknown;
}

/** What the engine is told about the copy. */
export interface NamespaceRenameInput {
    /** The source package's id, named by the refusals. */
    sourcePackageId: string;
    /** The source's namespace; `''` when the source declares none and none derives. */
    sourceNamespace: string;
    /** The namespace every copied object name takes. Already judged by the caller's declaration. */
    targetNamespace: string;
    /** Every item the copy writes. */
    items: ReadonlyArray<NamespaceRenameItem>;
    /** The door's verb, for the remedy every refusal ends with ("then duplicate again"). */
    retryVerb: 'duplicate' | 'install';
}

/** One body, re-namespaced — or the reason it cannot be. */
export type NamespaceRewriteOutcome = { item: unknown } | { refusal: string };

/** The rename a copy applies, planned once over every item. */
export interface NamespaceRename {
    readonly sourceNamespace: string;
    readonly targetNamespace: string;
    /** Every object the copy renames: source name → copy name. One-to-one. */
    readonly objectRenames: ReadonlyMap<string, string>;
    /**
     * Why an object cannot be copied — its copy name is claimed by another
     * object's copy or by an object the source holds — or `undefined`.
     */
    objectRefusal(name: string): string | undefined;
    /** The name an item is copied under. */
    copyName(type: string, name: string): string;
    /**
     * Why an item's copy name cannot be stored — it breaks the item-name
     * grammar, or the storage identifier limit (an object's name is its table
     * name) — or `undefined`. Asked by the unmanaged import, which refuses
     * before any write; ⛔ not by the duplicate, whose door this card does not
     * narrow.
     */
    copyNameRefusal(type: string, name: string): string | undefined;
    /**
     * The body as the copy writes it: every name the copy renames rewritten,
     * `name` set to {@link copyName}, a permission set's field-rule keys
     * following the renamed objects — or the collision that refuses it.
     * `item` is the body converted to today's protocol; `name` is its SOURCE
     * name.
     */
    rewrite(type: string, name: string, item: unknown): NamespaceRewriteOutcome;
}

/**
 * The platform-reserved namespaces (`ManifestSchema.namespace`'s rule:
 * "Platform-reserved namespaces: "base", "system", "sys""), which many
 * packages share, so none can carry one copy's names. Asked by the unmanaged
 * import's `targetNamespace`.
 */
export const PLATFORM_RESERVED_NAMESPACES: ReadonlySet<string> = new Set(['base', 'system', 'sys']);

/**
 * [#30794] The storage identifier limit an OBJECT name meets: an object name is
 * its table name (Prime Directive #6), and Postgres keeps 63 bytes of an
 * identifier (MySQL 64), so a longer copy name is cut there and two copied
 * tables can land on one. Object names are ASCII (`/^[a-z_][a-z0-9_]*$/`), so
 * characters are bytes.
 */
export const OBJECT_TABLE_IDENTIFIER_LIMIT = 63;

/**
 * [#30794] The storage limit EVERY item name meets: the width of the
 * `sys_metadata.name` column that stores it, read off its declaration — the
 * column the record validator refuses a longer value at.
 */
export const METADATA_ITEM_NAME_STORAGE_LIMIT: number =
    (SysMetadataObject.fields as Record<string, { maxLength?: number }>).name?.maxLength ?? 255;

/** A `view` row whose name is qualified `<object>.<viewKey>` (`ViewItemNameSchema`). */
function isQualifiedViewName(type: string, name: unknown): name is string {
    return (PLURAL_TO_SINGULAR[String(type)] ?? String(type)) === 'view'
        && typeof name === 'string' && name.includes('.');
}

/** A body's `fields` record keys, when it has one. */
function fieldKeysOf(body: unknown): string[] {
    const fields = (body as { fields?: unknown } | null | undefined)?.fields;
    return fields && typeof fields === 'object' && !Array.isArray(fields) ? Object.keys(fields) : [];
}

/**
 * Plan the rename of one package into `targetNamespace`, over every item the
 * copy writes. Pure: the same input answers the same rename.
 */
export function planNamespaceRename(input: NamespaceRenameInput): NamespaceRename {
    const { sourcePackageId, sourceNamespace: sourceNs, targetNamespace: targetNs, items } = input;
    const again = `then ${input.retryVerb} again`;

    // Rows other than objects and qualified view items (each below) are
    // renamed by the source-prefix swap alone; a name without the prefix
    // keeps it (the docblock re-namespaces OBJECT names).
    const renameName = (name: string): string =>
        sourceNs && typeof name === 'string' && name.startsWith(`${sourceNs}_`)
            ? `${targetNs}_${name.slice(sourceNs.length + 1)}`
            : name;

    // ⭐ EVERY OBJECT GETS A NAME IN THE TARGET NAMESPACE (ADR-0070 D4, read
    // with ADR-0129 D2). An object name IS its table name and its registry
    // key, so a copy that keeps the source's name is a second claim on the
    // source's object: before PR #23510 it stored a target row the registry
    // refused, over the source's table, and after it the copy failed with
    // the ADR-0029 D9.9 ownership prescription, which names no way out for
    // a duplicate. ADR-0129 D2 says what the name is: every object a
    // package defines is `${namespace}_${shortName}`, and the prefix rule's
    // own prescription for a name that lacks the prefix
    // (`validateObjectNamespacePrefix`) is "rename it to
    // `${namespace}_${name}`". The copy is a NEW object, so that rename
    // costs nothing here — while renaming the SOURCE object would move its
    // table. A prefixed name swaps the source prefix for the target's;
    // a name WITHOUT the source prefix (a direct-publish save stored
    // before that door read the prefix rule — #24547 — or a package that
    // had no namespace) takes the target prefix in front of its whole name.
    //
    // ⛔ REFUSED, NEVER RE-INVENTED: when that name is already claimed — by
    // the copy of a prefixed sibling (`ticket` and `iojn_ticket` both name
    // `iojn2_ticket`) or by an object the source package holds — the object
    // is refused before anything is written for it, at its own name, with
    // the rename that clears it. A second invented name (a numeric suffix, a
    // third prefix) would be a name nobody wrote.
    const objectNames = new Set<string>(
        items.filter((item) => item?.type === 'object' && typeof item.name === 'string').map((item) => item.name),
    );
    const renameMap = new Map<string, string>();
    const prefixed: string[] = [];
    const unprefixed: string[] = [];
    for (const name of objectNames) {
        if (sourceNs && name.startsWith(`${sourceNs}_`)) prefixed.push(name);
        else unprefixed.push(name);
    }
    for (const name of prefixed) {
        const nn = renameName(name);
        if (nn !== name) renameMap.set(name, nn);
    }
    // Every name a prefixed object's copy takes (itself, when the target
    // namespace IS the source's), and every name the source holds.
    const claimedBy = new Map<string, string>(prefixed.map((name) => [renameName(name), name]));
    const refusedObjects = new Map<string, string>();
    for (const name of unprefixed) {
        const nn = `${targetNs}_${name}`;
        const holder = claimedBy.get(nn) ?? (objectNames.has(nn) ? nn : undefined);
        if (holder !== undefined) {
            const lacks = sourceNs
                ? `lacks the '${sourceNs}_' prefix of package '${sourcePackageId}' (ADR-0129 D2: `
                    + 'every object a package defines carries its namespace as a name prefix)'
                : `carries no namespace prefix (package '${sourcePackageId}' declares no namespace)`;
            const taken = holder === nn
                ? `'${nn}' is an object package '${sourcePackageId}' already holds`
                : `'${nn}' is already the copy name of object '${holder}'`;
            refusedObjects.set(
                name,
                `Object '${name}' is not copied: its name ${lacks}, so its copy is named '${nn}' in `
                    + `namespace '${targetNs}', and ${taken}. Rename '${name}' on the source to `
                    + `${sourceNs ? `a '${sourceNs}_' name` : 'a name'} no other object in the package uses, `
                    + `${again}.`,
            );
            continue;
        }
        renameMap.set(name, nn);
        claimedBy.set(nn, name);
    }

    // Longest-first, identifier-boundary rewrite so `iojn_task` never corrupts
    // `iojn_task_log`, and `iojn_x` inside `record.iojn_x`/`iojn_x.view` matches.
    // Prefixed names only: a prefixed name is distinctive enough to find in
    // free text, a bare one is not (below).
    //
    // ⭐ THE BOUNDARY HOLDS ON BOTH SIDES. With the right side alone, a
    // name that merely ENDS in an object's name was rewritten inside it:
    // the field `x_iojn_task` came out `x_iojn2_task` — its `name` and every
    // value naming it — while its `fields` key stayed, so the copy's key
    // and `name` disagreed. `x_iojn_task` is another identifier, never the
    // object: `renameName` swaps the source prefix only at the START of a
    // name, and this rewrite now matches only a whole identifier too.
    //
    // ⭐ A PREFIXED NAME THAT IS ALSO A FIELD KEY IS NOT DISTINCTIVE. When a
    // package object declares a field keyed like a prefixed package object
    // (`fields.iojn_customer` beside the object `iojn_customer`), a free-text
    // value spelled that way may name the field — a list view's `columns`,
    // a form's `sections[].fields` — and the field keeps its key. Renaming
    // it as the object copied a column or form field the copy does not
    // have. Such a name is treated as a bare name is: rewritten only at an
    // object-reference property (below), never in free text.
    const fieldKeys = new Set<string>();
    for (const item of items) {
        if (item?.type !== 'object') continue;
        for (const key of fieldKeysOf(item.body)) fieldKeys.add(key);
    }
    const olds = prefixed
        .filter((name) => renameMap.has(name) && !fieldKeys.has(name))
        .sort((a, b) => b.length - a.length);
    const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = olds.length
        ? new RegExp(`(?<![A-Za-z0-9_])(${olds.map(esc).join('|')})(?![A-Za-z0-9_])`, 'g')
        : null;
    // ⭐ A VIEW ITEM'S NAME FOLLOWS ITS OBJECT. A view row's qualified name
    // is `<object>.<viewKey>` (`ViewItemNameSchema`,
    // `packages/spec/src/ui/view.zod.ts`: "the object can be recovered from
    // the prefix, so the registry key never collides across objects"), so
    // its object part takes exactly the rename its `object` property takes
    // — `renameMap`, whole — and its view key is left as stored:
    // `ticket.board` copies as `iojn2_ticket.board` beside the body's
    // `object: 'iojn2_ticket'`. The source-prefix swap (`renameName`)
    // reached a prefixed object's items only: a bare object's item kept
    // `ticket.board`, a name the source's item still holds, so a by-name
    // read naming no package served the source and the copy was shadowed.
    // The swap also moved an item of an object OUTSIDE the package that
    // carries the source prefix (`iojn_ext.board` → `iojn2_ext.board`)
    // while its `object` stayed `iojn_ext`. An object this copy does not
    // rename keeps its items' names.
    //
    // A value that IS such a name, whole, follows the item: a form action's
    // `target` (`<object>.<viewKey>`) kept `ticket.entry`, so the copy's
    // button opened the SOURCE's form, on the source's object. Whole values
    // only, and only names of the view items this copy renames — a bare
    // object's name is never rewritten inside free text (below).
    const qualifiedViewCopyName = (name: string): string => {
        const dot = name.indexOf('.');
        const renamed = renameMap.get(name.slice(0, dot));
        return renamed !== undefined ? `${renamed}${name.slice(dot)}` : name;
    };
    const viewItemRenames = new Map<string, string>();
    for (const item of items) {
        if (!isQualifiedViewName(item?.type, item?.name)) continue;
        const renamed = qualifiedViewCopyName(item.name);
        if (renamed !== item.name) viewItemRenames.set(item.name, renamed);
    }
    // ⭐ AT AN OBJECT-REFERENCE PROPERTY, A NAME IS REWRITTEN WHOLE — the
    // only place a BARE name is rewritten. Measured: putting `ticket` in the
    // free-text rewrite above turns "A support ticket raised by a customer"
    // into "A support iojn2_ticket raised …", and the same match renames the
    // value of a lookup FIELD called `ticket` (`fields.ticket.name`). So a
    // value is rewritten only where it sits under a property that names an
    // object — the derived site index (`REFERENCE_SITES`, target `object`:
    // `reference`, `object`, `objectName`, `objects`, …), read by property
    // wherever it occurs in any item, because flow node configs (`config.
    // objectName`) are declared by node descriptors the index does not
    // walk — and only when it equals a renamed name exactly, in the four
    // shapes a name arrives in there: a string, an array element, a record
    // KEY (`permission.objects` is keyed by object name) or a `.name`. The
    // record key holds for prefixed names too: a copied permission set
    // otherwise kept `objects.<source object>`, a grant on the SOURCE.
    //
    // ⛔ REFUSED, NEVER MERGED: at a reference site, a renamed name can
    // meet a name the item already holds there — the source also names
    // the object the copy is about to be called (`dupdst_customer`, an
    // object outside the package or not yet created) beside its own
    // (`dupsrc_customer`). Two record KEYS that land on one key keep only
    // the last entry: a permission set's `objects` dropped a grant (and
    // the copied object could gain edit and delete its source never gave
    // it), a translation's `objects` dropped a label. Two array ELEMENTS
    // that land on one name bind it twice: a hook's handler ran twice per
    // event on the copied object. So every such meeting is recorded in
    // `collisions` — the path, the name that moved, the name it met — and
    // the item is refused before anything is written for it. `renameMap` is
    // one-to-one, so a meeting is always a renamed name and a name this copy
    // does not rename; an element the source itself repeats is copied as
    // stored.
    const objectReferenceProperties = new Set(
        (REFERENCE_SITES.byTarget.get('object') ?? []).map((site) => site.property),
    );
    type ReferenceCollision = { at: string; shape: 'key' | 'entry'; moved: string; met: string };
    const deepRewrite = (v: any, collisions: ReferenceCollision[], atReference = false, at = ''): any => {
        if (typeof v === 'string') {
            const whole = atReference ? renameMap.get(v) : undefined;
            if (whole !== undefined) return whole;
            const viewItem = viewItemRenames.get(v);
            if (viewItem !== undefined) return viewItem;
            return re ? v.replace(re, (m) => renameMap.get(m) ?? m) : v;
        }
        if (Array.isArray(v)) {
            const out = v.map((element, i) => deepRewrite(element, collisions, atReference, `${at}[${i}]`));
            if (atReference) {
                const firstAt = new Map<string, number>();
                out.forEach((element, i) => {
                    if (typeof element !== 'string') return;
                    const j = firstAt.get(element);
                    if (j === undefined) {
                        firstAt.set(element, i);
                    } else if (v[j] !== v[i]) {
                        collisions.push({ at, shape: 'entry', moved: v[i] !== element ? v[i] : v[j], met: element });
                    }
                });
            }
            return out;
        }
        if (v && typeof v === 'object') {
            const o: any = {};
            const from = new Map<string, string>();
            for (const [k, val] of Object.entries(v)) {
                const key = atReference ? (renameMap.get(k) ?? k) : k;
                const other = from.get(key);
                if (other !== undefined) {
                    collisions.push({ at, shape: 'key', moved: key === k ? other : k, met: key });
                }
                from.set(key, k);
                const entry = deepRewrite(
                    val, collisions,
                    objectReferenceProperties.has(k) || (atReference && k === 'name'),
                    at ? `${at}.${k}` : k,
                );
                // ⭐ A RECORD ENTRY'S `name` FOLLOWS ITS KEY. An entry that
                // echoes its key in `name` (an object's field: `fields`
                // keyed by field name) is ONE identity spelled twice, so
                // the name takes the key's rename decision. Outside a
                // reference site a key is never renamed, while the
                // free-text rewrite above renamed a `name` equal to a
                // prefixed object's: the field `iojn_customer` was copied
                // as `fields.iojn_customer.name: 'iojn2_customer'`. The
                // data plane addresses the column by the key, the save
                // door's FLS lint reads the `name`, so a copied permission
                // set's rule on that field was refused at the copy.
                if (typeof (val as any)?.name === 'string' && (val as any).name === k
                    && entry && typeof entry === 'object' && !Array.isArray(entry)) {
                    entry.name = key;
                }
                o[key] = entry;
            }
            return o;
        }
        return v;
    };
    const describeCollision = (c: ReferenceCollision): string =>
        `its \`${c.at}\` ${c.shape} '${c.moved}' follows the copied object to '${c.met}', `
        + `${c.shape === 'key' ? 'a key' : 'an entry'} it already holds there, which this copy does not rename. `
        + (c.shape === 'key'
            ? 'A record keeps one entry per key, so the copy would drop one of the two. '
            : `The copy would name '${c.met}' twice. `)
        + `Remove '${c.moved}' or '${c.met}' on the source, ${again}.`;
    // ⭐ A COPIED PERMISSION SET'S FIELD RULES FOLLOW THE RENAMED OBJECTS.
    // `PermissionSetSchema.fields` is a record keyed `<entity_name>.<field_name>`
    // (`packages/spec/src/security/permission.zod.ts`), and the security
    // plugin reads a set's rules for an object by the key prefix
    // `<object>.` (`PermissionEvaluator.getFieldPermissions`). Left as
    // stored, the copy's rules govern the SOURCE's object and the
    // duplicate's object gets none: a field the source set hides is
    // readable on the copy for whoever holds the copied set.
    //
    // `deepRewrite` cannot carry it: the derived site index reads
    // `permission.fields` as a site naming `field` items (its property
    // spells that type), never an object, and has no arm for a composite
    // key — and widening the index would also change the "Used by" answer
    // it feeds (`findReferencesToMeta`). So this step is keyed on the
    // declared shape — the `fields` record of a copied `permission` item —
    // never on a property name, which would also catch an object's own
    // `fields` (keyed by field name).
    //
    // The split: object and field names are both `^[a-z_][a-z0-9_]*$`, so
    // a key's object part is everything before its FIRST `.`. It is
    // rewritten only when it equals a renamed object name exactly, and the
    // field part is never read — `dupsrc_customer.dupsrc_customer` becomes
    // `dupdst_customer.dupsrc_customer`. A key naming an object outside the
    // package keeps its name.
    //
    // ⛔ REFUSED, NEVER MERGED: when a renamed key equals a key the set
    // already holds (the source also governs an object, outside the
    // package, named like the copy), keeping either rule would silently
    // drop the other, so the set is refused with both keys.
    // `Object.fromEntries` defines own properties, so no key can land on
    // the prototype.
    const rewriteFieldRuleKeys = (fields: Record<string, unknown>): { fields: Record<string, unknown> } | { collision: string } => {
        const out = new Map<string, unknown>();
        const from = new Map<string, string>();
        for (const [key, rule] of Object.entries(fields)) {
            const dot = key.indexOf('.');
            const renamed = dot > 0 ? renameMap.get(key.slice(0, dot)) : undefined;
            const next = renamed === undefined ? key : `${renamed}${key.slice(dot)}`;
            const other = from.get(next);
            if (other !== undefined) {
                const moved = next === key ? other : key;
                return {
                    collision: `its field rule '${moved}' follows object '${moved.slice(0, moved.indexOf('.'))}' `
                        + `to '${next}', a key the set already holds for object `
                        + `'${next.slice(0, next.indexOf('.'))}', which this copy does not rename. `
                        + `Remove '${moved}' or '${next}' on the source, ${again}.`,
                };
            }
            out.set(next, rule);
            from.set(next, key);
        }
        return { fields: Object.fromEntries(out) };
    };

    const copyName = (type: string, name: string): string =>
        type === 'object'
            ? (renameMap.get(name) ?? name)
            : isQualifiedViewName(type, name)
                ? qualifiedViewCopyName(name)
                : renameName(name);

    const nounOf = (type: string): string => {
        const singular = PLURAL_TO_SINGULAR[String(type)] ?? String(type);
        return singular === 'permission'
            ? 'Permission set'
            : `${singular.charAt(0).toUpperCase()}${singular.slice(1)}`;
    };

    return {
        sourceNamespace: sourceNs,
        targetNamespace: targetNs,
        objectRenames: renameMap,
        objectRefusal: (name) => refusedObjects.get(name),
        copyName,
        copyNameRefusal(type, name) {
            const next = copyName(type, name);
            if (next === name) return undefined;
            const noun = nounOf(type);
            const remedy = `Name a shorter \`targetNamespace\`, or shorten '${name}' on the source, ${again}.`;
            if (!METADATA_ITEM_NAME_PATTERN.test(next)) {
                return `${noun} '${name}' is not copied: its copy name '${next}' in namespace '${targetNs}' is not a `
                    + 'legal metadata item name (lowercase snake_case segments, joined by dots). '
                    + `Rename '${name}' on the source, ${again}.`;
            }
            if (type === 'object' && next.length > OBJECT_TABLE_IDENTIFIER_LIMIT) {
                return `${noun} '${name}' is not copied: its copy name '${next}' in namespace '${targetNs}' is `
                    + `${next.length} characters, over the ${OBJECT_TABLE_IDENTIFIER_LIMIT}-character storage `
                    + 'identifier limit of the table an object name names. ' + remedy;
            }
            if (next.length > METADATA_ITEM_NAME_STORAGE_LIMIT) {
                return `${noun} '${name}' is not copied: its copy name '${next}' in namespace '${targetNs}' is `
                    + `${next.length} characters, over the ${METADATA_ITEM_NAME_STORAGE_LIMIT}-character limit of `
                    + 'the column that stores an item name. ' + remedy;
            }
            return undefined;
        },
        rewrite(type, name, item) {
            const singular = PLURAL_TO_SINGULAR[String(type)] ?? String(type);
            const collisions: ReferenceCollision[] = [];
            const rewritten = deepRewrite(item, collisions);
            if (collisions.length > 0) {
                const more = collisions.length - 1;
                return {
                    refusal: `${nounOf(type)} '${name}' is not copied: ${describeCollision(collisions[0]!)}`
                        + (more > 0 ? ` It has ${more} more such collision${more === 1 ? '' : 's'}.` : ''),
                };
            }
            if (rewritten && typeof rewritten === 'object' && !Array.isArray(rewritten)) {
                rewritten.name = copyName(type, name);
                if (singular === 'permission' && rewritten.fields
                    && typeof rewritten.fields === 'object' && !Array.isArray(rewritten.fields)) {
                    const result = rewriteFieldRuleKeys(rewritten.fields);
                    if ('collision' in result) {
                        return { refusal: `Permission set '${name}' is not copied: ${result.collision}` };
                    }
                    rewritten.fields = result.fields;
                }
            }
            return { item: rewritten };
        },
    };
}
