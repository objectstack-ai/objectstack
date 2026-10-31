// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25467 E0] Part of the module preamble of `protocol.ts`, moved here verbatim:
 * the disabled-package and no-draft refusals, and the save-door body refusals (runtime hooks, permission-set owner binding, protection block, packageless publish).
 *
 * A MOVE, not a redesign: every declaration below is byte-identical to the text
 * that stood above `ObjectStackProtocolImplementation`; only the imports and the
 * export list at the foot are new. `protocol.ts` re-exports what it exported.
 */
import { judgePermissionSetOwnerBinding } from '@objectstack/spec/security';
import { overlaySchemaDeclaredKey } from './protocol-meta-type-schema.js';
import type { MetadataIssueEntry } from './protocol-metadata-issues.js';

/**
 * [#7557, #24097] The ONE refusal for an object whose owning package is
 * disabled, raised by every API reader of that object: the data plane
 * ({@link ObjectStackProtocolImplementation.assertObjectRegistered}) and the
 * by-name `/meta` reads (`getMetaItem`, `getMetaItemLayered`). One constructor,
 * so the two halves of the answer cannot drift apart in code, status or text.
 */
export function objectPackageDisabledError(object: string): Error {
    const disabled: any = new Error(
        `Object '${object}' belongs to a disabled package and is not being served. `
        + 'Re-enable the package to restore access.',
    );
    disabled.code = 'OBJECT_PACKAGE_DISABLED';
    disabled.status = 404;
    disabled.object = object;
    return disabled;
}

/**
 * [#7557, #24097] Whether `registry` says `name` is an object of a disabled
 * package. Optional-called: registry doubles across the test suites implement
 * `isPackageDisabled` but not this, and a host whose registry cannot answer
 * must not have every read refused.
 */
export function isObjectOfDisabledPackage(registry: any, name: string): boolean {
    return typeof registry?.isObjectPackageDisabled === 'function'
        && registry.isObjectPackageDisabled(name) === true;
}

/**
 * [#7557, #24210] Whether `item` belongs to a disabled package: its
 * `_packageId`, asked of `registry.isPackageDisabled`. The ONE predicate for a
 * non-object item, asked by the list read ({@link
 * ObjectStackProtocolImplementation.getMetaItems}, which omits the item) and
 * the by-name read ({@link ObjectStackProtocolImplementation.getMetaItem},
 * which answers as for a name with nothing behind it), so the two cannot
 * disagree about which items a disable hides. Optional-called, as {@link
 * isObjectOfDisabledPackage} is: a host whose registry cannot answer has no
 * item hidden.
 */
export function isItemOfDisabledPackage(registry: any, item: unknown): boolean {
    return typeof registry?.isPackageDisabled === 'function'
        && registry.isPackageDisabled((item as { _packageId?: unknown } | null | undefined)?._packageId) === true;
}

/**
 * The strict draft read's `404 NO_DRAFT`: no pending draft at this address
 * (ADR-0005 §draft-lifecycle). [#24210] One constructor for the read that
 * finds no draft row and the read of a disabled package's draft, so the two
 * answers are byte-identical.
 */
export function noPendingDraftError(type: string, name: string): Error & { code: 'NO_DRAFT'; status: 404 } {
    const err = new Error(`No pending draft exists for ${type}/${name}.`) as Error & { code: 'NO_DRAFT'; status: 404 };
    err.code = 'NO_DRAFT';
    err.status = 404;
    return err;
}

