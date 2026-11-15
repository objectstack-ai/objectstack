// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The seam through which an always-on PLATFORM SERVICE contributes one
 * permission set of its own to the member baseline (ADR-0090 D5), beside the
 * row gates the service installs, and only where it installs them.
 *
 * ## Why a seam, and why not a line in `member_default`
 *
 * `member_default` is this plugin's own set, the baseline every member holds
 * through the `everyone` anchor. ADR-0090 D9 (and its Alternatives 6) rules
 * out the shape "a builtin permission set other packages write into", so an
 * object another package registers and gates is not granted from there. And a
 * static line in a shipped set would stay in force in a composition that
 * registers the object WITHOUT the gates that decide its rows — there the
 * object-level grant would be the last word on every row, the hazard the
 * ownership-floor seam (`ownership-floor-alternates.ts`) was made for. So the
 * service that registers the object and installs its gates hands over a set
 * of its OWN, from the place it installs them, and this plugin decides where
 * the set goes: into the deployment's composed baseline, which every reader of
 * the baseline reads — the data plane's resolution, the explainer, the
 * effective-access read, the describe fallback and the `everyone` anchor's
 * definition.
 *
 * ## What a contribution is held to (each refusal is a thrown error)
 *
 *  - **Boot only.** The window closes at `kernel:bootstrapped`, once every
 *    plugin's `kernel:ready` handler, where a service installs its gates, has
 *    run. A contribution after that is refused: the baseline is not a runtime
 *    write surface.
 *  - **A named contributor, one set each.** The contributor is the package
 *    that registers the objects. Its second contribution of the same name
 *    replaces the first; a second name is refused.
 *  - **Closed keys.** `name`, `label`, `description` and `objects`, nothing
 *    else: no row policy (`rowLevelSecurity`), no field rule, no system
 *    permission, no tab rule, no `isDefault`, no package key.
 *  - **The contributor's own objects only.** Every object the set names is one
 *    the engine registry holds with the contributor as its owner. ⛔ Never
 *    `'*'`, never another package's object, never a name nobody registered.
 *  - **Read and create only.** Each object entry carries `allowRead` and
 *    `allowCreate` and no other key — no edit, delete, transfer, restore,
 *    export, View All, Modify All or scope bit, not even set to `false` — and
 *    grants at least one of the two. The parsed set must also be anchor-safe
 *    by the anchor's own predicate (`describeHighPrivilegeBits`).
 *  - **A fresh name.** A name a shipped set or another holder already uses is
 *    refused (the registry's own one-holder rule answers the second).
 *
 * ## What an admitted contribution does
 *
 * The set is registered in the engine registry under the contributor's
 * package — the catalog every set body is read from — and, when the deployment
 * declares a member baseline at all, its name joins the composed baseline. A
 * deployment that declares none (`fallbackPermissionSet: null`) hands out no
 * baseline, so the set is registered and reaches no member through it. An
 * external member resolves its own baseline in place of this one, and an agent
 * principal's own leg resolves no human baseline (`external-baseline.ts`,
 * ADR-0090 D10), so neither gains anything here in its own right. An agent
 * acting for a member is bounded by that member and by its own scope, so it
 * reaches what the member reaches, within that scope. Every admitted
 * contribution, and every refusal, is logged by the seam that calls
 * {@link PlatformBaselineSets.contribute}.
 *
 * ## What a host may change (`platformBaselineOverrides`)
 *
 * A host that composes a platform service may still not want every member to
 * hold what that service contributes (#33132: a cross-tenant control plane
 * that must not let an organization administrator create `sys_attachment`
 * rows). It declares that on `SecurityPlugin`
 * (`SecurityPluginOptions.platformBaselineOverrides`), by contributed set name
 * and object, and the declaration is applied HERE, where the contribution is
 * admitted, so every reader of the set reads the narrowed body:
 *
 *  - `'read'` keeps the object's read and withholds its create;
 *  - `'decline'` withholds the object's grant entirely.
 *
 * An override only ever narrows: the contribution is first held to every rule
 * above as the contributor wrote it, and the host can then take bits away,
 * never add one. A set left granting nothing is not registered, so it holds
 * no name in the engine registry, and it joins no baseline (`joined: false`, as for a deployment with no baseline). An
 * override that matched no admitted contribution by the time the boot window
 * closes is reported at `warn` ({@link PlatformBaselineSets.unmatchedOverrides}),
 * so a renamed set or object is said rather than silently left in force.
 *
 * This seam is for always-on platform services. A tenant-installed package
 * suggests a default set and a `manage_metadata` holder accepts it
 * (`suggested-audience-bindings.ts`, ADR-0090 D5); it does not contribute here.
 */

