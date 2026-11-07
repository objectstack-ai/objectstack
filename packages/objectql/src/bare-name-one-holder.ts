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
 * object-less `action`, the engine's function registry).
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
 *  - `picklist` — a field's `picklist: NAME` resolves the FIRST-registered
 *    package's list for every object, so the second package's object is served
 *    the other package's options and refuses its own values;
 *  - `mapping` — an import's `mappingName` resolves the first-registered
 *    package's mapping, and the other package's import answers
 *    `MAPPING_TARGET_MISMATCH`;
 *  - `dataset` — a dashboard's `datasetName` query runs the first-registered
 *    package's dataset;
 *  - `api` — the endpoint matcher keeps ONE api per name, the last-registered,
 *    so the other package's declared path answers `404`;
 *  - `action`, object-less only — `/actions/global/NAME` runs the
 *    last-registered package's handler while `/meta/action/NAME` serves the
 *    first-registered package's declaration, so the button a client draws and
 *    the code that runs come from two packages;
 *  - `function` — the engine's function registry keeps one function per name,
 *    the last-registered, and a flow `script` node's `function` and an
 *    action's `target` resolve it with no package.
 *
 * Every one of them flips with registration order, and none says so (the
 * object-less action's handler bind warns that it replaces one, and names
 * neither package).
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
 *  - **a built-in** — {@link BUILT_IN_BARE_NAMES}; none today for the covered
 *    types, kept in the vocabulary so a platform-held name is refused the way
 *    the security catalog refuses one.
 *
 * ⛔ **Never the environment catalog.** An item authored in this environment
 * under a package's name is the ADR-0005 overlay — the sanctioned
 * customization of that package's item — not a second holder. The registry's
 * bare slot (every `sys_metadata` hydration and write-through) is never read
 * here, and a registration with no package is never judged.
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
 * ## What it deliberately does not judge
 *
 *  - ⛔ The environment catalog (above).
 *  - ⛔ A downgrade. `OS_METADATA_COLLISION=warn` softens the ADR-0048 Phase 1
 *    namespace gate only.
 *  - A package's own name again — one holder, not two.
 *  - `picklistExtensions` — an extension adds values to another package's list
 *    by design; its own refusal (a repeated value) is the picklist module's.
 *  - An action bound to an object, and a hook's `handler` (above).
 *  - A direct `ObjectQL.registerFunction` call: the imperative registration a
 *    host's own code makes, outside any package's bind.
 *  - Every type not in {@link BARE_NAME_ONE_HOLDER_TYPES}: §3.4's coexistence
 *    stands for them (package-scoped resolution, a key that carries the object,
 *    the job key `appId:jobName`).
 */

import type { ObjectStackManifest } from '@objectstack/spec/kernel';
import { isObjectLessActionKey, standaloneActionOwnerKey } from './action-governance.js';

/**
 * A covered type the registry stores — its items reach the engine's package
 * door and the registry's item seam, keyed as the registry keys them.
 */
export type BareNameRegistryType = 'picklist' | 'mapping' | 'dataset' | 'api' | 'action';

/**
 * A covered type: a registry type, or `function` — the engine's function
 * registry, which a package reaches through the hook binder's bind alone.
 */
export type BareNameOneHolderType = BareNameRegistryType | 'function';

/** The covered registry types, in the order a refusal lists them. */
export const BARE_NAME_REGISTRY_TYPES: readonly BareNameRegistryType[] = Object.freeze([
  'picklist',
  'mapping',
  'dataset',
  'api',
  'action',
]);

/** Every covered type, in the order a refusal and a cold boot list them. */
export const BARE_NAME_ONE_HOLDER_TYPES: readonly BareNameOneHolderType[] = Object.freeze([
  ...BARE_NAME_REGISTRY_TYPES,
  'function',
]);

/** Is `type` one of the covered types? */
export function isBareNameOneHolderType(type: unknown): type is BareNameOneHolderType {
  return typeof type === 'string' && (BARE_NAME_ONE_HOLDER_TYPES as readonly string[]).includes(type);
}

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
});

/**
 * The names the platform itself holds, whichever package registers first.
 * None today: the platform ships no item of a covered type under a name a
 * package could take. Applied at the package door only, as the security
 * catalog applies its own.
 */
export const BUILT_IN_BARE_NAMES: Readonly<Record<BareNameOneHolderType, ReadonlySet<string>>> = Object.freeze({
  picklist: new Set<string>(),
  mapping: new Set<string>(),
  dataset: new Set<string>(),
  api: new Set<string>(),
  action: new Set<string>(),
  function: new Set<string>(),
});

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

/** Who holds a covered name (module doc, "The holders"). */
export type BareNameHolder =
  | { readonly kind: 'package'; readonly packageId: string }
  | { readonly kind: 'built-in' };

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
 * the hook binder's bind.
 */
export function declaredBareNames(manifest: ObjectStackManifest | unknown): DeclaredBareName[] {
  const out: DeclaredBareName[] = [];
  const read = (source: unknown) => {
    if (!source || typeof source !== 'object') return;
    for (const type of BARE_NAME_REGISTRY_TYPES) {
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
});

/** The noun a reason names a covered type by. */
const TYPE_NOUN: Readonly<Record<BareNameOneHolderType, string>> = Object.freeze({
  picklist: 'a picklist',
  mapping: 'a mapping',
  dataset: 'a dataset',
  api: 'an API',
  action: 'an object-less action',
  function: 'a function',
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

/** How a refusal names a holder. */
export function describeBareNameHolder(holder: BareNameHolder): string {
  return holder.kind === 'package'
    ? `package "${holder.packageId}"`
    : 'the platform, as a built-in name no package can declare';
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