/**
 * [#21658, #21689] The save door's refusal of a `hook` that carries no `body`:
 * such a hook can never run once this door has stored it. One predicate, two
 * shapes it meets, one envelope: a hook whose `handler` names a function, and a
 * hook with neither field.
 *
 * Why it can never run. A hook this door stores ships with no code package:
 * the runtime binds every stored hook under the synthetic owner
 * `metadata-service` (`ObjectQLPlugin`'s authored hook re-sync), with no
 * `functions` map, and no package of that name registers functions. So a
 * `body`, which is stored with the hook, is the only code it can run.
 *
 *   - A `handler` name resolves inside the hook's own package only (the
 *     maintainer's ruling on #21604, letter B; the binder's `resolveHandler` in
 *     `@objectstack/objectql`'s `hook-binder.ts`), so it has nothing to resolve
 *     against, and the binder refuses the hook at registration
 *     (`INVALID_REFERENCE` / 400, logged at `error`).
 *   - A hook with neither field has nothing to bind at all, and the binder
 *     skips it at every re-sync (`skipping hook with unresolved handler`,
 *     logged at `warn`).
 *
 * Either way the door would already have answered success, and the hook would
 * be served by name and never run. Refusing it here says so to the author,
 * before anything is stored.
 *
 * The predicate is the binder's own body-first test, the judgement
 * install-local's `collectHooksWithoutBody` makes on its own door (#21585): a
 * `body` object is bound through the body runner and the `handler` is never
 * consulted, so a hook carrying BOTH a `body` and a `handler` saves (its body
 * runs), and every hook without a `body` object is refused, whatever its
 * `handler` holds. Asked after the type schema has accepted the body, so
 * `body` here is either absent or a declared hook body, and a malformed `body`
 * gets the schema's own located `422` instead of this refusal's "give it a
 * body".
 *
 * ⛔ Not a `HookSchema` rule: a build artifact legitimately carries the string
 * form (`objectstack build` lowers an inline function to the hook's name and
 * ships the function in the artifact's runtime module), and the artifact and
 * boot doors never reach `saveMetaItem`. This is the runtime-authoring door's
 * rule only.
 *
 * Every writer through this door is judged: the REST and dispatcher saves, in
 * draft and in publish mode, and the two server-stated re-savers
 * (`migrateStoredMetadata`, `duplicatePackage`), which record this refusal as
 * the row's failure. A row stored before this rule keeps its bytes.
 *
 * `VALIDATION_ERROR` / 400, the envelope of the name check the door runs on
 * every body (`savedItemNameRefusal`). The message names the hook (and the
 * function, when its `handler` names one), prescribes the `body` first, and
 * only then explains: a 4xx message crosses the REST boundary bounded at 500
 * characters with its TAIL truncated, and the whole sentence stays under that
 * bound for any hook and function name shorter than about 65 characters each.
 * Runtime words carry no tracker number.
 */
export function runtimeHookWithoutBodyRefusal(
    singularType: string,
    item: unknown,
    saveName: string,
): (Error & { code: 'VALIDATION_ERROR'; status: 400 }) | undefined {
    if (singularType !== 'hook') return undefined;
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    const hook = item as { handler?: unknown; body?: unknown };
    if (hook.body && typeof hook.body === 'object') return undefined;
    const prescription = 'Give it a `body` (sandboxed JS, `{ language: \'js\', source }`, or an expression), '
        + 'which is stored with the hook. A hook saved through the metadata API ships with no code package, so ';
    const err = new Error(
        typeof hook.handler === 'string' && hook.handler !== ''
            ? `Invalid hook: '${saveName}' names the function '${hook.handler}' in its \`handler\` and carries no \`body\`, `
                + `so it can never run. ${prescription}it holds no functions, and a \`handler\` name resolves only inside `
                + "the hook's own package."
            : `Invalid hook: '${saveName}' carries no \`body\`, so it has nothing to run. ${prescription}`
                + 'its `body` is the only code it can run.',
    ) as Error & { code: 'VALIDATION_ERROR'; status: 400 };
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    return err;
}

/**
 * [ADR-0086 D3] The refusal of a permission set whose body `packageId`
 * disagrees with the package binding of the row a write door writes it into.
 *
 * D3 declares the key as "the owning package for a package-shipped set
 * (absent ⇒ env-authored)", and every reader of a set's owner reads the
 * binding: the row's `package_id`, served as `_packageId`. A body that
 * declared another owner was accepted and its declaration silently
 * overridden, so an author (an AI build above all) was never told the owner it
 * wrote is not the owner it got. Refused instead, at every door a body reaches
 * `active` through: the save ({@link ObjectStackProtocolImplementation.saveMetaItem},
 * draft and publish mode), the restore of a stored version
 * ({@link ObjectStackProtocolImplementation.rollbackMetaItem} and
 * `revertCommit`'s restore limb, through `restoredBodyWriter`) and the draft
 * promotion that the per-item publish and
 * {@link ObjectStackProtocolImplementation.publishPackageDrafts} share — the
 * three doors `savedItemNameRefusal` judges a body's `name` at.
 *
 * What disagrees, and the words, are the one judge every door of this rule
 * calls: `judgePermissionSetOwnerBinding` (`@objectstack/spec/security`, whose
 * header holds the verdict table), which the stack schema (the build door) and
 * `ObjectQL.registerApp` (the registration door) call too. This function is the
 * write doors' envelope around it, and its words for these three doors are byte
 * for byte the words this function built before the judge moved. `binding` is
 * the RESOLVED binding of the row the write lands in, never the request's
 * spelling: a draft save that names no package lands in the package of the
 * item's active row (#11087), a direct save that names none lands in the row
 * its address resolves, and a restore writes into the item's active row, whose
 * binding `put` keeps.
 *
 * `VALIDATION_ERROR` / 400, the envelope of the door's other body-against-
 * address refusal: `savedItemNameRefusal`, which judges the body's `name`
 * against the name the row is written under, at the same doors. No code is
 * minted. `issues[]` locates the key, the shape the Studio designer keys on.
 *
 * Every writer through the save door is judged, the two server-stated
 * re-savers included (`migrateStoredMetadata`, which records the refusal as
 * the row's failure, and `duplicatePackage`, which rewrites a body naming its
 * source package to the target first). A row stored before this rule keeps its
 * bytes and keeps reading by its binding; it is refused on its next write.
 */