import { describeHighPrivilegeBits, PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';

/** The top-level keys a contributed set may carry. */
const SET_KEYS: ReadonlySet<string> = new Set(['name', 'label', 'description', 'objects']);

/** The object-permission bits a contributed set may carry. */
const OBJECT_BITS: ReadonlySet<string> = new Set(['allowRead', 'allowCreate']);

/**
 * What a host does to one object of a contributed set: keep it at read
 * (`'read'`), or withhold it (`'decline'`). See the module doc.
 */
export type PlatformBaselineOverride = 'read' | 'decline';

/** The host's overrides: contributed set name → object → {@link PlatformBaselineOverride}. */
export type PlatformBaselineOverrides = Readonly<Record<string, Readonly<Record<string, PlatformBaselineOverride>>>>;

const OVERRIDES: ReadonlySet<string> = new Set<PlatformBaselineOverride>(['read', 'decline']);

function refuseOption(detail: string): never {
  throw new Error(`[security] SecurityPlugin option platformBaselineOverrides refused: ${detail}`);
}

/**
 * Read `SecurityPluginOptions.platformBaselineOverrides`, frozen, or throw the
 * refusal naming the malformed entry. `undefined` reads as no override.
 */
export function readPlatformBaselineOverridesOption(raw: unknown): PlatformBaselineOverrides {
  if (raw === undefined) return Object.freeze({});
  if (!isPlainRecord(raw)) refuseOption('it is not an object keyed by contributed permission set name.');
  const out: Record<string, Readonly<Record<string, PlatformBaselineOverride>>> = {};
  for (const [setName, objects] of Object.entries(raw)) {
    if (setName.length === 0) refuseOption('a set name is empty.');
    if (!isPlainRecord(objects) || Object.keys(objects).length === 0) {
      refuseOption(`the entry for '${setName}' names no object.`);
    }
    const perObject: Record<string, PlatformBaselineOverride> = {};
    for (const [object, verdict] of Object.entries(objects)) {
      if (object.length === 0 || object === '*') {
        refuseOption(`the entry for '${setName}' names object '${object}'; an override names one object of the set.`);
      }
      if (typeof verdict !== 'string' || !OVERRIDES.has(verdict)) {
        refuseOption(`'${setName}.${object}' is ${JSON.stringify(verdict)}; it is 'read' (keep read, withhold create) or 'decline' (withhold the object).`);
      }
      perObject[object] = verdict as PlatformBaselineOverride;
    }
    out[setName] = Object.freeze(perObject);
  }
  return Object.freeze(out);
}

/** The registry members the seam uses: the object's owner, and the set's registration. */
export interface PlatformBaselineRegistry {
  getObjectOwner(name: string): { packageId?: string } | undefined;
  registerItem(type: string, item: Record<string, unknown>, keyField: string, packageId?: string): void;
}

/** What the plugin hands the seam on each contribution. */
export interface PlatformBaselineHost {
  /**
   * The composed baseline, joined IN PLACE: every reader of the baseline holds
   * this array (`SecurityPlugin.baselinePermissionSets`), so a name pushed here
   * is the one every reader sees.
   */
  readonly baseline: string[];
  /** The shipped sets, whose names a contribution may not take. */
  readonly shipped: readonly PermissionSet[];
  /** The engine registry, read at the call; `undefined` when the engine exposes none. */
  readonly registry: PlatformBaselineRegistry | undefined;
}

/** The outcome of an admitted contribution. */
export interface PlatformBaselineContribution {
  readonly contributor: string;
  readonly set: PermissionSet;
  /** Whether the name joined the composed baseline. */
  readonly joined: boolean;
  /**
   * What the host's overrides changed, one line per object (`'sys_attachment: kept at read'`);
   * empty when none applied.
   */
  readonly overridden: readonly string[];
}

function refuse(contributor: string, detail: string): never {
  throw new Error(`[security] platform baseline set from '${contributor}' refused: ${detail}`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The contributions in force, keyed by contributor, and the boot window they
 * are admitted in. One instance per `SecurityPlugin`.
 */
export class PlatformBaselineSets {
  private open = true;
  private anchorDerived = false;
  private joinedAfterDerivation = false;
  private readonly byContributor = new Map<string, PermissionSet>();
  /** `set.object` keys of the host's overrides that an admitted contribution matched. */
  private readonly matched = new Set<string>();

  /** @param overrides the host's declaration, as {@link readPlatformBaselineOverridesOption} reads it. */
  constructor(private readonly overrides: PlatformBaselineOverrides = Object.freeze({})) {}

  /**
   * Admit one contribution, or throw the refusal. See the module doc for the
   * rules; each refusal names what was refused and why.
   */
  contribute(contributor: unknown, raw: unknown, host: PlatformBaselineHost): PlatformBaselineContribution {
    if (typeof contributor !== 'string' || contributor.length === 0) {
      throw new Error('[security] platform baseline set refused: the contributing package is not named.');
    }
    if (!this.open) {
      refuse(
        contributor,
        'the boot window is closed. A platform service contributes its baseline set during boot, from the ' +
          'kernel:ready handler that installs the gates the set relies on, and never after the kernel has bootstrapped.',
      );
    }
    if (!isPlainRecord(raw)) refuse(contributor, 'the contribution is not a permission-set object.');

    for (const key of Object.keys(raw)) {
      if (SET_KEYS.has(key)) continue;
      if (key === 'rowLevelSecurity') {
        refuse(
          contributor,
          'it carries a row policy (rowLevelSecurity). The rows of a contributed object are decided by the gates its ' +
            'service installs; a baseline set grants the object, never a row rule.',
        );
      }
      refuse(contributor, `key '${key}' is not one a platform baseline set carries; it carries name, label, description and objects only.`);
    }

    const name = raw.name;
    if (typeof name !== 'string' || name.length === 0) refuse(contributor, 'it names no set.');
    const held = this.byContributor.get(contributor);
    if (held && held.name !== name) {
      refuse(contributor, `it already contributed the set '${held.name}'; a platform service contributes one set.`);
    }
    for (const [other, set] of this.byContributor) {
      if (other !== contributor && set.name === name) refuse(contributor, `the name '${name}' is the set '${other}' contributed.`);
    }
    if (host.shipped.some((set) => set.name === name)) {
      refuse(contributor, `the name '${name}' is a set this plugin ships.`);
    }

    const registry = host.registry;
    if (!registry || typeof registry.getObjectOwner !== 'function' || typeof registry.registerItem !== 'function') {
      refuse(contributor, 'the engine exposes no registry that can tell who registers an object and hold the set.');
    }

    const objects = raw.objects;
    if (!isPlainRecord(objects) || Object.keys(objects).length === 0) refuse(contributor, 'it names no object.');
    for (const [object, entry] of Object.entries(objects)) {
      if (object === '*') {
        refuse(contributor, "object '*' is every object; a platform baseline set names the objects its own service registers.");
      }
      const owner = registry.getObjectOwner(object)?.packageId;
      if (owner !== contributor) {
        refuse(
          contributor,
          owner === undefined
            ? `object '${object}' is registered by no package; a platform baseline set names objects its contributor registers.`
            : `object '${object}' is registered by '${owner}', not by '${contributor}'.`,
        );
      }
      if (!isPlainRecord(entry)) refuse(contributor, `the entry for '${object}' is not an object permission.`);
      for (const [bit, value] of Object.entries(entry)) {
        if (!OBJECT_BITS.has(bit)) {
          refuse(
            contributor,
            `'${object}' carries '${bit}'. A platform baseline set grants read and create only (allowRead, allowCreate); ` +
              'every other bit is an elevated grant this channel does not carry, set to false included.',
          );
        }
        if (typeof value !== 'boolean') refuse(contributor, `'${object}.${bit}' is not true or false.`);
      }
      if (entry.allowRead !== true && entry.allowCreate !== true) {
        refuse(contributor, `the entry for '${object}' grants nothing.`);
      }
    }

    const parsed = PermissionSetSchema.safeParse(raw);
    if (!parsed.success) {
      refuse(contributor, `it is not a well-formed permission set (${parsed.error.issues.map((i) => i.message).join('; ')}).`);
    }
    const offending = describeHighPrivilegeBits(parsed.data as PermissionSet);
    if (offending) refuse(contributor, `it carries ${offending}, which the everyone anchor forbids.`);

    // The host's overrides narrow the admitted set; they never add a bit.
    const { set, overridden, matched } = this.applyOverrides(parsed.data as PermissionSet);
    const grantsSomething = Object.keys(set.objects ?? {}).length > 0;

    // The registry's own one-holder rule answers a name another package holds.
    if (grantsSomething) {
      try {
        registry.registerItem('permission', { ...set }, 'name', contributor);
      } catch (e) {
        refuse(contributor, `the registry refused the set: ${(e as Error)?.message ?? e}`);
      }
    }
    this.byContributor.set(contributor, set);
    for (const key of matched) this.matched.add(key);

    // A deployment that declares no baseline hands out none, and a set the
    // host's overrides left granting nothing joins none.
    const joined = grantsSomething && host.baseline.length > 0;
    if (joined && !host.baseline.includes(set.name)) {
      host.baseline.push(set.name);
      if (this.anchorDerived) this.joinedAfterDerivation = true;
    }
    return { contributor, set, joined, overridden };
  }

  /** Apply the host's overrides for `set.name` to its objects; see the module doc. */
  private applyOverrides(set: PermissionSet): { set: PermissionSet; overridden: string[]; matched: string[] } {
    const forSet = this.overrides[set.name];
    if (!forSet) return { set, overridden: [], matched: [] };
    const overridden: string[] = [];
    const matched: string[] = [];
    const objects: Record<string, NonNullable<PermissionSet['objects']>[string]> = {};
    for (const [object, entry] of Object.entries(set.objects ?? {})) {
      const verdict = forSet[object];
      if (verdict === undefined) {
        objects[object] = entry;
        continue;
      }
      matched.push(`${set.name}.${object}`);
      if (verdict === 'read' && entry.allowRead === true) {
        objects[object] = { ...entry, allowCreate: false };
        overridden.push(`${object}: kept at read`);
      } else {
        overridden.push(verdict === 'read' ? `${object}: declined (the set grants it no read to keep)` : `${object}: declined`);
      }
    }
    return { set: { ...set, objects }, overridden, matched };
  }

  /**
   * The host's overrides no admitted contribution matched, as `set.object`.
   * Read when the boot window closes: each one is a declaration that withheld
   * nothing, a set or object name that is wrong or was renamed.
   */
  unmatchedOverrides(): string[] {
    const out: string[] = [];
    for (const [setName, objects] of Object.entries(this.overrides)) {
      for (const object of Object.keys(objects)) {
        if (!this.matched.has(`${setName}.${object}`)) out.push(`${setName}.${object}`);
      }
    }
    return out;
  }

  /** The body of the contributed set `name`, if one was admitted. */
  body(name: string): PermissionSet | undefined {
    for (const set of this.byContributor.values()) if (set.name === name) return set;
    return undefined;
  }

  /** Said by the plugin as it starts the `everyone` derivation at `kernel:ready`. */
  noteAnchorDerived(): void {
    this.anchorDerived = true;
  }

  /**
   * Close the boot window. Answers whether a set joined the baseline after the
   * `kernel:ready` derivation of the `everyone` anchor began, so the anchor's
   * definition must be derived again to name it.
   */
  close(): boolean {
    this.open = false;
    const owed = this.joinedAfterDerivation;
    this.joinedAfterDerivation = false;
    return owed;
  }
}
