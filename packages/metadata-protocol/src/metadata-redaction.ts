// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8154] The metadata READ path's per-type credential redaction — and the
 * WRITE path's inverse, without which the redaction is a data-loss bug.
 *
 * ## What this module is, and what it deliberately is not
 *
 * It is the CONSUMER of the `@objectstack/spec/kernel` redactor registry
 * (`registerMetadataTypeRedactor` / `getMetadataTypeRedactor`, #8300). It holds
 * no opinion about what a credential is: `datasource` is that registry's first
 * entry, SSO is expected to be its second, and this module never names either.
 * A datasource-shaped patch here would be the narrow fix that leaves the next
 * type exposed, which is the thing #8154 was filed to prevent.
 *
 * ## Ordering: `_diagnostics` BEFORE redaction — load-bearing, measured
 *
 * Diagnostics MUST be computed on the RAW stored body. Computing them on the
 * redacted body flips `valid:false` to `valid:true` for exactly the rows that
 * hold a stored cleartext credential, which destroys the `#8081` item-3
 * operator inventory — the `valid:false` badge is the only enumeration path an
 * operator has for "which rows still need migrating". That is why the
 * composition lives inside {@link decorateMetadataItem} (see
 * `metadata-diagnostics.ts`) rather than at each read exit: an ordering a call
 * site can invert is an ordering that gets inverted.
 *
 * ## The write-path inverse ({@link carryForwardRedactedValues})
 *
 * A read scrub with no inverse is a data-loss bug, not a fix. Measured on
 * `origin/main` before this change: `saveMetaItem` ACCEPTS a redacted
 * datasource body and persists the credential away, so read-redaction alone
 * converts today's loud `422` into SILENT credential deletion on an ordinary
 * `/meta` GET → edit → PUT round trip.
 *
 * `config.url` is what makes the inverse unavoidable rather than a masking
 * choice: a URL-embedded password is schema-ACCEPTED (#8078 pinned that
 * boundary as fact), so dropping it round-trips to deletion and masking it
 * round-trips to storing the mask as the literal password. Neither is a
 * survivable read shape; carrying the stored value forward is.
 *
 * This is the generic form of the carry-forward PR #8126 added to
 * `DatasourceAdminService.updateDatasource`, and it mirrors that function's
 * rule exactly: **stored material is carried forward ONLY where the incoming
 * body is indistinguishable from what the read path served.** Anything the
 * author actually wrote wins, and is judged on its own merits by the schema
 * gate — a caller that types `password` into a config still gets #8078's
 * refusal.
 *
 * ⛔ It does NOT create cleartext, and does not migrate it out either: it
 * preserves what is already at rest. Getting stored cleartext OUT of the store
 * is #8081 item 3's migration and is deliberately not attempted here.
 *
 * ## Why nothing is stamped on the wire
 *
 * {@link MetadataRedactionResult} carries `redactedKeys`, and the registry's
 * own docblock argues for serving it beside the item so a caller knows a
 * credential is being withheld rather than inferring it from an absence. This
 * module deliberately does NOT stamp it. A new served key is a READ DECORATION,
 * and the list of those lives in `spec/kernel/metadata-read-decorations.ts`
 * (`METADATA_READ_DECORATIONS`) — which `stripReadDecorations` uses to take
 * them back off on write. Stamping a key that is not on that list would push it
 * through the ordinary GET → edit → PUT round trip and into a CLOSED schema
 * (#4001), so every legacy datasource save would fail with
 * `unrecognized_keys` naming a key the author never wrote — the "error the
 * author cannot act on" shape PR #8126 already had to repair once. The key
 * belongs on that list first; that file is `packages/spec`'s to change.
 */

import { getMetadataTypeRedactor } from '@objectstack/spec/kernel';
import type { MetadataTypeRedactor } from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';

/**
 * Resolve the redactor for a request-shaped type name.
 *
 * The read exits are reached with either spelling (`GET /api/v1/meta/datasources`
 * arrives as `datasources`), while the registry is keyed by the SINGULAR
 * metadata type name (Prime Directive #3). Normalised here through the same
 * `PLURAL_TO_SINGULAR` map `computeMetadataDiagnostics` uses, so a plural read
 * and a singular read cannot disagree about whether a credential is withheld.
 */
function redactorFor(type: string): MetadataTypeRedactor | undefined {
    return getMetadataTypeRedactor(PLURAL_TO_SINGULAR[type] ?? type);
}

/**
 * Whether any redactor is registered for `type`.
 *
 * Lets a caller skip work — notably the extra stored-row read the write-path
 * carry-forward needs — for the overwhelming majority of types that hold no
 * secret, without having to know which types those are.
 */
export function hasMetadataRedactor(type: string): boolean {
    return redactorFor(type) !== undefined;
}

/**
 * Apply the type's read-path redactor to one served metadata body.
 *
 * Returns the input BY REFERENCE when no redactor is registered, when the input
 * is not a plain object, or when the redactor found nothing to hide — so the
 * common path allocates nothing and the stored record a caller may still be
 * holding is never mutated.
 *
 * ⛔ A throwing redactor is NOT swallowed. A redactor is contractually pure and
 * must not throw; if one does, the choice is between a loud failed read and
 * serving the cleartext this function exists to withhold. Failing closed is the
 * only defensible answer for a security control ("Absence must be loud" —
 * AGENTS.md Route & surface ownership §3), and a `catch` here would produce
 * precisely the outcome #8300's own header calls the worst available one: a
 * redaction that looks installed but is not applied.
 */
export function redactMetadataItem<T>(type: string, item: T): T {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const redactor = redactorFor(type);
    if (!redactor) return item;
    const result = redactor(item as Record<string, unknown>);
    if (!result || result.redactedKeys.length === 0) return item;
    return (result.item ?? item) as T;
}

/**
 * {@link redactMetadataItem} over a list. Non-array inputs and non-object
 * elements pass through unchanged, matching the defensive "items may be a
 * wrapped or naked array" contract the read exits already document.
 */
export function redactMetadataItems<T>(type: string, items: T[]): T[] {
    if (!Array.isArray(items)) return items;
    const redactor = redactorFor(type);
    if (!redactor) return items;
    return items.map((item) => redactMetadataItem(type, item));
}

/**
 * Walk to the plain object that OWNS the last segment of `segments`.
 *
 * `undefined` when any hop along the way is absent or is not a plain object —
 * which the caller must read as "this body does not speak to that path at all",
 * never as "the value is absent". The distinction is the whole guard: a PUT
 * body carrying no `config` key is an author removing the container, and
 * grafting `config.password` back onto it would MINT a config that holds
 * nothing but a credential.
 */
function containerAt(root: unknown, segments: string[]): Record<string, unknown> | undefined {
    let node: unknown = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
        node = (node as Record<string, unknown>)[segments[i] as string];
    }
    if (!node || typeof node !== 'object' || Array.isArray(node)) return undefined;
    return node as Record<string, unknown>;
}

/**
 * Copy-on-write set of `value` at `segments`, returning a new root and copying
 * only the containers along the path.
 *
 * The incoming request body belongs to the caller (`saveMetaItem` hands the
 * same object to the audit trail and the registry write-through), so the
 * carry-forward must not mutate it in place.
 */
function withValueAt(
    root: Record<string, unknown>,
    segments: string[],
    value: unknown,
): Record<string, unknown> {
    const [head, ...rest] = segments as [string, ...string[]];
    const next: Record<string, unknown> = { ...root };
    if (rest.length === 0) {
        next[head] = value;
        return next;
    }
    next[head] = withValueAt(root[head] as Record<string, unknown>, rest, value);
    return next;
}

/** Structural equality for the values a redactor hides (scalars in practice; general by construction). */
function sameValue(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        // NaN is the one primitive `===` disagrees with itself about.
        return Number.isNaN(a as number) && Number.isNaN(b as number);
    }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        return a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
    }
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && sameValue(ao[k], bo[k]));
}