export function permissionSetOwnerBindingRefusal(
    singularType: string,
    item: unknown,
    name: string,
    binding: string | null | undefined,
    door: 'save' | 'restore' | 'publish',
): (Error & { code: 'VALIDATION_ERROR'; status: 400; issues: MetadataIssueEntry[] }) | undefined {
    if (singularType !== 'permission') return undefined;
    const refusal = judgePermissionSetOwnerBinding(item, name, binding, door);
    if (!refusal) return undefined;
    const err = new Error(refusal.message) as Error & { code: 'VALIDATION_ERROR'; status: 400; issues: MetadataIssueEntry[] };
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    err.issues = [{ path: 'packageId', message: refusal.issueMessage, code: 'custom' }];
    return err;
}

/** The author-facing lock block (ADR-0010 Phase 4.3), as the spec mounts it on a metadata item. */
const PROTECTION_BLOCK_KEY = 'protection';

/**
 * [ADR-0010 §3.5 and Phase 4.3] The save door's refusal of a `protection`
 * block — the package author's lock declaration, which this door cannot
 * honour.
 *
 * ADR-0010 states one door for the block. Phase 4.3 calls it the public
 * author surface "that translates into the private `_lock` envelope at load
 * time": the loader "calls `applyProtection(item, { packageId })` to translate
 * the block … and strips the public `protection` block so it never leaks into
 * the overlay row". An item this door writes is authored in the environment,
 * and §3.5 states what a lock means for one: "Tenant `org` artifacts ignore
 * L3 / L4 entirely (the tenant owns them in full, can also delete them)". So
 * the block has no translation here, and translating it anyway would open a
 * lock door ADR-0010 does not state. Stored verbatim, which is what this door
 * did before, the block was served back as `protection.lock: 'full'` while the
 * item read `lock: 'none'` and every edit and delete succeeded: a body telling
 * its reader the item is protected when it is not.
 *
 * Asked only on a type whose schema declares the block, read structurally by
 * {@link overlaySchemaDeclaredKey} (the unmanaged import asks the same
 * question). On any other type the schema's own verdict stands: an
 * unrecognized key, refused by the parse.
 *
 * Every AUTHORING write is refused: the REST and dispatcher saves, in draft
 * and in publish mode, the domain doors that save through this one, and the
 * unmanaged import, which strips a block it can parse before the body reaches
 * this door (`stripUnmanagedImportLock`) and hands a malformed one on to be
 * refused here. The server-stated rewrites of rows the store already holds —
 * a `source`-stating re-save (`migrateStoredMetadata`, the flow credential
 * move) and `duplicatePackage` — strip the block instead, through
 * {@link withoutProtectionBlock}, exactly as they strip the derived provenance
 * stamps (`tenantAuthoredWriteRefusal` draws the same line): a row stored
 * before this rule may carry one, the block never bound, so removing it
 * changes no verdict, and failing the rewrite would fail a stored migration or
 * a credential move over a key that does nothing. A row nothing rewrites keeps
 * its bytes.
 *
 * `VALIDATION_ERROR` / 400, the envelope of the door's other content refusals
 * (`savedItemNameRefusal`, the hook refusal above). No code is minted. It is
 * located twice: the message names the key, and `issues[]` carries it as a
 * path, the shape the Studio designer keys on. Every present value is refused,
 * a malformed block included, because the block is not accepted here at all:
 * judging its value first would ask an author to repair a block they then have
 * to delete. The message prescribes first and explains second, because a 4xx
 * message crosses the REST boundary bounded at 500 characters with its TAIL
 * truncated.
 *
 * ⛔ The prescription names the package loader's door, never a `_lock*` key:
 * those are the runtime's private envelope, never authored
 * (`shared/protection.zod.ts`).
 */
