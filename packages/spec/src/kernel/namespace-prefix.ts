// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Namespace-prefix rules (ADR-0028 current-state contract).
 *
 * A package declares a short `manifest.namespace`; every `object.name` it
 * defines MUST be `${namespace}_${shortName}` (except platform-reserved
 * `sys_*` objects). See {@link file://../kernel/manifest.zod.ts} `namespace`.
 *
 * These helpers are the SINGLE source of that rule so the two enforcement
 * points cannot drift:
 *  - `defineStack()` / `os validate` (compile-time) — `validateNamespacePrefix`
 *    in `stack.zod.ts`.
 *  - `MetadataManager.publishPackage()` (runtime, Studio "全部发布").
 *
 * It also holds K's predicate, {@link findNamespaceObjectNameClashes}: a
 * namespace never equals an object name (ADR-0150 D6, Q3). It lands here
 * unwired; the doors read it once child K wires them.
 */

import { NAMESPACE_PATTERN } from './address-grammar';
import { CUSTOMIZATION_NAMESPACE_SUFFIX } from './customization-package';

/**
 * Validate a single object name against a package namespace prefix.
 *
 * Returns an actionable error message, or `null` when the name is compliant.
 * `sys_*` names are platform-reserved and always allowed. When `namespace` is
 * empty the check is skipped (returns `null`) — callers decide whether an
 * absent namespace is itself an error.
 */
export function validateObjectNamespacePrefix(
  objectName: string | undefined,
  namespace: string | undefined,
): string | null {
  if (!objectName || !namespace) return null;
  if (objectName.startsWith('sys_')) return null;

  const expectedPrefix = `${namespace}_`;
  if (objectName.includes('__')) {
    return `Object '${objectName}' uses the legacy FQN form '<ns>__<short>'. Rename it to '${expectedPrefix}${objectName.slice(objectName.indexOf('__') + 2)}'.`;
  }
  if (!objectName.startsWith(expectedPrefix)) {
    return `Object '${objectName}' is missing the package namespace prefix. Rename it to '${expectedPrefix}${objectName}' (namespace = '${namespace}').`;
  }
  return null;
}

/**
 * Derive a default namespace from a package id when the manifest declares none.
 *
 * Uses the last dot-segment of the id (`com.example.leave` → `leave`),
 * lowercased and sanitized to the namespace charset. Returns `null` when
 * nothing valid can be derived (caller then leaves the namespace unset rather
 * than inventing a bad one). This only supplies a DEFAULT for packages that
 * omit `namespace`; an explicitly declared namespace always wins.
 */
export function deriveNamespaceFromPackageId(packageId: string | undefined): string | null {
  if (!packageId) return null;
  const seg = packageId.split('.').pop() ?? packageId;
  const ns = seg
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_') // non-charset → underscore
    .replace(/^[^a-z]+/, '') // must start with a letter
    .slice(0, 20);
  return NAMESPACE_PATTERN.test(ns) ? ns : null;
}

// ─────────────────────────────────────────────────────────────────────
// A namespace never equals an object name (ADR-0150 D6, Q3 = A, child K)
// ─────────────────────────────────────────────────────────────────────

/** A namespace as the environment's catalogue holds it. */
export interface NamespaceHolder {
  readonly namespace: string;
  /** The package that declares it, when the caller knows it — named in the refusal. */
  readonly packageId?: string;
}

/** An object name as the environment's catalogue holds it. */
export interface ObjectNameHolder {
  readonly name: string;
  /** The namespace of the package that defines it; absent for an environment-authored object. */
  readonly namespace?: string;
  /** The package that defines it, when the caller knows it — named in the refusal. */
  readonly packageId?: string;
}

/** One side of the comparison: the namespaces and the object names it holds. */
export interface NamespaceObjectCatalogue {
  readonly namespaces?: readonly NamespaceHolder[];
  readonly objects?: readonly ObjectNameHolder[];
}

/** A clash {@link findNamespaceObjectNameClashes} refuses. */
export interface NamespaceObjectNameClash {
  /**
   * `namespace-equals-object`: a namespace and an object name are the same
   * string. `object-short-named-custom`: an object of namespace `NS` is named
   * `NS_custom`, the namespace the ADR-0146 paired package of `NS` takes.
   */
  readonly kind: 'namespace-equals-object' | 'object-short-named-custom';
  /** The namespace the object name equals (for `object-short-named-custom`, the pair's). */
  readonly namespace: string;
  readonly objectName: string;
  /** An actionable sentence naming both spellings. */
  readonly message: string;
}

function holderOf(packageId: string | undefined): string {
  return packageId ? ` of package '${packageId}'` : '';
}

function objectSpelling(object: ObjectNameHolder, article: 'the' | 'The' = 'the'): string {
  if (object.packageId) return `${article} object '${object.name}' of package '${object.packageId}'`;
  if (object.namespace) return `${article} object '${object.name}' of namespace '${object.namespace}'`;
  return `${article} environment object '${object.name}'`;
}

/**
 * K's predicate: a namespace never equals an object name, in either
 * direction, and no package ships an object short-named `custom`
 * (ADR-0150 D6, ruled Q3 = A 「安装时拒绝」).
 *
 * Why: the AI face spells a namespaced item `NS-NAME` and an object-bound
 * action `OBJECT-ACTION`, and the address grammar reads a first segment that
 * names an installed namespace as that namespace (D5). Both readings put a
 * namespace and an object name in the same position, so a namespace equal to
 * an object name makes `crm_lead-convert_lead` and
 * `/actions/crm_lead/convert_lead/REC1` name two things. The refusal closes
 * that at the door instead of guessing at the read. The paired
 * customization package of `NS` takes the namespace `NS_custom` (ADR-0146),
 * so an object `NS_custom` is refused before any pair exists.
 *
 * `incoming` is what the caller is about to admit (a stack, a package being
 * installed, an object being published); `installed` is what the environment
 * already holds. Both directions are judged: each incoming namespace against
 * every object name on either side, and each incoming object name against
 * every installed namespace (an incoming namespace already met it in the
 * first direction, so no clash is reported twice). A clash already present
 * between two installed holders is not this call's to report.
 *
 * The predicate only judges; it refuses nothing by itself. The doors that
 * call it (`defineStack`, `os validate`, install, Studio publish) are child
 * K's to wire.
 */
export function findNamespaceObjectNameClashes(
  incoming: NamespaceObjectCatalogue,
  installed: NamespaceObjectCatalogue = {},
): NamespaceObjectNameClash[] {
  const clashes: NamespaceObjectNameClash[] = [];
  const incomingObjects = incoming.objects ?? [];
  const allObjects = [...incomingObjects, ...(installed.objects ?? [])];

  for (const holder of incoming.namespaces ?? []) {
    for (const object of allObjects) {
      if (object.name !== holder.namespace) continue;
      clashes.push({
        kind: 'namespace-equals-object',
        namespace: holder.namespace,
        objectName: object.name,
        message: `Namespace '${holder.namespace}'${holderOf(holder.packageId)} equals ${objectSpelling(object)}. `
          + 'A namespace never equals an object name: the AI face and the qualified address put both in the '
          + 'same position, so the two would name each other (ADR-0150 D6). Rename the namespace or the object.',
      });
    }
  }

  for (const object of incomingObjects) {
    for (const holder of installed.namespaces ?? []) {
      if (holder.namespace !== object.name) continue;
      clashes.push({
        kind: 'namespace-equals-object',
        namespace: holder.namespace,
        objectName: object.name,
        message: `${objectSpelling(object, 'The')} equals the installed namespace `
          + `'${holder.namespace}'${holderOf(holder.packageId)}. A namespace never equals an object name: the AI `
          + 'face and the qualified address put both in the same position, so the two would name each other '
          + '(ADR-0150 D6). Rename the object.',
      });
    }
    if (object.namespace && object.name === `${object.namespace}${CUSTOMIZATION_NAMESPACE_SUFFIX}`) {
      clashes.push({
        kind: 'object-short-named-custom',
        namespace: object.name,
        objectName: object.name,
        message: `${objectSpelling(object, 'The')} is short-named 'custom'. The paired `
          + `customization package of namespace '${object.namespace}' takes the namespace '${object.name}' `
          + '(ADR-0146), which would equal this object name (ADR-0150 D6). Rename the object.',
      });
    }
  }

  return clashes;
}

// ─────────────────────────────────────────────────────────────────────
// Two package holders of one name, judged by their namespaces (ADR-0150 D2/D9)
// ─────────────────────────────────────────────────────────────────────

/**
 * Do two PACKAGE holders of one name meet, judged by the namespaces they
 * declare, so that one may be refused because the other holds the name?
 * They meet unless both declare a namespace and the two differ: two
 * namespaces give the two items two addresses (`/actions/NS/global/NAME`,
 * `NS/NAME`) and two AI faces (`NS-NAME`), and every by-name reader resolves a
 * bare name by `(package, name)` or refuses it naming both. A package with no
 * namespace has no address of its own, so it meets every holder; two packages
 * of ONE namespace meet, the shareable platform namespaces and the co-owners
 * of ADR-0150 D2 included.
 *
 * The ONE copy of the namespace half of the rule, read by both doors that
 * judge a pair of holders: the install gate (`bareNameHoldersMeet` in
 * `@objectstack/objectql`, for a type whose one-holder rule has narrowed to
 * the namespace) and `composeStacks` (two input stacks' object-less action of
 * one name, under `manifest: 'preserve'`). It lives here because `composeStacks`
 * cannot import the engine. It judges namespaces only: which types narrowed,
 * and that two bodies of one package are one holder, stay with each door.
 */
export function namespacedHoldersMeet(
  incomingNamespace: string | undefined,
  holderNamespace: string | undefined,
): boolean {
  return !(incomingNamespace && holderNamespace && incomingNamespace !== holderNamespace);
}
