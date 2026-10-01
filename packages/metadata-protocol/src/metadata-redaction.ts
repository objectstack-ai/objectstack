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
// [#21120] The family-wide stored-metadata-body primitives — the object set,
// the object predicate, the column names and the body redactor — live in
// `@objectstack/spec/kernel`, reachable by every surface in the family
// (service-analytics, plugin-audit, the objectql engine) that does not depend
// on this package. The data-door wrappers below (`storedMetadataBodyProjection`,
// `redactStoredMetadataRow`'s `dropType`, `storedMetadataBodyGroupingRefusal`)
// are this package's own, built ON that one definition — never a second one.
import {
    isStoredMetadataBodyObject,
    redactStoredMetadataBody,
    STORED_METADATA_BODY_COLUMN,
    STORED_METADATA_TYPE_COLUMN,
} from '@objectstack/spec/kernel';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';

export { isStoredMetadataBodyObject };

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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** An element's identity for an array hop: a non-empty string `id`, or none. */
function identityOf(element: unknown): string | undefined {
    if (!isPlainRecord(element)) return undefined;
    const id = element.id;
    return typeof id === 'string' && id !== '' ? id : undefined;
}

/**
 * The ONE element of `array` whose identity is `elementId` — `undefined` when
 * none carries it or more than one does. Two elements sharing an id cannot be
 * told apart, so neither is chosen: guessing would graft a credential onto
 * whichever of the two happened to come first.
 */
function elementWithIdentity(
    array: readonly unknown[],
    elementId: string,
): { index: number; element: Record<string, unknown> } | undefined {
    let found: { index: number; element: Record<string, unknown> } | undefined;
    for (let index = 0; index < array.length; index += 1) {
        if (identityOf(array[index]) !== elementId) continue;
        if (found) return undefined;
        found = { index, element: array[index] as Record<string, unknown> };
    }
    return found;
}

/**
 * One container hop of a redacted path, resolved against the STORED body.
 *
 * A `redactedKeys` entry is dotted and item-relative, and a segment that lands
 * on an ARRAY is the element's index in the body the redactor was handed — the
 * row at rest (a flow's credential sits on `nodes.<i>.config`, #20552). An
 * index is a position, and a position is not an identity: an author who
 * reorders a flow's `nodes` sends the same start node back at another index,
 * and grafting by position would put its credential on whichever node now sits
 * where it used to. So an array hop is resolved ONCE, against the stored body,
 * into an identity, and every body — served and incoming — is then walked by
 * that identity, never by the index. Two kinds of identity:
 *
 *  - **the element's own `id`** (`{ elementId }`) — a flow node;
 *  - **for an element with no `id`, the identified element below it on the
 *    same path** (`{ anchor }`, #20590). A `parallel` block's branch carries no
 *    `id`, and a credential inside one sits at
 *    `nodes.<i>.config.branches.<b>.nodes.<j>.config.signingSecret`. The branch
 *    is the one element of `branches` whose own walk down the rest of the
 *    path reaches node `<j>`'s `id` — and a flow's node ids are one space
 *    across every region (`FlowSchema`), so at most one branch does. `anchor`
 *    is that walk: the hops from inside the element down to, and including,
 *    the first identified element beneath it.
 *
 * An array hop that reaches neither — an element with no `id` and no
 * identified element below it on the path, or an `id` shared with a sibling —
 * resolves to nothing, and the path is skipped.
 */
type PathHop =
    | { readonly key: string }
    | { readonly elementId: string }
    | { readonly anchor: readonly PathHop[] };

/**
 * Resolve every CONTAINER hop of `segments` (all but the last, which names the
 * redacted key itself) against `stored`. `undefined` when the stored body does
 * not reach that far, or an array hop has no identity — which the caller reads
 * as "nothing at rest to carry".
 */
