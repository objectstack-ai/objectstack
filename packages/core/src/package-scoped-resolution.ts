// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # The one rule for "which package's item does this bare name mean" (ADR-0150 D3)
 *
 * The pure core of the package-scoped resolver: D3's three steps over a holder
 * set and a dependency closure the CALLER supplies, the refusal it answers and
 * the vocabulary that refusal is written in. It reads no registry and imports
 * nothing, so every reader can call it, wherever it sits.
 *
 * ## Why this lives in `@objectstack/core` (epic #31527, child R2)
 *
 * The readers epic #31527 wires sit at three depths: inside objectql's lean
 * `./core` entry (`SchemaRegistry`, the engine's action and function
 * registries), below objectql (`@objectstack/core`'s security catalog), and
 * above it (the automation service, the plugins). ADR-0076 D2 keeps
 * `@objectstack/metadata-protocol` out of the lean entry, and objectql's first
 * resolver read its closure there, so the first two depths could not call it.
 * A second, local copy of the rule at either depth is the drift child R exists
 * to prevent. `@objectstack/core` is a dependency of every one of them and is
 * in the lean entry's admitted set, so hosting the rule here adds no package
 * edge. Its two inputs come from the caller:
 *
 *  - **the holders** ({@link PackageScopedHolderSource}): objectql's
 *    `resolvePackageScopedName` builds them from `SchemaRegistry` (the
 *    per-package overlay slot of D4), and the engine's function registry
 *    from its per-package function map (D4's last row);
 *  - **the closure** of the caller package: its declared dependencies plus
 *    every `sys` package — `packageResolutionClosure` in
 *    `@objectstack/metadata-core`, the save door's own walk.
 *
 * ## The rule (ADR-0150 D3, as ruled)
 *
 * A caller that belongs to package P resolves a bare name to:
 *
 *  1. **P's own item**;
 *  2. else **the unique holder in P's resolution closure** — its declared
 *     dependency closure (ADR-0141) plus every package of the reserved kernel
 *     namespace `sys` (D2);
 *  3. else a **refusal that names every candidate**.
 *
 * A caller with no package (an environment item, a context-free door, an MCP
 * client) resolves against the whole environment: the environment's own item
 * first (ADR-0005 overlay precedence), else the unique package holder, else
 * the refusal naming every candidate (the doors map it to `409`, D5).
 *
 * **Zero holders is not-found, never a refusal.**
 *
 * ## The two red lines (epic #31527)
 *
 *  - **It never loosens.** No first-registered fallback, no environment-wide
 *    guess for a caller with a package (a holder outside P's closure is
 *    refused, never served), and no silent pick between two candidates of
 *    one step.
 *  - **Ambiguity is reported, never guessed.** Every refusal carries every
 *    candidate of the step that refused.
 *
 * ## The exceptions (ADR-0150 D3, ruled)
 *
 *  - **Names the platform requests by spelling**
 *    ({@link PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE}): environment-wide whatever
 *    the caller, one holder.
 *  - **Positions** are one environment-wide slot (D7), and objects keep their
 *    literal name (ADR-0129): neither is a {@link PackageScopedResolvableType},
 *    and asking for one throws.
 *  - **An overridable baseline** ({@link OVERRIDABLE_BASELINE_PACKAGES}) answers
 *    only when no other candidate of that step does.
 *  - **The platform's item** ({@link PackageScopedHolderSource.platformItem}:
 *    an engine function a plugin or the host registers under no package) is
 *    in every caller's reach, like `sys` (D2): step 2 counts it beside the
 *    closure's holders, and a caller with no package counts it beside every
 *    package holder once no environment item answers (epic seat rulings on
 *    #31733, 6729484996 and 6730444942).
 */

// ---------------------------------------------------------------------------
// The holder vocabulary (phase 1's, ADR-0048 §3.4 as narrowed; objectql's
// `bare-name-one-holder.ts` holds the rule it is written for and re-exports
// these, so there is one copy of each).
// ---------------------------------------------------------------------------

/**
 * A type phase 1's one-holder rule covers that the registry stores — its items
 * reach the engine's package door and the registry's item seam.
 */
export type BareNameRegistryType =
  | 'picklist' | 'mapping' | 'dataset'
  | 'api' | 'action'
  | 'flow' | 'webhook' | 'connector' | 'email_template'
  | 'agent' | 'skill' | 'tool';

/**
 * A type phase 1 covers: a registry type, or `function` — the engine's
 * function registry, which a package reaches through the hook binder's bind
 * alone.
 */
export type BareNameOneHolderType = BareNameRegistryType | 'function';

/**
 * Every type phase 1 covers, in the order a refusal and a cold boot list them:
 * one family after another, each in the order its change named them.
 */
export const BARE_NAME_ONE_HOLDER_TYPES: readonly BareNameOneHolderType[] = Object.freeze([
  // the data family
  'picklist',
  'mapping',
  'dataset',
  // the request family
  'api',
  'action',
  'function',
  // the flow family
  'flow',
  'webhook',
  'connector',
  'email_template',
  // the AI family
  'agent',
  'skill',
  // joined after the AI family, in its own change (#31414)
  'tool',
]);

/** Is `type` one of the types phase 1 covers? */
export function isBareNameOneHolderType(type: unknown): type is BareNameOneHolderType {
  return typeof type === 'string' && (BARE_NAME_ONE_HOLDER_TYPES as readonly string[]).includes(type);
}

/**
 * [ADR-0150 D2/D9, child B] The covered types whose one-holder rule has
 * narrowed from the deployment to the namespace (`@objectstack/objectql`'s
 * `bare-name-one-holder.ts` module doc, "The narrowing"). Each type joins in
 * its own trailing change, once its by-name readers, its AI faces and its
 * stored references all carry the package: the AI family's `agent` and
 * `skill` first (#31701), then the object-less `action` (#31697), then
 * `email_template` (#31699), and `tool` beside the AI family (#31985), whose
 * one by-name reader (`/meta/tool/NAME`) resolves by package. A type not
 * listed here keeps one package holder per deployment.
 *
 * Here, not in objectql, so a reader objectql depends on can read it too: the
 * metadata protocol refuses a bare read of a narrowed type that an engine
 * reads through `getItem` (epic #31527, #32076), since two packages may hold
 * its name. objectql re-exports it under the same name.
 */
export const NAMESPACE_SCOPED_BARE_NAME_TYPES: readonly BareNameOneHolderType[] = Object.freeze([
  'agent',
  'skill',
  // the AI family's third type, in its own change (#31985)
  'tool',
  'action',
  'email_template',
]);

/** Has `type`'s one-holder rule narrowed to the namespace ({@link NAMESPACE_SCOPED_BARE_NAME_TYPES})? */
export function isNamespaceScopedBareNameType(type: unknown): boolean {
  return typeof type === 'string' && (NAMESPACE_SCOPED_BARE_NAME_TYPES as readonly string[]).includes(type);
}

/**
 * Per covered type, the packages whose items are an OVERRIDABLE BASELINE: the
 * platform's copies, which that type's one consumer serves any other package's
 * same-named item over, by contract. Such a package neither holds a name of
 * that type nor is refused one under phase 1, and under ADR-0150 D3 (b) it
 * ranks below every other holder of a step.
 *
 * `email_template`: the email service declares the built-in auth templates
 * under its own package id (`EmailServicePlugin.init`, `@objectstack/plugin-email`),
 * and its template loader picks any other package's `(name, locale)` member
 * before the built-in's (`BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID` there — the
 * same spelling, held together by the flow family's booted dogfood pin: an
 * app overriding a built-in template installs only while the two agree).
 */
export const OVERRIDABLE_BASELINE_PACKAGES: Readonly<Record<BareNameOneHolderType, ReadonlySet<string>>> = Object.freeze({
  picklist: new Set<string>(),
  mapping: new Set<string>(),
  dataset: new Set<string>(),
  api: new Set<string>(),
  action: new Set<string>(),
  function: new Set<string>(),
  flow: new Set<string>(),
  webhook: new Set<string>(),
  connector: new Set<string>(),
  email_template: new Set<string>(['com.objectstack.service.email']),
  agent: new Set<string>(),
  skill: new Set<string>(),
  tool: new Set<string>(),
});

/**
 * Is `packageId`'s item of `type` an overridable baseline
 * ({@link OVERRIDABLE_BASELINE_PACKAGES}) — never a holder, never judged?
 */
export function isOverridableBaseline(type: BareNameOneHolderType, packageId: string | undefined): boolean {
  return packageId !== undefined && OVERRIDABLE_BASELINE_PACKAGES[type].has(packageId);
}

/** Who holds a covered name under phase 1: a package, or the platform as a built-in. */
export type BareNameHolder =
  | { readonly kind: 'package'; readonly packageId: string }
  | { readonly kind: 'built-in' };

/** How a refusal names a holder. */
export function describeBareNameHolder(holder: BareNameHolder): string {
  return holder.kind === 'package'
    ? `package "${holder.packageId}"`
    : 'the platform, as a built-in name no package can declare';
}

// ---------------------------------------------------------------------------
// What the rule resolves.
// ---------------------------------------------------------------------------

/**
 * The metadata types addressed by `(package, name)` — ADR-0150 D1 buckets 2
 * and 3, as the registry spells them. `rag_pipeline` (bucket 3 in D1) has no
 * registry type since ADR-0049 retired the collection, so it is not listed;
 * `position` is environment-scoped (D7) and is not listed either.
 */
export const PACKAGE_SCOPED_TYPES = Object.freeze([
  // bucket 2
  'flow',
  'action',
  'hook',
  'job',
  'webhook',
  'mapping',
  'connector',
  'permission',
  'sharing_rule',
  'queue',
  'assignment_rule',
  'app',
  'page',
  'dashboard',
  'report',
  'dataset',
  'analytics_cube',
  'picklist',
  'email_template',
  'book',
  'api',
  // bucket 3
  'tool',
  'skill',
  'agent',
] as const);

/** A type addressed by `(package, name)` ({@link PACKAGE_SCOPED_TYPES}). */
export type PackageScopedType = (typeof PACKAGE_SCOPED_TYPES)[number];

/** Is `type` addressed by `(package, name)`? */
export function isPackageScopedType(type: unknown): type is PackageScopedType {
  return typeof type === 'string' && (PACKAGE_SCOPED_TYPES as readonly string[]).includes(type);
}

/**
 * The engine's function registry, as the rule names its holders: not a
 * metadata type (so not in {@link PACKAGE_SCOPED_TYPES}), and resolved in the
 * package of the flow or action that names it (ADR-0150 D4's last row).
 * Phase 1 spells the same registry the same way ({@link BARE_NAME_ONE_HOLDER_TYPES}).
 */
export const ENGINE_FUNCTION_TYPE = 'function';

/** What the rule resolves: a type addressed by `(package, name)`, or the engine's functions. */
export type PackageScopedResolvableType = PackageScopedType | typeof ENGINE_FUNCTION_TYPE;

/** Does the rule resolve `type` ({@link PackageScopedResolvableType})? */
export function isPackageScopedResolvableType(type: unknown): type is PackageScopedResolvableType {
  return type === ENGINE_FUNCTION_TYPE || isPackageScopedType(type);
}

/**
 * Names the PLATFORM requests by spelling, per type (ADR-0150 D3 Exceptions):
 * they resolve environment-wide whatever the caller's package, and keep one
 * holder.
 *
 *  - `permission` — the public form doors' submit context requests the
 *    permission set `guest_portal` by name (`packages/rest/src/form-routes.ts`);
 *    the same entry as `@objectstack/cli`'s `PLATFORM_REQUESTED_BARE_NAMES`,
 *    keyed by registry type instead of stack collection.
 *  - `email_template` — the auth mails the platform sends by name with no
 *    package (plugin-auth through `IEmailService.sendTemplate`): the
 *    `auth.*` templates the email service code-declares as its overridable
 *    baseline (`BUILTIN_AUTH_TEMPLATES`, plugin-email). An app overrides one by
 *    declaring its name (ADR-0131 D10), and a deployment keeps one overriding
 *    package per name even once the type's one-holder rule narrows to the
 *    namespace (ADR-0150 D9, #31699): two would leave every password reset
 *    refused as ambiguous. The CLI's prefix rule judges no email template, so
 *    its list carries none.
 */
export const PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE: Readonly<Partial<Record<PackageScopedType, readonly string[]>>> = Object.freeze({
  permission: Object.freeze(['guest_portal']),
  email_template: Object.freeze([
    'auth.password_reset',
    'auth.verify_email',
    'auth.magic_link',
    'auth.invitation',
    'auth.account_invitation',
    'auth.two_factor_otp',
    'auth.email_change_notice',
    'auth.existing_account_sign_up',
  ]),
});

/** Is `(type, name)` one the platform requests by spelling? */
export function isPlatformRequestedBareName(type: PackageScopedType, name: string): boolean {
  return PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE[type]?.includes(name) ?? false;
}

/** The value `_packageId` carries for a row rehydrated from `sys_metadata`: not a package. */
const OVERLAY_PROVENANCE_SENTINEL = 'sys_metadata';

/**
 * The package id `ObjectQL#registerObject` stamps when its caller gives none
 * (the legacy compatibility API's default). It names no installed package, so
 * a caller carrying it is a caller with no package: the rule reads it as one,
 * beside the `sys_metadata` sentinel, rather than as a package whose closure
 * is empty (which would refuse it every environment item, D3 (a)). Only the
 * caller side: how an item stamped with it counts as a holder is unchanged.
 * The one spelling; the compatibility API reads it from here.
 */
export const RUNTIME_COMPATIBILITY_PACKAGE_ID = '__runtime__';

// ---------------------------------------------------------------------------
// The answer.
// ---------------------------------------------------------------------------

/**
 * Who holds a name under package addressing: a package (the vocabulary's own
 * {@link BareNameHolder}), the environment's own item — an item authored in
 * this environment, in the implicit environment package (ADR-0150 D1 bucket 4)
 * — or the platform: code a plugin or the host registers under no package (an
 * owner-less engine function), reachable from every caller like `sys` (D2;
 * epic seat ruling on #31733, 6729484996).
 */
export type PackageScopedHolder =
  | Extract<BareNameHolder, { kind: 'package' }>
  | { readonly kind: 'environment' }
  | { readonly kind: 'platform' };

/** How a refusal names a holder. */
export function describePackageScopedHolder(holder: PackageScopedHolder): string {
  if (holder.kind === 'environment') return 'the environment (an item authored in this environment, bound to no package)';
  if (holder.kind === 'platform') return 'the platform (registered by a plugin or the host, owned by no package)';
  return describeBareNameHolder(holder);
}

/** How the resolved item was reached (ADR-0150 D3's steps). */
export type PackageScopedResolutionStep =
  /** the caller package's own item */
  | 'own'
  /** the unique holder in the caller's declared dependency closure (plus `sys`) */
  | 'closure'
  /** the environment's own item (a caller with no package) */
  | 'environment'
  /** the unique package holder in the environment (a caller with no package) */
  | 'unique-holder'
  /** an overridable baseline, reached because no other candidate of the step holds the name */
  | 'baseline'
  /** the platform's item (owned by no package, in every caller's reach), the step's only candidate */
  | 'platform';

/** Why a resolution refused. */
export type PackageScopedRefusalReason =
  /** two or more holders in the caller package's declared closure (plus `sys`) */
  | 'ambiguous-in-closure'
  /** two or more package holders in the environment, and the caller names no package */
  | 'ambiguous-in-environment'
  /** holders exist, and none is in the caller package's declared closure (plus `sys`) */
  | 'outside-closure'
  /**
   * [ADR-0150 D5, child G1] the read names a package as its exact qualifier
   * (`?package=X`, `/meta/:type/:ns/:name`), or the environment (`_env`), and
   * it holds no item of the name; other holders do. `callerPackageId` is the
   * package named, `null` for the environment.
   */
  | 'not-held-by-qualifier'
  /**
   * [ADR-0150 D2/D5, child G1] the read names a namespace (`/meta/:type/:ns/:name`)
   * that two or more packages share (a shareable namespace: `base`, `system`,
   * `sys`), and more than one of them holds the name. `callerPackageId` is
   * `null`: the address names no one package.
   */
  | 'ambiguous-in-namespace';

/** A resolution's answer. */
export type PackageScopedResolution<T = unknown> =
  | {
      readonly status: 'resolved';
      readonly item: T;
      readonly holder: PackageScopedHolder;
      readonly via: PackageScopedResolutionStep;
    }
  | { readonly status: 'not-found' }
  | PackageScopedRefusal;

/** A refusal: every candidate named, and nothing picked. */
export interface PackageScopedRefusal {
  readonly status: 'refused';
  readonly reason: PackageScopedRefusalReason;
  readonly type: PackageScopedResolvableType;
  readonly name: string;
  /** The caller's package, or `null` for a caller with no package. */
  readonly callerPackageId: string | null;
  /** Every candidate of the step that refused, in the item store's order. */
  readonly candidates: readonly PackageScopedHolder[];
  /** One sentence naming the item, every candidate and what to do. */
  readonly message: string;
}

// ---------------------------------------------------------------------------
// The inputs.
// ---------------------------------------------------------------------------

/** What the rule is asked. */
export interface PackageScopedHoldersQuery {
  readonly type: PackageScopedResolvableType;
  readonly name: string;
  /**
   * The package the caller belongs to; omitted, `null`, `''`, the
   * `sys_metadata` sentinel or {@link RUNTIME_COMPATIBILITY_PACKAGE_ID} is a
   * caller with no package.
   */
  readonly callerPackageId?: string | null;
}

/**
 * Who holds a name, and their items: the three things the rule reads, from
 * whichever store keeps them. Read only when a step needs it.
 */
export interface PackageScopedHolderSource<T = unknown> {
  /** Every package holding the name, each once, in the store's order. */
  readonly packageHolders: readonly string[];
  /**
   * A package holder's item: its own, with whatever binds to it. `undefined`
   * when it lacks what was asked (a bundle member), which answers not-found.
   */
  packageItem(packageId: string): T | undefined;
  /**
   * The environment's own item of the name — bound to no package — or
   * `undefined`. In the registry that is a package-less row under a name no
   * package holds (ADR-0150 D4: over a held name, the row is the holder's
   * overlay).
   */
  environmentItem(): T | undefined;
  /**
   * The platform's item of the name — code a plugin or the host registered
   * under no package (an owner-less engine function) — or `undefined`.
   * Omitted, there is none. Like a `sys` package (ADR-0150 D2) it is in every
   * caller's reach: a package caller that holds no item itself counts it
   * beside its closure's holders, and a caller with no package counts it
   * beside every package holder once no environment item answers. Either
   * way the only candidate answers, and two or more refuse naming each.
   */
  platformItem?(): T | undefined;
}

/**
 * A caller package's resolution closure (ADR-0150 D3 step 2): the packages
 * other than itself whose items it may resolve a bare name to — its declared
 * dependency closure plus every `sys` package. Asked only for a caller with a
 * package that holds no item of the name itself.
 */
export type PackageResolutionClosureOf = (callerPackageId: string) => ReadonlySet<string>;

/**
 * A holder source over `(package, item)` pairs, a `null` package being the
 * environment's own item. The order of the pairs is the store's order, which
 * is the order every refusal names its candidates in. A snapshot: the pairs
 * are read once, here.
 *
 * @throws {TypeError} when two pairs name one holder: a holder set holds each
 *   holder once, and the rule never picks between two items of one holder.
 */
export function packageScopedHolderSource<T>(
  holdings: Iterable<readonly [packageId: string | null, item: T]>,
): PackageScopedHolderSource<T> {
  const items = new Map<string | null, T>();
  for (const [packageId, item] of holdings) {
    if (items.has(packageId)) {
      throw new TypeError(
        `[package-scoped-resolution] the holder set names ${packageId === null ? 'the environment' : `package "${packageId}"`} twice; ` +
        'a holder holds a name once (ADR-0150 D3).',
      );
    }
    items.set(packageId, item);
  }
  const packageHolders = Object.freeze([...items.keys()].filter((id): id is string => id !== null));
  return Object.freeze({
    packageHolders,
    packageItem: (packageId: string) => items.get(packageId),
    environmentItem: () => items.get(null),
  });
}

// ---------------------------------------------------------------------------
// The rule.
// ---------------------------------------------------------------------------

/** Is `packageId`'s item of `type` an overridable baseline (the vocabulary's predicate)? */
function isBaseline(type: PackageScopedResolvableType, packageId: string): boolean {
  return isBareNameOneHolderType(type) && isOverridableBaseline(type, packageId);
}

const packageHolder = (packageId: string): PackageScopedHolder => ({ kind: 'package', packageId });

function typeLabel(type: PackageScopedResolvableType): string {
  switch (type) {
    case 'api': return 'API';
    case 'email_template': return 'email template';
    case 'sharing_rule': return 'sharing rule';
    case 'assignment_rule': return 'assignment rule';
    case 'analytics_cube': return 'analytics cube';
    case 'permission': return 'permission set';
    default: return type;
  }
}

/**
 * The sentence a refusal carries: the item, why it refused, every candidate
 * (in the vocabulary's words) and the one thing a caller can do about it.
 */
export function packageScopedRefusalMessage(refusal: Omit<PackageScopedRefusal, 'message'>): string {
  const subject = `The ${typeLabel(refusal.type)} "${refusal.name}"`;
  const named = refusal.candidates.map(describePackageScopedHolder).join('; ');
  const platform = refusal.candidates.some((c) => c.kind === 'platform');
  switch (refusal.reason) {
    case 'ambiguous-in-closure':
      return `${subject} is held by ${refusal.candidates.length} ${platform ? 'holders' : 'packages'} in the declared dependency closure of ` +
        `package "${refusal.callerPackageId}"${platform ? ' and the platform' : ''}: ${named}. Nothing picks one of them: address it by its package.`;
    case 'ambiguous-in-environment':
      return `${subject} is held by ${refusal.candidates.length} ${platform ? 'holders' : 'packages'} in this environment and the caller names ` +
        `no package: ${named}. Nothing picks one of them: address it by its package.`;
    case 'outside-closure':
      return `${subject} is held outside the declared dependency closure of package "${refusal.callerPackageId}": ` +
        `${named}. Declare a dependency on the package that holds it (ADR-0141).`;
    case 'not-held-by-qualifier':
      return `${subject} is not held by ${refusal.callerPackageId === null ? 'the environment' : `package "${refusal.callerPackageId}"`}, ` +
        `which the address names exactly (ADR-0150 D5): it is held by ${named}. Address it by its holder.`;
    case 'ambiguous-in-namespace':
      return `${subject} is held by ${refusal.candidates.length} packages that share the namespace the address names ` +
        `(ADR-0150 D2): ${named}. Nothing picks one of them: address it by its package.`;
  }
}

/**
 * [ADR-0150 D3, #32244] The sentence a refusal of an ACTION name appends to
 * {@link packageScopedRefusalMessage}'s when its package holders each bind the
 * name to their own object: two packages' actions of one name on two objects
 * are two different actions, and a read that cannot see the object would pick
 * one. Names each package with the object(s) it binds the name to, in the
 * map's order; `undefined` is an object-less action. Where every package binds
 * it to the one same object (or each holds it object-less), the sentence only
 * names them, without calling them different actions.
 */
export function packageScopedActionOwnersSentence(
  objectsByPackage: ReadonlyMap<string, ReadonlyArray<string | undefined>>,
): string {
  const owners = [...objectsByPackage].map(([packageId, objects]) => {
    const named = [...new Set(objects)].map((object) => (object === undefined ? 'no object' : `object "${object}"`));
    return `package "${packageId}" binds it to ${named.join(' and ')}`;
  });
  const objects = new Set([...objectsByPackage.values()].flatMap((bound) => [...bound]));
  if (objects.size > 1) return `Each is a different action: ${owners.join('; ')}.`;
  const sentence = owners.join('; ');
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

/**
 * A by-name read the package-scoped rule refused (ADR-0150 D3): the name means
 * more than one item here, or only items the caller may not reach. The message
 * is the refusal's own sentence ({@link packageScopedRefusalMessage}), which
 * names every candidate.
 *
 * The ONE class every package-scoped by-name door throws — objectql's readers
 * and plugin-sharing's declared-name doors alike re-export this binding, so a
 * catcher matches every one of them with a single `instanceof`. It lives here,
 * beside the refusal it carries, because this is the lowest package all of
 * them read.
 *
 * The ADR-0112 envelope a wire door answers: `409 RESOURCE_CONFLICT`, the
 * standard catalog's member for a name in conflict, which ADR-0150 D5 gives a
 * by-name door's ambiguity. ⛔ Never the `500` fallback, and never `404`.
 */
export class PackageScopedNameRefusedError extends Error {
  readonly code = 'RESOURCE_CONFLICT';
  readonly status = 409;
  /** The same number under ADR-0112 D5's spelling — what a consumer holding the THROWN error reads. */
  readonly httpStatus = 409;
  /** The refusal: the reason, the caller's package and every candidate. */
  readonly refusal: PackageScopedRefusal;

  constructor(refusal: PackageScopedRefusal) {
    super(refusal.message);
    this.name = 'PackageScopedNameRefusedError';
    this.refusal = refusal;
  }
}

function refuse(
  query: PackageScopedHoldersQuery,
  callerPackageId: string | null,
  reason: PackageScopedRefusalReason,
  candidates: readonly PackageScopedHolder[],
): PackageScopedRefusal {
  const base = { status: 'refused' as const, reason, type: query.type, name: query.name, callerPackageId, candidates };
  return { ...base, message: packageScopedRefusalMessage(base) };
}

/**
 * The one step of ADR-0150 D3 that picks among package holders: exactly one
 * candidate other than an overridable baseline answers; two or more refuse,
 * naming every one; none falls to the baselines by the same rule; `none` when
 * no candidate holds the name at all.
 */
function pickUnique(
  type: PackageScopedResolvableType,
  candidates: readonly string[],
): { kind: 'one'; packageId: string; baseline: boolean } | { kind: 'several'; packageIds: string[] } | { kind: 'none' } {
  const primary = candidates.filter((id) => !isBaseline(type, id));
  if (primary.length === 1) return { kind: 'one', packageId: primary[0], baseline: false };
  if (primary.length > 1) return { kind: 'several', packageIds: primary };
  const baselines = candidates.filter((id) => isBaseline(type, id));
  if (baselines.length === 1) return { kind: 'one', packageId: baselines[0], baseline: true };
  if (baselines.length > 1) return { kind: 'several', packageIds: baselines };
  return { kind: 'none' };
}

/** A package's item, as a resolution — or not-found when it lacks what was asked. */
function packageItem<T>(
  source: PackageScopedHolderSource<T>,
  packageId: string,
  via: PackageScopedResolutionStep,
): PackageScopedResolution<T> {
  const item = source.packageItem(packageId);
  return item === undefined ? { status: 'not-found' } : { status: 'resolved', item, holder: packageHolder(packageId), via };
}

/** A caller with no package, or a platform-requested name: the whole environment (ADR-0150 D3). */
function resolveEnvironmentWide<T>(
  query: PackageScopedHoldersQuery,
  callerPackageId: string | null,
  source: PackageScopedHolderSource<T>,
): PackageScopedResolution<T> {
  const environmentItem = source.environmentItem();
  if (environmentItem !== undefined) {
    return { status: 'resolved', item: environmentItem, holder: { kind: 'environment' }, via: 'environment' };
  }
  // The platform's item is one more holder beside the packages: the only one
  // answers, and beside any package holder the name refuses, naming each.
  const platformItem = source.platformItem?.();
  if (platformItem !== undefined) {
    if (source.packageHolders.length === 0) return { status: 'resolved', item: platformItem, holder: { kind: 'platform' }, via: 'platform' };
    return refuse(query, callerPackageId, 'ambiguous-in-environment', [...source.packageHolders.map(packageHolder), { kind: 'platform' }]);
  }
  const pick = pickUnique(query.type, source.packageHolders);
  if (pick.kind === 'one') return packageItem<T>(source, pick.packageId, pick.baseline ? 'baseline' : 'unique-holder');
  if (pick.kind === 'several') return refuse(query, callerPackageId, 'ambiguous-in-environment', pick.packageIds.map(packageHolder));
  return { status: 'not-found' };
}

/**
 * Resolve a bare name by ADR-0150 D3 (module doc) over the holders `source`
 * supplies and the closure `closureOf` supplies. Writes nothing, and never
 * throws for a name — only for a type the rule does not resolve
 * ({@link PackageScopedResolvableType}), which is a caller's programming error.
 *
 * @returns `resolved` with the item, its holder and the step that reached it;
 *   `not-found` when nothing holds the name; `refused` naming every candidate
 *   of the step that could not pick one.
 */
export function resolvePackageScopedHolders<T = unknown>(
  query: PackageScopedHoldersQuery,
  source: PackageScopedHolderSource<T>,
  closureOf: PackageResolutionClosureOf,
): PackageScopedResolution<T> {
  if (!isPackageScopedResolvableType(query.type)) {
    throw new TypeError(
      `[package-scoped-resolution] "${String(query.type)}" is not resolved by package (ADR-0150 D1, D4); ` +
      'positions are environment-scoped (D7) and objects keep their literal name (ADR-0129).',
    );
  }
  const raw = query.callerPackageId;
  const callerPackageId = typeof raw === 'string' && raw !== '' && raw !== OVERLAY_PROVENANCE_SENTINEL && raw !== RUNTIME_COMPATIBILITY_PACKAGE_ID
    ? raw
    : null;
  const holders = source.packageHolders;

  if (callerPackageId === null || (query.type !== ENGINE_FUNCTION_TYPE && isPlatformRequestedBareName(query.type, query.name))) {
    return resolveEnvironmentWide<T>(query, callerPackageId, source);
  }

  // Step 1 — the caller package's own item.
  if (holders.includes(callerPackageId)) return packageItem<T>(source, callerPackageId, 'own');

  // Step 2 — the unique holder in its resolution closure, the platform's
  // item counted beside it (in every caller's reach, like `sys`).
  const reach = closureOf(callerPackageId);
  const reachable = holders.filter((id) => reach.has(id));
  const platformItem = source.platformItem?.();
  if (platformItem !== undefined) {
    if (reachable.length === 0) return { status: 'resolved', item: platformItem, holder: { kind: 'platform' }, via: 'platform' };
    return refuse(query, callerPackageId, 'ambiguous-in-closure', [...reachable.map(packageHolder), { kind: 'platform' }]);
  }
  const pick = pickUnique(query.type, reachable);
  if (pick.kind === 'one') return packageItem<T>(source, pick.packageId, pick.baseline ? 'baseline' : 'closure');
  if (pick.kind === 'several') return refuse(query, callerPackageId, 'ambiguous-in-closure', pick.packageIds.map(packageHolder));

  // Step 3 — nothing reachable: a refusal naming every holder there is, or
  // not-found when there is none. ⛔ Never an environment-wide guess.
  const candidates: PackageScopedHolder[] = holders.map(packageHolder);
  if (source.environmentItem() !== undefined) candidates.push({ kind: 'environment' });
  if (candidates.length === 0) return { status: 'not-found' };
  return refuse(query, callerPackageId, 'outside-closure', candidates);
}
