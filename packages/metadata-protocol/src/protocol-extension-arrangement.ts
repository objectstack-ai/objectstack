// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0146 D10 — the whole arrangement of an extended object is the paired
 * `.custom` package's to declare, judged.
 *
 * Maintainer, verbatim: 「软件包字段、子表自定义分三种，原始软件包，继承软件包和环境管理员覆盖，
 * 继承软件包 我记得已经有一套标准，只能申明插入位置，原始软件包、环境管理员 应该可以申明完整的配置」.
 * An object extension carries two keys for it, `fieldGroups` and
 * `relatedLists` (`CUSTOM_ARRANGEMENT_KEYS`, `@objectstack/spec/data`), in the
 * shape an object declares them in. Which package an extension belongs to is
 * not in its body, so the schema cannot say who wrote them; this module is
 * the ONE judge and every door calls it, as the `__c` reservation's doors
 * call theirs (`protocol-extension-field-suffix.ts`):
 *
 *   - the save, the restore and the draft promotion of an `object_extension`
 *     item (`objectExtensionItemRefusal`, `protocol-object-extension-item.ts`),
 *     as the package's one `objectExtensions` entry;
 *   - `os validate` and `os build` (`@objectstack/cli`) and the marketplace
 *     install (`@objectstack/cloud-connection`), for a whole package body.
 *
 * ## The rule
 *
 * In a package that is NOT a base's paired `.custom`
 * ({@link isCustomizationPackage}, the `__c` judge's predicate), every
 * arrangement key an `objectExtensions` entry writes is refused, with the
 * prescription to place what the package brings with `place`. In a `.custom`
 * package nothing is refused. A body bound to no package is not judged: the
 * rule is about packages, as the `__c` reservation is.
 *
 * The registry fold applies only a `.custom` package's keys
 * (`applyCustomArrangement`, `@objectstack/objectql`), so a body that reaches
 * the registry past every door (a manifest loaded unparsed) is skipped there
 * and named in the boot log; nothing here depends on that.
 *
 * Pure: no I/O, no throw from {@link judgeExtensionArrangement}. Each door
 * keeps its own envelope; the active doors' is
 * {@link extensionArrangementRefusalError}'s `VALIDATION_ERROR` / 400. No code
 * is minted.
 */

import { extensionArrangementKeys, type CustomArrangementKey } from '@objectstack/spec/data';
import { isCustomizationPackage } from '@objectstack/spec/kernel';
import type { MetadataIssueEntry } from './protocol.js';

/** One refused arrangement key, located. */
export interface ExtensionArrangementRefusal {
    /** Where the key sits in the judged body, e.g. `objectExtensions[0].fieldGroups`. */
    path: string;
    /** The extension's `extend` target. */
    object: string;
    /** The key as written. */
    key: CustomArrangementKey;
    /** The package the body is written into. */
    packageId: string;
    /** The door's sentence: what is wrong, then the prescription. */
    message: string;
}

/** What a door hands the judge: the package written into and its extensions. */
export interface ExtensionArrangementSubject {
    /** The package the body is written into. Not a non-empty string ⇒ not judged. */
    packageId: string | null | undefined;
    /** The package's `objectExtensions` entries. */
    objectExtensions?: unknown;
    /** Prefix of every reported path, e.g. `packages[1].manifest.`. */
    at?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);

/** What `place` writes instead, per key. */
const PLACE_EXAMPLE: Readonly<Record<CustomArrangementKey, string>> = Object.freeze({
    fieldGroups: "`place: [{ field: 'tax_id', group: 'basic', after: 'industry' }]`",
    relatedLists: "`place: [{ list: 'contract', after: 'opportunity' }]`",
});

/** The sentence. Prescription inside the first 500 characters: a 4xx message crosses the REST boundary capped there. */
function arrangementOutsidePairMessage(key: CustomArrangementKey, object: string, packageId: string): string {
    return `\`${key}\` in the extension of object '${object}' in package '${packageId}': only the object extension of a `
        + 'base\'s paired `.custom` package declares an object\'s whole arrangement (ADR-0146 D10). Remove the key and '
        + `place what this package brings with \`place\`, e.g. ${PLACE_EXAMPLE[key]}.`;
}

/**
 * Every arrangement key the rule refuses in what `subject` declares, in
 * declaration order. Empty when the subject names no package, names a
 * `.custom` package, or writes neither key.
 */
export function judgeExtensionArrangement(subject: ExtensionArrangementSubject): ExtensionArrangementRefusal[] {
    const { packageId } = subject;
    if (typeof packageId !== 'string' || packageId === '') return [];
    if (isCustomizationPackage(packageId) || !Array.isArray(subject.objectExtensions)) return [];
    const at = subject.at ?? '';
    const refusals: ExtensionArrangementRefusal[] = [];
    subject.objectExtensions.forEach((ext, i) => {
        if (!isRecord(ext)) return;
        const object = typeof ext.extend === 'string' ? ext.extend : '';
        for (const key of extensionArrangementKeys(ext)) {
            refusals.push({
                path: `${at}objectExtensions[${i}].${key}`,
                object, key, packageId,
                message: arrangementOutsidePairMessage(key, object, packageId),
            });
        }
    });
    return refusals;
}

/**
 * The active doors' envelope around a non-empty refusal list: `VALIDATION_ERROR`
 * / 400, the message the first refusal's sentence (and how many more), and
 * `issues[]` locating every key, the shape the Studio designer keys on.
 */
export function extensionArrangementRefusalError(
    refusals: readonly ExtensionArrangementRefusal[],
): Error & { code: 'VALIDATION_ERROR'; status: 400; issues: MetadataIssueEntry[] } {
    const [first] = refusals;
    const more = refusals.length - 1;
    const err = new Error(
        `${first!.message}${more > 0 ? ` (${more} more key${more === 1 ? '' : 's'} in \`issues\`.)` : ''}`,
    ) as Error & { code: 'VALIDATION_ERROR'; status: 400; issues: MetadataIssueEntry[] };
    err.code = 'VALIDATION_ERROR';
    err.status = 400;
    err.issues = refusals.map((r) => ({ path: r.path, message: r.message, code: 'custom' }));
    return err;
}