function resolveHops(stored: unknown, segments: readonly string[]): PathHop[] | undefined {
    // First pass: key hops and `id` hops; `null` marks an element with no `id`.
    const found: Array<PathHop | null> = [];
    let node: unknown = stored;
    for (let i = 0; i < segments.length - 1; i += 1) {
        const segment = segments[i] as string;
        if (Array.isArray(node)) {
            if (!/^(0|[1-9][0-9]*)$/.test(segment)) return undefined;
            const element = node[Number(segment)];
            if (!isPlainRecord(element)) return undefined;
            const elementId = identityOf(element);
            if (elementId !== undefined && !elementWithIdentity(node, elementId)) return undefined;
            found.push(elementId === undefined ? null : { elementId });
            node = element;
            continue;
        }
        if (!isPlainRecord(node)) return undefined;
        found.push({ key: segment });
        node = node[segment];
    }
    // Second pass, from the end: anchor each id-less element on the first
    // identified element below it. The anchor may itself cross an id-less
    // element (a branch inside a branch), whose own anchor is already built.
    const hops: PathHop[] = new Array(found.length);
    let nextIdentified = -1;
    for (let i = found.length - 1; i >= 0; i -= 1) {
        const hop = found[i];
        if (hop === null) {
            if (nextIdentified < 0) return undefined;
            hops[i] = { anchor: hops.slice(i + 1, nextIdentified + 1) };
            continue;
        }
        hops[i] = hop as PathHop;
        if ('elementId' in (hop as PathHop)) nextIdentified = i;
    }
    return hops;
}

/**
 * Resolve ONE hop against `node`: the segment it stands for in THIS body (a
 * key, or the element's index here) and the value it leads to. `undefined`
 * when this body does not speak to the hop — the wrong kind of container, or
 * an array hop no single element answers (none does, or two do and cannot be
 * told apart: guessing would graft a credential onto whichever came first).
 */
function stepInto(node: unknown, hop: PathHop): { segment: string; next: unknown } | undefined {
    if ('key' in hop) {
        return isPlainRecord(node) ? { segment: hop.key, next: node[hop.key] } : undefined;
    }
    if (!Array.isArray(node)) return undefined;
    let index: number | undefined;
    for (let i = 0; i < node.length; i += 1) {
        const hit = 'elementId' in hop
            ? identityOf(node[i]) === hop.elementId
            : isPlainRecord(node[i]) && containerAt(node[i], hop.anchor) !== undefined;
        if (!hit) continue;
        if (index !== undefined) return undefined;
        index = i;
    }
    return index === undefined ? undefined : { segment: String(index), next: node[index] };
}

/**
 * Walk `hops` in `root`: the plain object that OWNS the redacted key, and the
 * concrete segments (a key, or an array index in THIS body) that reach it.
 *
 * `undefined` when any hop along the way is absent, is the wrong kind of
 * container, or (for an array hop) is answered by no single element — which
 * the caller must read as "this body does not speak to that path at all",
 * never as "the value is absent". The distinction is the whole guard: a PUT
 * body carrying no `config` key is an author removing the container, and
 * grafting `config.password` back onto it would MINT a config that holds
 * nothing but a credential.
 */
function locate(root: unknown, hops: readonly PathHop[]): { at: string[]; container: Record<string, unknown> } | undefined {
    const at: string[] = [];
    let node: unknown = root;
    for (const hop of hops) {
        const step = stepInto(node, hop);
        if (!step) return undefined;
        at.push(step.segment);
        node = step.next;
    }
    return isPlainRecord(node) ? { at, container: node } : undefined;
}

/** {@link locate}, container only. */
function containerAt(root: unknown, hops: readonly PathHop[]): Record<string, unknown> | undefined {
    return locate(root, hops)?.container;
}

/** The value `at` names in `root`; every segment resolves (it came from a walk of `root`). */
function valueAt(root: unknown, at: readonly string[]): unknown {
    let node: unknown = root;
    for (const segment of at) node = Array.isArray(node) ? node[Number(segment)] : (node as Record<string, unknown>)[segment];
    return node;
}

