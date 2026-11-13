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
    const set = parsed.data as PermissionSet;
    const offending = describeHighPrivilegeBits(set);
    if (offending) refuse(contributor, `it carries ${offending}, which the everyone anchor forbids.`);

    // The registry's own one-holder rule answers a name another package holds.
    try {
      registry.registerItem('permission', { ...set }, 'name', contributor);
    } catch (e) {
      refuse(contributor, `the registry refused the set: ${(e as Error)?.message ?? e}`);
    }
    this.byContributor.set(contributor, set);

    // A deployment that declares no baseline hands out none.
    const joined = host.baseline.length > 0;
    if (joined && !host.baseline.includes(set.name)) {
      host.baseline.push(set.name);
      if (this.anchorDerived) this.joinedAfterDerivation = true;
    }
    return { contributor, set, joined };
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
