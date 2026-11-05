// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The served override of a base package's name (ADR-0146 D8 item 2)
 *
 * An installed base package X (HotCRM) ships an item under a name. The
 * customer's change to that item is an item of X's paired writable package
 * `<X>.custom` (ADR-0146 D3) that bears the same name and declares, in its own
 * body, `overrides: { package: X, basedOn }` (ADR-0146 D2). Every read that
 * serves X's name — the read naming no package, the read naming X, the
 * layered read's `effective`, the list scoped to X or to no package, and X's
 * app — serves that one document over X's (D8 item 2, read as the #28390
 * ruling A text: "the `.custom` item that declares it").
 *
 * {@link isServedOverrideRowOf} is the ONE spelling of "is this stored row the
 * served override of X's name". The effective read asks it
 * (`servedOverlayRowCandidates` in `protocol.ts`), and so do the cards that
 * follow it — the flow override, the per-package customization read and the
 * migration of package-less overlay rows (ADR-0146 Rollout, N-11, N-15, N-16).
 * ⛔ No second predicate: a door that re-derived it could serve a row this one
 * refuses, and the five reads would disagree again.
 *
 * ## What it judges, and what it never reads
 *
 *  - **The row's own binding** — its `package_id` column — must be X's pair,
 *    `isCustomizationPairOf(package_id, X)` from `@objectstack/spec`, the one
 *    spelling of the `.custom` suffix (N-08). ⛔ Never a body stamp: a stored
 *    body can carry a `_packageId` copied from a read of the base, and that
 *    copy names the base while the row belongs to another package (the shape
 *    #28238 measured). A declaration from any package that is not X's pair —
 *    a partner's dependent package, another base's pair — is ignored here: the
 *    write gate refuses it at publish (N-09), and this predicate is the read's
 *    second line of defence behind that gate.
 *  - **The declaration** — the body's `overrides.package` must name X.
 *    `overrides.basedOn` is recorded and never judged (ADR-0146 D2).
 *  - **The type** — the row's type, folded to its canonical singular, must be
 *    one a declared override applies to (`isOverridableMetadataType`, the
 *    closed `OVERRIDE_TYPE_CLASSIFICATION`). An `object` is extended, never
 *    replaced (D10); a permission set, a position and a capability are one
 *    name per deployment (D6). A stored body of such a type that carries the
 *    key anyway is not an override, whatever its package.
 *
 * It does not judge whether a door may SERVE the override for a behavioural
 * type: `flow` and `action` wait for ADR-0146 D9's conditions, and the reads
 * that would serve a stored flow body over a shipped flow name decline it
 * before they ask this predicate (`declinesStoredRow`). Arming a flow override
 * is N-11's.
 *
 * Pure, synchronous and total: no I/O, no registry read, and `false` for any
 * input it cannot read as a declaring row. Whether the pair package is
 * INSTALLED is not its question.
 */

import { isCustomizationPairOf, isOverridableMetadataType } from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { storedRowDocument } from './item-lock.js';

/**
 * A stored `sys_metadata` row as {@link isServedOverrideRowOf} reads it: its
 * `type` and `package_id` columns, and its body (`metadata`) as stored — a
 * JSON string, or the document already parsed.
 */
export interface ServedOverrideRow {
    readonly type?: unknown;
    readonly package_id?: unknown;
    readonly metadata?: unknown;
}

/**
 * Whether `row` is the served override of `basePackageId`'s item of the row's
 * name: a row bound to the base's paired `<base>.custom` package by its own
 * `package_id`, of an overridable type, whose body declares
 * `overrides.package` = the base. See the module header for what it never
 * reads.
 *
 * | row | base | answer |
 * |:--|:--|:--|
 * | `view`, `package_id: 'hotcrm.custom'`, `overrides.package: 'hotcrm'` | `hotcrm` | `true` |
 * | the same row | `crm` | `false` — not that base's pair |
 * | `package_id: 'partner.ext'`, `overrides.package: 'hotcrm'` | `hotcrm` | `false` — not the pair (ruling A) |
 * | `package_id: 'hotcrm.custom'`, no `overrides` | `hotcrm` | `false` — undeclared |
 * | `package_id: null`, body `_packageId: 'hotcrm.custom'`, `overrides.package: 'hotcrm'` | `hotcrm` | `false` — a body stamp binds nothing |
 * | `object`, `package_id: 'hotcrm.custom'`, `overrides.package: 'hotcrm'` | `hotcrm` | `false` — extended, never replaced |
 */
export function isServedOverrideRowOf(row: ServedOverrideRow | null | undefined, basePackageId: unknown): boolean {
    if (row === null || row === undefined || typeof row !== 'object') return false;
    if (typeof basePackageId !== 'string' || basePackageId === '') return false;
    if (!isCustomizationPairOf(row.package_id, basePackageId)) return false;
    if (typeof row.type !== 'string' || !isOverridableMetadataType(PLURAL_TO_SINGULAR[row.type] ?? row.type)) {
        return false;
    }
    let body: unknown;
    try {
        body = storedRowDocument(row);
    } catch {
        // A body that is not JSON declares nothing. It is no read failure
        // either: the row was read, and the read that serves it parses it the
        // same way and answers that failure itself.
        return false;
    }
    if (body === null || typeof body !== 'object' || Array.isArray(body)) return false;
    const declaration = (body as { overrides?: unknown }).overrides;
    if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration)) return false;
    return (declaration as { package?: unknown }).package === basePackageId;
}

/**
 * [#30062] The base package a SERVED document is the declared override of, or
 * `undefined` — the read-side reading of the answer {@link isServedOverrideRowOf}
 * gave, never a second judgement of the row.
 *
 * Every read that serves a base's name from the pair's declaring row stamps
 * the document with the overridden base's envelope (`_packageId` =
 * `overrideOf`, `protocol-meta-item-reads.ts` and the list's slot), and the
 * body keeps the declaration it was saved with (`overrides.package`). The two
 * agree exactly on a document the reads served as the base's item from its
 * pair: a row bound anywhere else keeps its own column's binding
 * (`withRowBinding`), so a pair row that declares nothing reads the pair, a
 * package-less row reads no package, and a declaration naming some other
 * package never matches the envelope it is served under.
 *
 * | served document | type | answer |
 * |:--|:--|:--|
 * | `_packageId: 'hotcrm'`, `overrides.package: 'hotcrm'` | `page` | `'hotcrm'` |
 * | the same document | `object` | `undefined` — extended, never replaced (D10) |
 * | `_packageId: 'hotcrm.custom'`, `overrides.package: 'hotcrm'` | `page` | `undefined` — not served as the base's item |
 * | `_packageId: 'hotcrm'`, no `overrides` | `page` | `undefined` — the base's own item |
 * | no `_packageId`, `overrides.package: 'hotcrm'` | `view` | `undefined` — a package-less row |
 *
 * Pure, synchronous and total, as {@link isServedOverrideRowOf} is.
 */
export function servedOverrideBaseOf(type: unknown, document: unknown): string | undefined {
    if (typeof type !== 'string' || !isOverridableMetadataType(PLURAL_TO_SINGULAR[type] ?? type)) return undefined;
    if (document === null || typeof document !== 'object' || Array.isArray(document)) return undefined;
    const declaration = (document as { overrides?: unknown }).overrides;
    if (declaration === null || typeof declaration !== 'object' || Array.isArray(declaration)) return undefined;
    const base = (declaration as { package?: unknown }).package;
    if (typeof base !== 'string' || base === '') return undefined;
    return (document as { _packageId?: unknown })._packageId === base ? base : undefined;
}