function protectionBlockRefusal(
    type: string,
    item: unknown,
    saveName: string,
): (Error & { code: 'VALIDATION_ERROR'; status: 400; issues: MetadataIssueEntry[] }) | undefined {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
    if (!Object.prototype.hasOwnProperty.call(item, PROTECTION_BLOCK_KEY)) return undefined;
    if ((item as Record<string, unknown>)[PROTECTION_BLOCK_KEY] === undefined) return undefined;
    if (overlaySchemaDeclaredKey(type, PROTECTION_BLOCK_KEY) === undefined) return undefined;
    const err = new Error(
        `Remove the \`protection\` block from ${type} '${saveName}' and send it again. Nothing was written. `
        + 'This door does not translate the block, so it would lock nothing: an item saved through the metadata API '
        + 'is authored in this system (ADR-0010 §3.5). To lock an item, declare `protection` on it in a code '
        + "package's source, where the package loader translates it into the item's lock (ADR-0010 Phase 4.3).",
    ) as Error & { code: 'VALIDATION_ERROR'; status: 400; issues: MetadataIssueEntry[] };
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    err.issues = [{
        path: PROTECTION_BLOCK_KEY,
        message: "Not accepted through the metadata API: only a code package's loader translates `protection` into a lock.",
        code: 'custom',
    }];
    return err;
}

/**
 * [ADR-0010 §3.5] The server-stated rewrites' half of
 * {@link protectionBlockRefusal}: the same body without its `protection` block,
 * on a type whose schema declares one. On any other type the body passes as
 * it is, for the parse to judge.
 *
 * Returns the SAME reference when there is nothing to strip, and a copy
 * otherwise, so a caller's own body is never mutated.
 */
function withoutProtectionBlock(type: string, item: unknown): unknown {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    if (!Object.prototype.hasOwnProperty.call(item, PROTECTION_BLOCK_KEY)) return item;
    if (overlaySchemaDeclaredKey(type, PROTECTION_BLOCK_KEY) === undefined) return item;
    const rest = { ...(item as Record<string, unknown>) };
    delete rest[PROTECTION_BLOCK_KEY];
    return rest;
}

/**
 * [#23165] The rows of an item a delete leaves stored at its address, in
 * words, for the delete receipt: its rows bound to other packages (sorted, as
 * {@link ObjectStackProtocolImplementation.packagelessAddress} answers them,
 * at most five named) and its package-less row. The receipt names them
 * instead of claiming the item gone or back at its artifact default.
 */
export function remainingRowsPhrase(packageIds: readonly string[], unbound: boolean, noun: 'row' | 'draft'): string {
    const parts: string[] = [];
    if (packageIds.length > 0) {
        const shown = packageIds.slice(0, 5).map((id) => `'${id}'`).join(', ');
        const more = packageIds.length > 5 ? ` and ${packageIds.length - 5} more` : '';
        parts.push(packageIds.length === 1
            ? `its ${noun} bound to package ${shown}`
            : `its ${noun}s bound to packages ${shown}${more}`);
    }
    if (unbound) parts.push(`its package-less ${noun}`);
    const count = packageIds.length + (unbound ? 1 : 0);
    return `${parts.join(' and ')} ${count === 1 ? 'remains' : 'remain'}`;
}

/**
 * [#23495, ADR-0048] The `404 NO_DRAFT` of a per-item publish that names no
 * package, of an item bound to package `P` that holds no draft at `P`'s
 * address ({@link ObjectStackProtocolImplementation.packagelessDraftAddress})
 * while drafts bound to other packages are stored. The code and status are the
 * promotion's own, the ones the strict draft read naming no package answers
 * in the same state; the sentence names the drafts that remain and the
 * request that reaches them, prescription first (a 4xx message crosses the
 * REST boundary bounded at 500 characters).
 */
function packagelessPublishNoDraftRefusal(
    type: string,
    name: string,
    packageId: string,
    otherPackageIds: readonly string[],
): Error & { code: 'NO_DRAFT'; status: 404 } {
    const err = new Error(
        'Name the package of the draft to publish, then send it again: on the REST door add ?package= with the '
        + `package id, in process pass packageId. Nothing was published. ${type} '${name}' has no pending draft `
        + `bound to package '${packageId}', the package its published rows are bound to and the draft a publish `
        + `that names no package promotes, and ${remainingRowsPhrase(otherPackageIds, false, 'draft')}.`,
    ) as Error & { code: 'NO_DRAFT'; status: 404 };
    err.code = 'NO_DRAFT';
    err.status = 404;
    return err;
}

// Shared with `protocol.ts` and the sibling preamble modules; module-private before the move.
export { packagelessPublishNoDraftRefusal, protectionBlockRefusal, withoutProtectionBlock };
