// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim: the bundle-
// member selector, discriminator and mutation-event member, and the commit-plan item.
//
// A MOVE, not a redesign: every declaration below is byte-identical to the text that stood
// above `ObjectStackProtocolImplementation`; only the imports and the export list at the foot
// are new. `protocol.ts` re-exports what it exported.
import {
    overlayMemberOfBody,
    overlayMemberValue,
} from './migrations/overlay-index.js';
import {
    // [#7774] The i18n-bundle identity table (#7730) and its reader. A type
    // listed here is identified by `(name, <field>)`, so every merge in the
    // unscoped `/meta` list keys on the pair — see {@link mergePackageAwareOverlay}.
    ITEM_KEY_DISCRIMINATORS,
} from '@objectstack/metadata-core';
import { canonicalMetaType } from './protocol-meta-type-schema.js';

/**
 * [#22877] The by-name doors' bundle member selector: the request member, and
 * the `?member=` query parameter in each REST route's closed set (ruling
 * 6116165299, Q2 i). Named after what the stored column holds
 * (`sys_metadata.bundle_member`) and type-neutral, never `locale`: on `/meta`,
 * `?locale=` is the response translation locale.
 */
export const BUNDLE_MEMBER_SELECTOR = 'member';

/**
 * [#22877] The longest member a stored row can carry — the declared
 * `maxLength` of `sys_metadata.bundle_member` (`@objectstack/metadata-core`
 * `SysMetadataObject`, pinned equal in `protocol.bundle-member-selector.test.ts`).
 * A longer selector names no member that could be stored, so it is refused as
 * malformed rather than answered as an absent member.
 */
export const BUNDLE_MEMBER_MAX_LENGTH = 100;

/**
 * [#22877] THE one reading of the bundle member selector, shared by every
 * by-name door (`getMetaItem`, `deleteMetaItem`, `publishMetaItem`,
 * `historyMetaItem`, `rollbackMetaItem`).
 *
 * Returns the member as named, trimmed, or `undefined` when none was named,
 * which every door reads as the CANONICAL member, as the registry's bare-name
 * read does. Naming the canonical value (`en-US`) is the same request. A
 * well-formed member with nothing stored or shipped is not refused here: each
 * door answers it as it answers an absent item.
 *
 * Refuses, with a located 400 `VALIDATION_ERROR` — the code the REST door's
 * recognition refusal answers for a misspelled selector on the same routes —
 * a selector on a type whose identity is its name alone, and a value that
 * cannot name a member: not a string, blank, or longer than
 * {@link BUNDLE_MEMBER_MAX_LENGTH}. The message names the parameter. The REST
 * door renders it through its one error door (`handleRouteError`), as it
 * renders every refusal this protocol raises. ⛔ A blank selector is never read as
 * absent: `?member=` asked for something, and answering the canonical member
 * for it would be a guess.
 */
export function resolveBundleMemberSelector(type: string, member: unknown): string | undefined {
    if (member === undefined) return undefined;
    // Either spelling of the type: the doors ask after their boundary fold,
    // and a direct caller may not have folded.
    const singular = canonicalMetaType(type);
    const disc = ITEM_KEY_DISCRIMINATORS[singular];
    const refuse = (sentence: string): never => {
        const err = new Error(`The "${BUNDLE_MEMBER_SELECTOR}" selector ${sentence}`) as Error & {
            code: 'VALIDATION_ERROR'; status: 400; param: string;
        };
        err.code = 'VALIDATION_ERROR';
        err.status = 400;
        err.param = BUNDLE_MEMBER_SELECTOR;
        throw err;
    };
    if (!disc) {
        return refuse(
            `names a bundle member, and a '${singular}' item has none: its identity is its name alone. `
            + `Remove the selector.`,
        );
    }
    const example = `'${disc.canonical}'`;
    if (typeof member !== 'string') {
        return refuse(`must be one string: the ${disc.field} of one '${singular}' member, e.g. ${example}.`);
    }
    const value = member.trim();
    if (value === '') {
        return refuse(
            `is blank. Name one '${singular}' member by its ${disc.field} (e.g. ${example}), or omit the `
            + `selector to address the canonical member (${example}).`,
        );
    }
    if (value.length > BUNDLE_MEMBER_MAX_LENGTH) {
        return refuse(
            `is ${value.length} characters long; a stored '${singular}' member holds at most `
            + `${BUNDLE_MEMBER_MAX_LENGTH}, so it names no member. Name one by its ${disc.field} (e.g. ${example}).`,
        );
    }
    return value;
}

/**
 * [#22877] The discriminator value of the member a selector addresses, for a
 * registry call or a body comparison: the selector itself, or the canonical
 * member when none was named. `undefined` for a type with no members.
 */
export function bundleMemberDiscriminator(type: string, member: string | undefined): string | undefined {
    const disc = ITEM_KEY_DISCRIMINATORS[canonicalMetaType(type)];
    if (!disc) return undefined;
    return member?.trim() || disc.canonical;
}

/**
 * [#22877] `MetadataMutationEvent.member` for the member a write addressed,
 * as a spread: empty for the canonical member and for a type with no members,
 * so those events keep the shape they always had.
 */
function mutationEventMember(type: string, member: string | null | undefined): { member?: string } {
    const value = overlayMemberValue(type, member);
    return typeof value === 'string' ? { member: value } : {};
}

/**
 * [#22877] One item of a package commit's revert plan (ADR-0067), as
 * `sys_metadata_commit.items` stores it: `member` is the bundle member the
 * item is, for a type whose identity is a pair, and is absent for the
 * canonical member and every type with no members — so the plan of every
 * other item is stored byte-identical to what it was. [#23073] The commit
 * timeline serves it on every item of a bundled type, the canonical member
 * spelled out ({@link ObjectStackProtocolImplementation.listCommits}).
 */
export type CommitPlanItem = { type: string; name: string; existedBefore: boolean; prevVersion: number | null; member?: string };

/** [#22877] The identity of a plan item or a draft within one batch: two members of one name are two. */
function commitPlanKey(item: { type: string; name: string; member?: string }): string {
    return `${item.type}/${item.name}\u0000${item.member ?? ''}`;
}

/**
 * [#22877] A repository call's `member` option as a spread: present only when a
 * member was named, so a call addressing the canonical member — and every call
 * for a type with no members — passes exactly the options it always did.
 */
export function memberOption(member: string | undefined): { member?: string } {
    return member !== undefined ? { member } : {};
}

/** [#22877] {@link mutationEventMember} for the member a written BODY belongs to. */
function mutationEventMemberOfBody(type: string, body: unknown): { member?: string } {
    const value = overlayMemberOfBody(type, body);
    return typeof value === 'string' ? { member: value } : {};
}

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { commitPlanKey, mutationEventMember, mutationEventMemberOfBody };
