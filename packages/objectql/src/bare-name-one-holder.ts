// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One name, one PACKAGE holder — the bare-name rule for the metadata types
 * whose consumers resolve a name without package context, and the vocabulary
 * {@link SchemaRegistry}'s refusal of a second holder is written in. The
 * security catalog's sibling (`security-catalog-namespace.ts`), generalised to
 * the types a booted two-package measurement found resolving to ONE package's
 * item for every caller (maintainer ruling C on #30798, phase 1; ADR-0048 §3.4,
 * narrowed 2026-11-06). Each family of covered types joins in its own change
 * under #30803: the data family first, then the request family (`api`, the
 * object-less `action`, the engine's function registry), then the flow family
 * (`flow`, `webhook`, `connector`, `email_template`), and last the AI family
 * (`agent`, `skill`), which closed the series. `tool` joined after it, in its
 * own change under #31414, once its readers were measured.
 *
 * ## The rule
 *
 * A package whose item of a covered type bears a name another installed
 * package (or the platform, as a built-in) already holds is refused at managed
 * install and at package registration, and the refusal names both holders and
 * the rename. Why these types: their consumers carry no package when they
 * resolve the name, so with two holders every caller is served the same one —
 * measured on a booted showcase with two packages sharing one bare name:
 *
 *  - `picklist` — a field's `picklist: NAME` resolved the FIRST-registered
 *    package's list for every object, so the second package's object was
 *    served the other package's options and refused its own values;
 *  - `mapping` — an import's `mappingName` resolved the first-registered
 *    package's mapping, and the other package's import answered
 *    `MAPPING_TARGET_MISMATCH`;
 *  - `dataset` — a dashboard's `datasetName` query ran the first-registered
 *    package's dataset;
 *  - `api` — the endpoint matcher kept ONE api per name, the last-registered,
 *    so the other package's declared path answered `404` (the picklist
 *    family, these four and `function`, since narrowed to the namespace:
 *    "The narrowing");
 *  - `action`, object-less only — `/actions/global/NAME` ran the
 *    last-registered package's handler while `/meta/action/NAME` served the
 *    first-registered package's declaration, so the button a client drew and
 *    the code that ran came from two packages (since narrowed to the
 *    namespace: "The narrowing");
 *  - `function` — the engine's function registry kept one function per name,
 *    the last-registered, and a flow `script` node's `function` resolved it
 *    with no package (an action's `target` names a handler key, never a
 *    registered function);
 *  - `flow` — the automation engine keys its flow map by the bare name and
 *    arms ONE flow per name, the lexicographically-first package's, whichever
 *    registered first (it warns, naming both); `/meta/flow/NAME` serves the
 *    FIRST-registered package's declaration, so the body the designer opens
 *    and the body that runs can come from two packages;
 *  - `webhook` — the dispatcher's declared-webhook reader keeps the
 *    FIRST-registered package's declaration per name and never subscribes
 *    the other, and `/meta/webhook/NAME` serves the same one;
 *  - `connector` — `/meta/connector/NAME` (the by-name door the designer's
 *    connector picker reads) serves the FIRST-registered package's
 *    declaration; a provider-bound instance is the engine's one connector
 *    per name, and a second one at boot already refuses the boot (ADR-0097);
 *  - `email_template` — a send's `template: NAME` resolves the
 *    FIRST-registered package's bundle, and `/meta/email_template/NAME`
 *    serves the same one;
 *  - `agent` — `/meta/agent/NAME` served the FIRST-registered package's
 *    agent, the one by-name read of an agent the open framework serves (the
 *    agent runtime that resolves an agent by name is the cloud's);
 *  - `skill` — an MCP client's `prompts/get` of a skill kept the
 *    FIRST-registered package's skill (`listSkillPrompts` kept the first
 *    row per name and dropped the other), and `/meta/skill/NAME` served the
 *    same one (both since narrowed to the namespace: "The narrowing");
 *  - `tool` — `/meta/tool/NAME` serves the FIRST-registered package's tool,
 *    and every reference to a tool carries its bare name alone: a skill's
 *    `tools` list admits only a snake_case name, an AI tool definition and a
 *    tool call carry a name and no package, and an MCP server registers one
 *    tool per name.
 *
 * Every one of them flips with registration order, and none says so (the
 * object-less action's handler bind warns that it replaces one, and names
 * neither package; the flow precedence warns, naming both, and arms one of
 * them all the same).
 *
 * ⛔ An action bound to an object (`objectName`, or a collector's `object`) is
 * NOT covered: it is keyed `objectName:name` from declaration to handler, so
 * two packages' same-named actions on their own objects never meet. Nor is a
 * hook naming a function: the hook binder resolves it among its own package's
 * functions only.
 *
 * ## The holders
 *
 *  - **a package** — a name another installed package declares: its claim,
 *    recorded at install, or an item registered under its own id (the
 *    registry's composite `PACKAGE:NAME` slot). A function is held by the
 *    package whose handlers the hook binder bound it for
 *    ({@link handlerOwnerPackageId}): the function registry is the engine's,
 *    not the registry's, so its one door is that bind;
 *  - **a built-in** — {@link BUILT_IN_BARE_NAMES}: a name the platform itself
 *    requests by a fixed spelling (the object-less action `install_package`,
 *    #31697), refused the way the security catalog refuses one.
 *
 * ⛔ **Never the environment catalog.** An item authored in this environment
 * under a package's name is the ADR-0005 overlay — the sanctioned
 * customization of that package's item — not a second holder. The registry's
 * bare slot (every `sys_metadata` hydration and write-through) is never read
 * here, and a registration with no package is never judged.
 *
 * ⛔ **Never an overridable baseline** ({@link OVERRIDABLE_BASELINE_PACKAGES}).
 * The platform's built-in email templates are code-declared under the email
 * service's own package, and the template loader serves any other package's
 * item of the same `(name, locale)` over them by contract (ADR-0131 D6/D10:
 * an app declaring `auth.password_reset` overrides the platform's copy). That
 * package neither holds a template name nor is refused one: the first OTHER
 * package to take the name holds it, and a second is refused naming the
 * first. No other type has a baseline today.
 *
 * ## The cold boot
 *
 * Every package registers again at every boot, through the same two doors. A
 * deployment that already holds a clash — two installed packages that both
 * ship `industry` — would stop booting if the doors refused then. So during a
 * boot the doors judge nothing; once every package has registered (the
 * kernel's `kernel:bootstrapped`, after the `kernel:ready` rehydrates), the
 * engine plugin seals the registry ({@link SchemaRegistry.sealBareNameHolders})
 * and reads every name two packages hold. What it does with them is
 * {@link BARE_NAME_COLD_BOOT_MODE}: `'warn'` names both holders and the rename
 * once per name and boots, changing nothing about which holder each caller is
 * served; `'refuse'` refuses the boot with the doors' envelope. After the seal
 * both doors, and the hook binder's function bind, refuse a NEW holder at
 * once.
 *
 * A package that already holds a name is never a new holder of it: a reload, a
 * re-install or an upgrade of a package that came through the boot beside
 * another holder keeps its name, while a third package is refused naming both.
 *
 * ## The narrowing (ADR-0150 D2, D9)
 *
 * Once a type's by-name readers resolve a name by `(package, name)` (refusing
 * a bare name two packages hold, naming both), its AI face is derived from
 * the namespace, and its stored references carry the package, the rule for
 * that type narrows from one package holder per deployment to one per
 * namespace: the type joins {@link NAMESPACE_SCOPED_BARE_NAME_TYPES}, and
 * {@link bareNameHoldersMeet} is the one predicate the doors, the item seam
 * and the cold boot ask before two package holders count as a conflict. Two
 * packages that declare two different namespaces may then each hold the name;
 * two packages of one namespace still may not, with the same refusal as
 * before, nor a package with no namespace beside any other holder, nor a
 * built-in name (D9: the refusal narrows, it does not go). `agent` and `skill`
 * narrowed first (#31701): `/meta/agent|skill/NAME` read through
 * `readPackageScopedItem`, and the MCP prompt and agent faces are `NS-NAME`.
 * The object-less `action` followed (#31697): a call that names no package —
 * the engine's `executeAction`, the bare `/actions` door and MCP's bare
 * `run_action` — is refused `409 RESOURCE_CONFLICT` naming every holder of the
 * name, and the namespace-qualified address (`/actions/NS/global/NAME`,
 * `run_action` with `namespace`) reaches each. The same 409 answers two
 * packages' same-named action bound to ONE object (epic ruling record
 * 6729825528, letter A), which this rule never covered.
 *
 * The picklist family followed (#31700): `picklist`, `mapping`, `dataset`,
 * `api` and the engine's `function`. Each by-name reader resolves by
 * `(package, name)`: a field's `picklist:` from the package that wrote the
 * reference (E6) and the bare `/meta/picklist/NAME` (#32070); an import's
 * `mappingName` and a connector pull (#32071); the dataset query door, the
 * dataset AI tools and a chart's `?callerPackage=` (#32072, #32310); the
 * `api` store and its qualified read (#32069), whose endpoint matcher keys
 * routes by METHOD + path, a path the publish gate puts under the declaring
 * namespace (`/api/v1/apps/NS/…`, ADR-0121 D1), so two namespaces' same-named
 * APIs never claim one route; a flow `script` node's function, from the
 * calling flow's package (#32073). A bare read of a name two packages hold
 * answers `409 RESOURCE_CONFLICT` naming both, and the metadata service's
 * in-memory store keeps a slot per `(package, name)` for the three metadata
 * types besides `api` (`PACKAGE_SLOTTED_STORE_TYPES`). An owner-less function
 * a plugin or the host registers is the platform's holder: never judged at
 * the bind, and refused beside a package holder at the read (ADR-0150 D2,
 * epic seat ruling 6729484996).
 *
 * ## What it deliberately does not judge
 *
 *  - ⛔ The environment catalog (above).
 *  - ⛔ A downgrade. `OS_METADATA_COLLISION=warn` softens the ADR-0048 Phase 1
 *    namespace gate only.
 *  - A package's own name again — one holder, not two.
 *  - For a narrowed type ({@link NAMESPACE_SCOPED_BARE_NAME_TYPES}), a
 *    package holding a name another package holds in a DIFFERENT namespace
 *    ("The narrowing").
 *  - `picklistExtensions` — an extension adds values to another package's list
 *    by design; its own refusal (a repeated value) is the picklist module's.
 *    Its target resolves caller-less (epic ruling X on #31678), so once two
 *    namespaces hold the name, an extension of it adds to neither list and
 *    is refused naming both (the registry's picklist audit), never a pick.
 *  - An action bound to an object, and a hook's `handler` (above).
 *  - A direct `ObjectQL.registerFunction` call: the imperative registration a
 *    host's own code makes, outside any package's bind.
 *  - The email service's built-in templates (above): the overridable baseline.
 *  - A paired `.custom` package's declared override of a base package's flow
 *    (ADR-0146 D9): a stored row bound to its pair, hydrated into the bare
 *    slot — the environment catalog, never a package holder.
 *  - A provider-bound connector instance two packages of ONE boot declare:
 *    the automation service's own duplicate refusal (ADR-0097) stops that boot
 *    before the seal; the doors here judge the install that follows a boot.
 *  - Every type not in {@link BARE_NAME_ONE_HOLDER_TYPES}: §3.4's coexistence
 *    stands for them (package-scoped resolution, a key that carries the object,
 *    the job key `appId:jobName`).
 */

import type { ObjectStackManifest } from '@objectstack/spec/kernel';
import { namespacedHoldersMeet } from '@objectstack/spec/kernel';
import {
  artifactPackageId,
  BARE_NAME_ONE_HOLDER_TYPES,
  OVERRIDABLE_BASELINE_PACKAGES,
  isBareNameOneHolderType,
  isOverridableBaseline,
  describeBareNameHolder,
  NAMESPACE_SCOPED_BARE_NAME_TYPES,
  isNamespaceScopedBareNameType,
  type BareNameHolder,
  type BareNameOneHolderType,
  type BareNameRegistryType,
} from '@objectstack/core';
import { isObjectLessActionKey, standaloneActionOwnerKey } from './action-governance.js';

// [epic #31527 child R2] The holder vocabulary — the covered types, the
// overridable baselines and the holder spelling — lives in `@objectstack/core`
// (`package-scoped-resolution.ts`) beside the package-scoped resolution rule
// that is written in it, so every reader of either reads one copy. Re-exported
// here under the same names; the rule it serves is this module's. [#32076] The
// narrowed types (`NAMESPACE_SCOPED_BARE_NAME_TYPES`) joined them, so the
// metadata protocol, which objectql depends on, reads the same list.
export type { BareNameRegistryType, BareNameOneHolderType, BareNameHolder } from '@objectstack/core';
export {
  BARE_NAME_ONE_HOLDER_TYPES,
  OVERRIDABLE_BASELINE_PACKAGES,
  isBareNameOneHolderType,
  isOverridableBaseline,
  describeBareNameHolder,
  NAMESPACE_SCOPED_BARE_NAME_TYPES,
  isNamespaceScopedBareNameType,
};

/** The covered registry types, in the order a refusal lists them. */
export const BARE_NAME_REGISTRY_TYPES: readonly BareNameRegistryType[] = Object.freeze(
  BARE_NAME_ONE_HOLDER_TYPES.filter((type): type is BareNameRegistryType => type !== 'function'),
);

/** Is `type` a covered type the registry stores (as the registry keys it)? */
export function isBareNameRegistryType(type: unknown): type is BareNameRegistryType {
  return typeof type === 'string' && (BARE_NAME_REGISTRY_TYPES as readonly string[]).includes(type);
}

/**
 * Does `item` of the covered registry `type` hold its name under the rule?
 * Every item does, except an action bound to an object: the rule covers the
 * object-less action only (module doc), read with the engine's own owner-key
 * ladder ({@link standaloneActionOwnerKey}).
 */
export function holdsBareName(type: BareNameRegistryType, item: unknown): boolean {
  if (type !== 'action') return true;
  return isObjectLessActionKey(standaloneActionOwnerKey(item));
}

/**
 * The stack collection each registry type is declared under — the keys the
 * engine's collection loop reads (`registerMetadataCollections`).
 */
const COLLECTION_KEY: Readonly<Record<BareNameRegistryType, string>> = Object.freeze({
  picklist: 'picklists',
  mapping: 'mappings',
  dataset: 'datasets',
  api: 'apis',
  action: 'actions',
  flow: 'flows',
  webhook: 'webhooks',
  connector: 'connectors',
  email_template: 'emailTemplates',
  agent: 'agents',
  skill: 'skills',
  tool: 'tools',
});

/**
 * The names the platform itself holds, whichever package registers first.
 * Applied at the package door only, as the security catalog applies its own.
 *
 * - `action`: `install_package` (#31697; epic ruling record 6762267053,
 *   item 2 (b)). The Console's marketplace and the cloud connection call
 *   `POST /actions/sys_package/install_package` by that fixed name, naming no
 *   package, and an object-less action reaches every object's route when the
 *   object binds none of that name. So no package may hold the object-less
 *   name, and a package's never makes the platform's install button answer
 *   `409`. The census found no other fixed-name action request in the
 *   platform's own code (`packages/**` and `ui/**` sources).
 * - every other covered type: none — the platform ships no item of it under
 *   a name a package could take.
 */
export const BUILT_IN_BARE_NAMES: Readonly<Record<BareNameOneHolderType, ReadonlySet<string>>> = Object.freeze({
  picklist: new Set<string>(),
  mapping: new Set<string>(),
  dataset: new Set<string>(),
  api: new Set<string>(),
  action: new Set<string>(['install_package']),
  function: new Set<string>(),
  flow: new Set<string>(),
  webhook: new Set<string>(),
  connector: new Set<string>(),
  email_template: new Set<string>(),
  agent: new Set<string>(),
  skill: new Set<string>(),
  tool: new Set<string>(),
});

/**
 * [#31697; contract review G6, epic answer on #32213] The OBJECT-BOUND action
 * keys (`OBJECT:NAME`) the platform itself holds. The Console's marketplace
 * and the cloud connection post `POST /actions/sys_package/install_package`
 * by that fixed name, and that route reaches an action bound to `sys_package`
 * first, so {@link BUILT_IN_BARE_NAMES}' object-less entry alone does not
 * guard it. A package declaring an action bound to one of these keys is
 * refused at install, naming the platform — a declared narrowing (first-party
 * count 0). The census: no other fixed-name action request in the platform's
 * own code (`packages/**` and `ui/**` sources), and no source in this
 * repository declares the action (the call reaches the cloud control plane).
 */
export const BUILT_IN_BOUND_ACTION_KEYS: ReadonlySet<string> = new Set(['sys_package:install_package']);

/** One object-bound action a manifest declares under a key the platform holds ({@link BUILT_IN_BOUND_ACTION_KEYS}). */
export interface DeclaredBuiltInBoundAction {
  readonly name: string;
  readonly objectName: string;
}

/**
 * The object-bound actions `manifest` (and each plugin it carries) declares
 * under a key the platform holds ({@link BUILT_IN_BOUND_ACTION_KEYS}). An
 * overridable baseline package is not judged, as {@link declaredBareNames}.
 */
export function declaredBuiltInBoundActions(manifest: ObjectStackManifest | unknown): DeclaredBuiltInBoundAction[] {
  const out: DeclaredBuiltInBoundAction[] = [];
  if (isOverridableBaseline('action', artifactPackageId(manifest))) return out;
  const read = (source: unknown) => {
    const items = source && typeof source === 'object' ? (source as Record<string, unknown>)[COLLECTION_KEY.action] : undefined;
    if (!Array.isArray(items)) return;
    for (const item of items) {
      const name = itemName(item);
      if (name === undefined || holdsBareName('action', item)) continue;
      const objectName = standaloneActionOwnerKey(item);
      if (BUILT_IN_BOUND_ACTION_KEYS.has(`${objectName}:${name}`)) out.push({ name, objectName });
    }
  };
  read(manifest);
  const plugins = (manifest as { plugins?: unknown } | null | undefined)?.plugins;
  if (Array.isArray(plugins)) for (const plugin of plugins) read(plugin);
  return out;
}

/**
 * Do two PACKAGE holders of `(type, name)` meet under the rule — may one be
 * refused because the other holds the name? Always, for a type that has not
 * narrowed. For a narrowed type, unless both packages declare a namespace and
 * the two differ: two namespaces give the two items two addresses
 * (`NS/NAME`) and two AI faces (`NS-NAME`), and every by-name reader resolves
 * a bare name by `(package, name)` or refuses it naming both. A package with
 * no namespace has no address of its own, so it still meets every holder.
 * The namespace comparison is `namespacedHoldersMeet` (`@objectstack/spec`),
 * the copy `composeStacks` reads for the same pair in one artifact.
 */
export function bareNameHoldersMeet(
  type: BareNameOneHolderType,
  incomingNamespace: string | undefined,
  holderNamespace: string | undefined,
): boolean {
  if (!isNamespaceScopedBareNameType(type)) return true;
  // The namespace half is spec's one copy, which `composeStacks` reads too.
  return namespacedHoldersMeet(incomingNamespace, holderNamespace);
}

/**
 * The prefix the runtime binds a package's handlers under
 * (`appArtifactHandlerOwner` in `@objectstack/runtime`: `app:<packageId>`).
 */
const HANDLER_OWNER_PREFIX = 'app:';

/**
 * The package a handler owner names: the runtime binds a package's hooks,
 * functions and action bodies under `app:<packageId>`, and the rule names the
 * package. Any other owner is its own name.
 */
export function handlerOwnerPackageId(owner: string): string {
  return owner.startsWith(HANDLER_OWNER_PREFIX) && owner.length > HANDLER_OWNER_PREFIX.length
    ? owner.slice(HANDLER_OWNER_PREFIX.length)
    : owner;
}

/**
 * What a cold boot does with a name two installed packages already hold
 * (module doc, "The cold boot"): `'warn'` — name both holders and the rename,
 * once per name, and boot; `'refuse'` — refuse the boot with the doors'
 * envelope, as the security catalog's cold boot does.
 */
export type BareNameColdBootMode = 'warn' | 'refuse';

/**
 * The switch. `'warn'` until the maintainer rules on the cold boot of a
 * deployment that already holds a clash (#30803); the doors refuse a NEW
 * holder after the boot in either mode.
 */
export const BARE_NAME_COLD_BOOT_MODE: BareNameColdBootMode = 'warn';

/** One `(type, name)` a package declares. */
export interface DeclaredBareName {
  readonly type: BareNameRegistryType;
  readonly name: string;
}

/**
 * The name an item is registered under — the engine seam's own derivation for
 * a non-view collection (`resolveMetadataItemName`: `name`, else `id`). An
 * item with neither is skipped there, so it claims nothing here.
 */
function itemName(item: unknown): string | undefined {
  if (!item || typeof item !== 'object') return undefined;
  const { name, id } = item as { name?: unknown; id?: unknown };
  if (typeof name === 'string' && name !== '') return name;
  if (typeof id === 'string' && id !== '') return id;
  return undefined;
}

/**
 * Every covered `(type, name)` a manifest declares, read from the SAME sources
 * the engine's registration seams read: the manifest's own collections and
 * each nested `plugins[]` entry's (a nested plugin contributes under its
 * parent package — `ObjectQL.registerPlugin`), one level deep, arrays only.
 * An action bound to an object declares nothing here ({@link holdsBareName});
 * a function is never declared by a manifest — it is code, and its door is
 * the hook binder's bind. A package that is a type's overridable baseline
 * ({@link isOverridableBaseline}, by its package id as the door reads it) declares nothing
 * of that type. A bundled type (`email_template`) declares its NAME: two
 * members of one bundle are one declaration, read twice.
 */
export function declaredBareNames(manifest: ObjectStackManifest | unknown): DeclaredBareName[] {
  const out: DeclaredBareName[] = [];
  const packageId = artifactPackageId(manifest);
  const read = (source: unknown) => {
    if (!source || typeof source !== 'object') return;
    for (const type of BARE_NAME_REGISTRY_TYPES) {
      if (isOverridableBaseline(type, packageId)) continue;
      const items = (source as Record<string, unknown>)[COLLECTION_KEY[type]];
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const name = itemName(item);
        if (name !== undefined && holdsBareName(type, item)) out.push({ type, name });
      }
    }
  };
  read(manifest);
  const plugins = (manifest as { plugins?: unknown } | null | undefined)?.plugins;
  if (Array.isArray(plugins)) for (const plugin of plugins) read(plugin);
  return out;
}

/** How a refusal names a covered type. */
export function bareNameTypeLabel(type: BareNameOneHolderType): string {
  switch (type) {
    case 'api': return 'API';
    case 'action': return 'object-less action';
    case 'email_template': return 'email template';
    default: return type;
  }
}

/**
 * How each covered type's consumer names it with no package — the clause a
 * refusal's reason carries for the types it lists.
 */
const CONSUMER_CLAUSE: Readonly<Record<BareNameOneHolderType, string>> = Object.freeze({
  picklist: 'a field names its picklist',
  mapping: 'an import its mapping',
  dataset: 'a dashboard its dataset',
  api: 'the endpoint matcher keeps one API per name',
  action: '`/actions/global/NAME` runs an object-less action by its name',
  function: 'a flow `script` node and an action `target` name a function',
  flow: 'the automation engine arms one flow per name',
  webhook: 'the webhook dispatcher subscribes one declared webhook per name',
  connector: 'a flow `connector_action` node and the connector picker name a connector',
  email_template: 'a send names its email template',
  agent: '`/meta/agent/NAME` serves one agent per name',
  skill: 'an MCP client fetches a skill\'s prompt by its name',
  tool: 'a skill\'s `tools` and an MCP client name a tool',
});

/** The noun a reason names a covered type by. */
const TYPE_NOUN: Readonly<Record<BareNameOneHolderType, string>> = Object.freeze({
  picklist: 'a picklist',
  mapping: 'a mapping',
  dataset: 'a dataset',
  api: 'an API',
  action: 'an object-less action',
  function: 'a function',
  flow: 'a flow',
  webhook: 'a webhook',
  connector: 'a connector',
  email_template: 'an email template',
  agent: 'an agent',
  skill: 'a skill',
  tool: 'a tool',
});

const joinList = (parts: readonly string[]): string =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/**
 * Why a second holder is refused, in one sentence a reader can act on — for
 * the covered types `types` lists (every covered type when none), in the
 * order {@link BARE_NAME_ONE_HOLDER_TYPES} lists them. Shared by the doors'
 * refusal and the cold boot's warning.
 */
export function bareNameReason(types: readonly BareNameOneHolderType[] = BARE_NAME_ONE_HOLDER_TYPES): string {
  const present = BARE_NAME_ONE_HOLDER_TYPES.filter((t) => types.includes(t));
  const listed = present.length > 0 ? present : BARE_NAME_ONE_HOLDER_TYPES;
  const nouns = joinList(listed.map((t) => TYPE_NOUN[t]));
  return (
    `${nouns.charAt(0).toUpperCase()}${nouns.slice(1)} ${listed.length === 1 ? 'holds' : 'each hold'} one name per ` +
    `deployment: ${joinList(listed.map((t) => CONSUMER_CLAUSE[t]))}, with no package to tell two definitions ` +
    'apart, so with two holders every caller is served the same one, chosen by registration order.'
  );
}

/** A stable identity for de-duplicating holders. */
export function bareNameHolderKey(holder: BareNameHolder): string {
  return holder.kind === 'package' ? `package:${holder.packageId}` : holder.kind;
}

/**
 * The rename a refusal carries: the package's namespace prefixed to the name
 * (`crm_industry`), the one naming rule ruling C ends at — or `undefined` when
 * the package declares no namespace, or the name already carries it.
 */
export function suggestedBareNameRename(namespace: string | undefined, name: string): string | undefined {
  if (!namespace) return undefined;
  const prefix = `${namespace}_`;
  return name.startsWith(prefix) ? undefined : `${prefix}${name}`;
}