/**
 * [#20590 round 1] Where the redacted key's container sits in `root` when the
 * STORED path to it no longer resolves there — because the element that owns
 * it MOVED, keeping its identity: a flow node taken out of a `loop` body, or
 * put into a `parallel` branch, keeps its `id`, its kind and the withheld form,
 * and only the regions around it change. Skipping the graft there would drop
 * the stored credential at save, silently.
 *
 * The owner is the path's deepest identified element (its last `elementId`
 * hop). It is looked for by that `id` across the WHOLE body — but only among
 * the elements that stand where the owner stood: the elements of an array
 * held under the SAME key as the owner's own array in the stored path (for a
 * flow node that key is `nodes`, so a node at the top level or in any region
 * counts, and an edge or a config value that happens to carry the same `id`
 * does not — a flow keeps node ids and edge ids in separate spaces, #20590
 * round 2). The key is read from the stored hops, never named here. It is used
 * only when exactly ONE such element carries that `id` — none, and the author
 * removed it; two or more, and they cannot be told apart, so nothing is
 * chosen. Uniqueness across the whole body is what keeps this safe for a type
 * whose ids are not one space the way a flow's node ids are. From the owner,
 * the rest of the path is walked as usual (the key hops down to the container,
 * so an owner whose `config` the author removed still grafts nothing).
 *
 * An owner whose array is not held under a key — an array directly inside
 * another array — has no key to scope by, and is not relocated.
 *
 * A path with no identified element — every datasource path, whose redactor
 * never crosses an array — has no owner to find, and is unaffected.
 */
function relocateById(root: unknown, hops: readonly PathHop[]): { at: string[]; container: Record<string, unknown> } | undefined {
    let owner = -1;
    for (let i = hops.length - 1; i >= 0; i -= 1) {
        if ('elementId' in (hops[i] as PathHop)) {
            owner = i;
            break;
        }
    }
    if (owner < 1) return undefined;
    const id = (hops[owner] as { elementId: string }).elementId;
    // The key the owner's array is held under in the stored path.
    const parent = hops[owner - 1] as PathHop;
    if (!('key' in parent)) return undefined;
    const arrayKey = parent.key;

    const matches: string[][] = [];
    const visit = (node: unknown, at: string[]): void => {
        if (Array.isArray(node)) {
            node.forEach((value, index) => visit(value, [...at, String(index)]));
            return;
        }
        if (!isPlainRecord(node)) return;
        for (const [key, value] of Object.entries(node)) {
            if (!value || typeof value !== 'object') continue;
            if (key === arrayKey && Array.isArray(value)) {
                value.forEach((element, index) => {
                    if (isPlainRecord(element) && element.id === id) matches.push([...at, key, String(index)]);
                });
            }
            visit(value, [...at, key]);
        }
    };
    visit(root, []);
    if (matches.length !== 1) return undefined;

    const ownerAt = matches[0] as string[];
    const rest = locate(valueAt(root, ownerAt), hops.slice(owner + 1));
    return rest ? { at: [...ownerAt, ...rest.at], container: rest.container } : undefined;
}

/**
 * Copy-on-write set of `value` under `key` in the container `at` names,
 * returning a new root and copying only the containers along the way — an
 * array segment copies the array and replaces the one element it names.
 *
 * `at` came from a walk of `root`, so every segment resolves. The incoming
 * request body belongs to the caller (`saveMetaItem` hands the same object to
 * the audit trail and the registry write-through), so the carry-forward must
 * not mutate it in place.
 */
