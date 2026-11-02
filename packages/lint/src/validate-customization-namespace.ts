// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D3] A package whose `manifest.namespace` has no paired
 * customization namespace — so its installers can never customize it — is
 * told so while it is still being authored.
 *
 * Every installed base gets one paired writable package, `<base>.custom`, the
 * first time an installer customizes it; its namespace is the base's followed
 * by a suffix, and a base namespace too long for that suffix gets NO pair
 * namespace (the #28404 ruling, point 1: a named refusal, no truncation and no
 * hashing). The ensure door then refuses to create the pair, so the author of
 * such a package learns about it only when a customer tries. This rule is the
 * author-time half of that refusal (#28473).
 *
 * ## ⛔ The verdict is the helper's — nothing here restates the limit
 *
 * Whether a namespace has a pair namespace is `customizationNamespace`
 * (`@objectstack/spec/kernel`, `customization-package.ts`) — the function the
 * ensure door creates the pair with. This rule reports exactly its
 * `base_namespace_too_long` refusal and composes its sentence from
 * `MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH` and
 * `CUSTOMIZATION_NAMESPACE_SUFFIX`, never from a number or a suffix of its
 * own, so a change to the pairing rule moves this warning with it.
 *
 * ## Which packages are judged — the install door's selection
 *
 * `packages[].manifest` when the stack carries `packages[]` (an ADR-0130
 * artifact), the top-level `manifest` otherwise: the packages one install act
 * delivers, read the way the install door and `os validate`'s dependency-range
 * check select them. An artifact's own wrapper manifest is not a package and
 * is not judged.
 *
 * ## Not judged here
 *
 *  - A package that is itself a pair (`customizationPackageId` answers
 *    `base_is_customization_package`): a pair is never paired again, and its
 *    namespace is the pair namespace, longer than a base's by construction.
 *  - The helper's other two refusals. A missing namespace is not this rule's
 *    question, and a namespace the manifest grammar refuses for another reason
 *    (an uppercase letter, a leading digit) is `os validate`'s refusal, with
 *    the grammar's own sentence.
 *
 * ## Advisory, never an error
 *
 * The package builds, installs and runs; only its customization is refused,
 * and a package whose installers are never meant to customize it may keep
 * its namespace. Refusing it would narrow what `os build` accepts for a
 * consequence the platform does not treat as an error.
 */

import {
  CUSTOMIZATION_NAMESPACE_SUFFIX,
  MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH,
  customizationNamespace,
  customizationPackageId,
} from '@objectstack/spec/kernel';

import type { AnyRec } from './page-walk.js';

export const NAMESPACE_NO_CUSTOMIZATION_PAIR = 'namespace-no-customization-pair';

/**
 * The longest namespace the manifest grammar admits, as the pairing rule
 * states it: the base limit plus the suffix it leaves room for. The identity
 * is `customization-package.ts`'s own definition of the base limit, and that
 * package's test holds it against `ManifestSchema.shape.namespace`.
 */
const NAMESPACE_MAX_LENGTH = MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH + CUSTOMIZATION_NAMESPACE_SUFFIX.length;

export interface CustomizationNamespaceFinding {
  severity: 'warning';
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `package "com.acme.crm"`. */
  where: string;
  /** Config path, e.g. `manifest.namespace` or `packages[1].manifest.namespace`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The manifests one install act delivers, each with the path it is authored at. */
function deliveredManifests(stack: AnyRec): Array<{ manifest: AnyRec; at: string }> {
  if (Array.isArray(stack.packages)) {
    return stack.packages.flatMap((entry: unknown, index: number) =>
      isRec(entry) && isRec(entry.manifest) ? [{ manifest: entry.manifest, at: `packages[${index}].manifest` }] : [],
    );
  }
  return isRec(stack.manifest) ? [{ manifest: stack.manifest, at: 'manifest' }] : [];
}

/**
 * Warn on each delivered package whose namespace is too long to have a paired
 * customization namespace. Returns findings (empty = clean).
 */
export function validateCustomizationNamespace(stack: AnyRec): CustomizationNamespaceFinding[] {
  const findings: CustomizationNamespaceFinding[] = [];
  if (!isRec(stack)) return findings;

  for (const { manifest, at } of deliveredManifests(stack)) {
    const pairId = customizationPackageId(manifest.id);
    if (!pairId.ok && pairId.reason === 'base_is_customization_package') continue;

    const pairNamespace = customizationNamespace(manifest.namespace);
    if (pairNamespace.ok || pairNamespace.reason !== 'base_namespace_too_long') continue;

    // `base_namespace_too_long` is answered for a non-empty string only.
    const namespace = manifest.namespace as string;
    const wouldBe = `${namespace}${CUSTOMIZATION_NAMESPACE_SUFFIX}`;
    const id = typeof manifest.id === 'string' && manifest.id !== '' ? manifest.id : undefined;
    findings.push({
      severity: 'warning',
      rule: NAMESPACE_NO_CUSTOMIZATION_PAIR,
      where: id ? `package "${id}"` : 'package manifest',
      path: `${at}.namespace`,
      message:
        `namespace "${namespace}" is ${namespace.length} characters, so this package has no paired ` +
        `customization namespace: "${wouldBe}" would be ${wouldBe.length}, past the ` +
        `${NAMESPACE_MAX_LENGTH} a namespace may have, and installers cannot customize the package`,
      hint:
        `shorten manifest.namespace to ${MAX_CUSTOMIZATION_BASE_NAMESPACE_LENGTH} characters or fewer, ` +
        'and rename the object names it prefixes to match',
    });
  }
  return findings;
}