/**
 * The write-path inverse of {@link redactMetadataItem}: re-apply the material
 * the read path withheld, wherever the incoming body is indistinguishable from
 * what was served.
 *
 * The decision is made per redacted PATH, and only three things can happen:
 *
 *  - the incoming value at that path equals what the read served ⇒ the author
 *    is round-tripping something they were never shown, so the stored value is
 *    carried forward;
 *  - the incoming value differs ⇒ the author spoke, and their word wins
 *    verbatim (a typed-in `password` is then refused by #8078's write gate on
 *    its own merits — this function never launders one past it);
 *  - the incoming body has no container for that path at all ⇒ nothing is
 *    grafted, because a removed container is also the author's word.
 *
 * ⚠️ The first case is genuinely INDISTINGUISHABLE, not merely treated as
 * equal: an author who hand-deletes `:password` from a URL sends exactly the
 * bytes the redaction served, and this function restores the stored password.
 * The wire carries nothing that separates the two intents, so this is a
 * deliberate choice of the safe side — preserving a credential an operator may
 * still depend on, over silently destroying one. The same ambiguity exists in
 * `restoreRedactedConfig`, and clearing a credential on purpose has an
 * unambiguous door: change it, or delete the row.
 *
 * @param type     request-shaped metadata type (plural or singular).
 * @param incoming the body about to be persisted.
 * @param stored   the body currently at rest, RAW (never a served copy).
 */
export function carryForwardRedactedValues<T>(type: string, incoming: T, stored: unknown): T {
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return incoming;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return incoming;
    const redactor = redactorFor(type);
    if (!redactor) return incoming;

    // What a read exit WOULD have served for the row at rest. Computed from the
    // stored body rather than remembered from a response, so the comparison
    // holds for any caller — Studio, the CLI, a raw `curl` — and needs no
    // session state.
    const served = redactor(stored as Record<string, unknown>);
    if (served.redactedKeys.length === 0) return incoming;

    let out = incoming as unknown as Record<string, unknown>;
    for (const path of served.redactedKeys) {
        // Dotted, item-relative — the registry's documented contract for
        // `redactedKeys` (`config.password`).
        const segments = path.split('.');
        const key = segments[segments.length - 1] as string;

        const storedParent = containerAt(stored, segments);
        const storedValue = storedParent?.[key];
        if (storedValue === undefined) continue;

        const incomingParent = containerAt(out, segments);
        if (!incomingParent) continue;

        const servedParent = containerAt(served.item, segments);
        if (!sameValue(incomingParent[key], servedParent?.[key])) continue;

        out = withValueAt(out, segments, storedValue);
    }
    return out as unknown as T;
}