function withValueAt(root: unknown, at: readonly string[], key: string, value: unknown): unknown {
    if (at.length === 0) return { ...(root as Record<string, unknown>), [key]: value };
    const [head, ...rest] = at as [string, ...string[]];
    if (Array.isArray(root)) {
        const next = root.slice();
        next[Number(head)] = withValueAt(root[Number(head)], rest, key, value);
        return next;
    }
    const record = root as Record<string, unknown>;
    return { ...record, [head]: withValueAt(record[head], rest, key, value) };
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
 * A path through an ARRAY (a flow's start node, `nodes.<i>.config.secret`,
 * #20552) is walked by the stored element's `id`, not by its index, so a body
 * that reorders the array still carries the value onto the element it came
 * from — see {@link resolveHops}. An element with no `id` is walked by the
 * identified element below it on the same path (a `parallel` branch, by the
 * node inside it that holds the credential, #20590); one with neither, or an
 * `id` shared with a sibling, is never carried into.
 *
 * ⛔ A carried value never lands where the read would SERVE it (#20590). The
 * array hop follows an identity, while a redactor chooses what to withhold by
 * whatever rule it has — a flow's by the node's KIND — and the two can
 * disagree: an edit that keeps a node's `id` and changes its kind would have
 * the stored credential grafted onto a node the next read serves whole. So
 * the type's redactor is run over the grafted body, and a carried value whose
 * path it no longer withholds is dropped rather than persisted. Changing the
 * kind of the node that held a credential is the author's word about that
 * credential: it is gone, and a kind that needs one asks for it again (an
 * `api` flow's start node without a secret is refused at registration).
 *
 * A node MOVED across regions — out of a loop body, into a parallel branch —
 * keeps its identity while the stored path around it stops resolving. Its
 * container is then found by the owning element's `id` across the whole
 * incoming body, exactly one match or none ({@link relocateById}), and the
 * same position check decides whether the value lands: a moved node whose
 * kind still holds the credential keeps it; one moved AND changed in kind
 * does not.
 *
 * ⚠️ The first case is genuinely INDISTINGUISHABLE, not merely treated as
 * equal: an author who hand-deletes `:password` from a URL sends exactly the
 * bytes the redaction served, and this function restores the stored password.
 * The wire carries nothing that separates the two intents, so this is a
 * deliberate choice of the safe side — preserving a credential an operator may
 * still depend on, over silently destroying one. The same ambiguity exists in
 * `restoreRedactedConfig`, and clearing a credential on purpose has an
 * unambiguous door: change it, or delete the row — or, where the type's
 * redactor serves one value as written because it holds no credential, send
 * that value (a flow's empty string, #20590): it differs from the absent key
 * that was served, so it is the author's word and it wins.
 *
 * @param type     request-shaped metadata type (plural or singular).
 * @param incoming the body about to be persisted.
 * @param stored   the body currently at rest, RAW (never a served copy).
 */
export function carryForwardRedactedValues<T>(type: string, incoming: T, stored: unknown): T {
    return planCarryForward(type, incoming, stored).out;
}

/**
 * [#20611] WHERE {@link carryForwardRedactedValues} would restore a stored
 * value into `incoming` — the landing positions, dotted and relative to
 * `incoming` (`nodes.1.config.secret`: an array hop is the element's index in
 * THIS body, which is where the carried value lands), and never the values.
 *
 * The answer the runtime authoring gate is handed, because the gate runs
 * before the carry-forward on purpose — so that no gate handles a restored
 * credential — and without it cannot tell a credential the read withheld and
 * the row still holds from one that is missing. It is the SAME decision as the
 * carry-forward's, computed by the same plan: the three outcomes, the identity
 * walk, the relocation, the two-onto-one refusal and the position check that
 * drops a value the read would not withhold where it lands. A position this
 * returns is one the carry-forward fills; one it omits, the carry-forward
 * leaves as the author sent it.
 *
 * @param type     request-shaped metadata type (plural or singular).
 * @param incoming the body about to be persisted.
 * @param stored   the body currently at rest, RAW (never a served copy).
 */
export function redactedPathsCarriedForward(type: string, incoming: unknown, stored: unknown): string[] {
    return planCarryForward(type, incoming, stored).landed;
}

/**
 * The one decision behind {@link carryForwardRedactedValues} and
 * {@link redactedPathsCarriedForward}: the grafted body, and where each graft
 * landed. `landed` is empty exactly when `out` is `incoming` by reference.
 */
function planCarryForward<T>(type: string, incoming: T, stored: unknown): { out: T; landed: string[] } {
    const unchanged = { out: incoming, landed: [] as string[] };
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return unchanged;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return unchanged;
    const redactor = redactorFor(type);
    if (!redactor) return unchanged;

    // What a read exit WOULD have served for the row at rest. Computed from the
    // stored body rather than remembered from a response, so the comparison
    // holds for any caller — Studio, the CLI, a raw `curl` — and needs no
    // session state.
    const served = redactor(stored as Record<string, unknown>);
    if (served.redactedKeys.length === 0) return unchanged;

    const grafts: Array<{ at: string[]; key: string; value: unknown }> = [];
    for (const path of served.redactedKeys) {
        // Dotted, item-relative — the registry's documented contract for
        // `redactedKeys` (`config.password`; an array hop is an index into the
        // stored body, `nodes.0.config.secret`, resolved to an identity by
        // {@link resolveHops}).
        const segments = path.split('.');
        const key = segments[segments.length - 1] as string;
        const hops = resolveHops(stored, segments);
        if (!hops) continue;

        const storedParent = containerAt(stored, hops);
        const storedValue = storedParent?.[key];
        if (storedValue === undefined) continue;

        // Where the container sits in the incoming body: along the stored
        // path, or — the node that owns it having MOVED — at the one element
        // anywhere in the body that carries the owner's id (#20590 round 1).
        const target = locate(incoming, hops) ?? relocateById(incoming, hops);
        if (!target) continue;

        const servedParent = containerAt(served.item, hops);
        if (!sameValue(target.container[key], servedParent?.[key])) continue;

        grafts.push({ at: target.at, key, value: storedValue });
    }

    // Two stored paths landing on ONE incoming position cannot be told apart;
    // neither is carried rather than one silently overwriting the other.
    const landing = (graft: { at: readonly string[]; key: string }) => [...graft.at, graft.key].join('.');
    const counts = new Map<string, number>();
    for (const graft of grafts) counts.set(landing(graft), (counts.get(landing(graft)) ?? 0) + 1);

    // [#20590] Keep only what the read would withhold where it now lands. A
    // graft sets a leaf and moves no container, so each pass re-grafts the
    // survivors onto the untouched incoming body; the set only shrinks, so
    // this settles in at most one pass per graft.
    let kept = grafts.filter((graft) => counts.get(landing(graft)) === 1);
    for (;;) {
        let out: unknown = incoming;
        for (const graft of kept) out = withValueAt(out, graft.at, graft.key, graft.value);
        if (kept.length === 0) return unchanged;
        const withheld = new Set(redactor(out as Record<string, unknown>).redactedKeys);
        const next = kept.filter((graft) => withheld.has(landing(graft)));
        if (next.length === kept.length) return { out: out as T, landed: kept.map(landing) };
        kept = next;
    }
}

// ---------------------------------------------------------------------------
// The generic data door: stored metadata ROWS, not metadata items (#21086)
// ---------------------------------------------------------------------------

/**
 * [#21086] The system objects whose `metadata` column stores one serialized
 * metadata BODY, of the type the same row's `type` column names — the table
 * every `/meta` read exit rehydrates from (`sys_metadata`) and its version
 * snapshots (`sys_metadata_history`).
 *
 * Both are served by the generic data door as well (`apiMethods: ['get',
 * 'list']`, for the Setup grids and the read-only "All Metadata" surface), and
 * that door is a READ EXIT for the stored body exactly like `/meta` is: a row
 * read there carries the same credential material {@link redactMetadataItem}
 * withholds from every `/meta` answer. So the door serves the body through the
 * same registry lookup, the same redactor, and nothing else — one definition of
 * what a credential is, applied at one more exit, never a second rule set.
 *
 * Keyed by the canonical object name. The registry resolves an object only by
 * that name (`computeFQN` is the identity), so a request that reaches either
 * table spells it this way.
 *
 * ⛔ The generic door has no write path into either table (`apiMethods` admits
 * no write verb; `sys_metadata_history` is append-only), so a redacted body
 * read here can never be PUT back — no carry-forward inverse is owed, which is
 * what makes a pure read projection a complete answer on this door.
 *
 * [#21120] The object set, the `isStoredMetadataBodyObject` predicate and the
 * two column names are the family-wide definition in `@objectstack/spec/kernel`,
 * imported above and re-exported — one set, consumed by every surface, so the
 * audit, analytics and realtime exits cannot drift from this one.
 */
const STORED_BODY_COLUMN = STORED_METADATA_BODY_COLUMN;
const STORED_TYPE_COLUMN = STORED_METADATA_TYPE_COLUMN;

/**
 * The projection to hand the engine for a read of `object`, given the caller's
 * own (`fields`, already normalized to an array or absent).
 *
 * The redactor is chosen by the row's `type`, so a projection that names the
 * body column but not the type column would leave the door nothing to choose
 * with. The type column is read too in that case, and `addedType` tells the
 * caller to take it back off the served rows ({@link redactStoredMetadataRow}'s
 * `dropType`) — the caller gets exactly the columns it named. Every other
 * projection, and every object outside the set, passes through unchanged.
 */
export function storedMetadataBodyProjection(
    object: string,
    fields: unknown,
): { fields: unknown; addedType: boolean } {
    if (!isStoredMetadataBodyObject(object) || !Array.isArray(fields)) return { fields, addedType: false };
    if (!fields.includes(STORED_BODY_COLUMN) || fields.includes(STORED_TYPE_COLUMN)) {
        return { fields, addedType: false };
    }
    return { fields: [...fields, STORED_TYPE_COLUMN], addedType: true };
}

/**
 * Serve one row of a {@link STORED_METADATA_BODY_OBJECTS} table: its stored
 * body becomes the body's type's read projection — the same object
 * {@link redactMetadataItem} serves on `/meta` — and every other column is left
 * as the engine returned it.
 *
 * The body column holds serialized JSON (a `textarea`); a driver that hands it
 * back already parsed is served in the shape it arrived in. A row whose body
 * needed no redaction is returned BY REFERENCE, so its stored bytes reach the
 * caller unchanged; a redacted body is re-serialized, and only then.
 *
 * Fails closed on the two rows it cannot judge, by omitting the body rather
 * than serving it: a body with no `type` beside it (no redactor can be chosen;
 * {@link storedMetadataBodyProjection} keeps the door's own reads from reaching
 * this), and a body that does not parse while its type HAS a redactor (the
 * redactor cannot run, so nothing proves the body clean). A body whose type
 * registers no redactor is served as stored, parseable or not — absence of a
 * redactor is a fact about the type, the same reading `/meta` gives it.
 *
 * ⛔ Not caught: a throwing redactor fails the read, as on every `/meta` exit
 * ({@link redactMetadataItem} takes that position and says why).
 */
export function redactStoredMetadataRow<T>(object: string, row: T, opts?: { dropType?: boolean }): T {
    if (!isStoredMetadataBodyObject(object) || !isPlainRecord(row)) return row;
    const dropType = opts?.dropType === true;
    const strip = (record: Record<string, unknown>): Record<string, unknown> => {
        if (!dropType) return record;
        const { [STORED_TYPE_COLUMN]: _type, ...rest } = record;
        return rest;
    };

    // [#21120] The body decision is the ONE shared primitive — same object set,
    // same per-type redactor, same fail-closed rules — so this door cannot
    // disagree with the audit / analytics / realtime exits about what a
    // credential is. This function adds only the door-local wrinkles on top: the
    // `dropType` strip of the type column `storedMetadataBodyProjection` asked
    // for, and omitting the body on a fail-closed outcome.
    const outcome = redactStoredMetadataBody(row[STORED_TYPE_COLUMN], row[STORED_BODY_COLUMN]);
    if (!outcome.ok) {
        const { [STORED_BODY_COLUMN]: _body, ...rest } = row;
        return strip(rest) as T;
    }
    if (outcome.body === row[STORED_BODY_COLUMN]) return (dropType ? strip(row) : row) as T;
    return strip({ ...row, [STORED_BODY_COLUMN]: outcome.body }) as T;
}

/** {@link redactStoredMetadataRow} over the rows of one read. Non-array input passes through. */
export function redactStoredMetadataRows<T>(object: string, rows: T[], opts?: { dropType?: boolean }): T[] {
    if (!Array.isArray(rows) || !isStoredMetadataBodyObject(object)) return rows;
    return rows.map((row) => redactStoredMetadataRow(object, row, opts));
}

/**
 * The refusal for a `groupBy` that names the stored body column of a
 * {@link STORED_METADATA_BODY_OBJECTS} table, or `undefined` when there is
 * none to make.
 *
 * A grouped answer serves each group's KEY, and here the key would be a whole
 * stored body. It cannot be projected: the redactor is chosen per row by
 * `type`, while a group key stands for every row that shares it, and a key
 * rewritten after grouping no longer names the rows it counts. So the
 * grouping is refused before the engine is asked, the posture the engine's own
 * credential-aggregation guard takes for the same reason. `INVALID_FIELD` /
 * 400, the code a refused grouping target already answers, located at the
 * entry (`groupBy[i]`, or `groupBy[i].field` for the object form).
 */
export function storedMetadataBodyGroupingRefusal(object: string, groupBy: unknown): Error | undefined {
    if (!isStoredMetadataBodyObject(object) || !Array.isArray(groupBy)) return undefined;
    for (let i = 0; i < groupBy.length; i += 1) {
        const entry = groupBy[i];
        const objectForm = isPlainRecord(entry);
        const field = objectForm ? entry.field : entry;
        if (field !== STORED_BODY_COLUMN) continue;
        const position = objectForm ? `groupBy[${i}].field` : `groupBy[${i}]`;
        const err: any = new Error(
            `Cannot group '${object}' by '${STORED_BODY_COLUMN}' (${position}): the query was not run. `
            + `Each group key would be a whole stored metadata body, which this door serves only as `
            + `its type's read projection, with stored credential material withheld, and a group key `
            + `cannot be projected without changing which rows it counts. Group by '${STORED_TYPE_COLUMN}', `
            + `'name' or another scalar column instead, and read the bodies with a plain list.`,
        );
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.field = STORED_BODY_COLUMN;
        err.fields = [STORED_BODY_COLUMN];
        err.object = object;
        err.param = 'groupBy';
        return err;
    }
    return undefined;
}

/**
 * [#21120] The data door's FILTER / SORT refusal on the stored body column —
 * maintainer ruling A, the further accept-set narrowing the grouping refusal
 * (#21086) began.
 *
 * A filter on the body column EVALUATES the stored body row by row: a credential
 * withheld from every served answer is still recoverable by prefix probing
 * (`?filter={"metadata":{"$contains":"<guess>"}}` returns the row only when the
 * guess is a prefix — a predicate oracle). A sort on it orders by the same
 * stored bytes. Neither serves the body, so projecting it is no answer; the only
 * answer is to refuse, the same posture the engine's own masked-field guard and
 * the grouping refusal above take. Same family, shape and code: `INVALID_FIELD`
 * / 400, naming the field, the object and the offending `param`.
 *
 * `filterFields` is the set of head field names the caller's `where` names
 * (`collectFilterFieldKeys`), and `sortFields` the fields its `orderBy` names.
 * Filter is judged before sort — a query that does both reads "the filter was
 * not run" first. `undefined` when neither names the body column.
 */
export function storedMetadataBodyPredicateRefusal(
    object: string,
    opts: { filterFields?: readonly unknown[]; sortFields?: readonly unknown[] },
): Error | undefined {
    if (!isStoredMetadataBodyObject(object)) return undefined;
    const namesBody = (fields: readonly unknown[] | undefined): boolean =>
        Array.isArray(fields) && fields.some((f) => f === STORED_BODY_COLUMN);
    const make = (param: 'filter' | 'sort', verb: string): Error => {
        const err: any = new Error(
            `Cannot ${verb} '${object}' by '${STORED_BODY_COLUMN}' (${param}): the query was not run. The `
            + `${STORED_BODY_COLUMN} column holds a stored metadata body, served only as its type's read `
            + `projection with stored credential material withheld. ${param === 'filter'
                ? 'A filter on it evaluates the stored body row by row, which rebuilds a withheld credential by probing'
                : 'A sort on it orders by the same stored bytes'}, so it is refused rather than evaluated. `
            + `Filter or sort by '${STORED_TYPE_COLUMN}', 'name' or another scalar column instead.`,
        );
        err.code = 'INVALID_FIELD';
        err.status = 400;
        err.field = STORED_BODY_COLUMN;
        err.fields = [STORED_BODY_COLUMN];
        err.object = object;
        err.param = param;
        return err;
    };
    if (namesBody(opts.filterFields)) return make('filter', 'filter');
    if (namesBody(opts.sortFields)) return make('sort', 'sort');
    return undefined;
}
