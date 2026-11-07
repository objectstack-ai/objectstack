// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The objects a sharing rule can take effect on — the list behind Setup's
 * sharing-rule object picker (the read half of the row-5 ruling on #30209:
 * a read-only "objects under record sharing" list, and a picker that offers
 * only those).
 *
 * ## One verdict, never a second copy
 *
 * An object is listed exactly when the save doors would ACCEPT a rule on it:
 * `SharingService.sharingRuleObjectRefusal(object)` answers `null`. That is the
 * predicate both save doors already ask (the `sys_sharing_rule` hook guard on
 * the `/data` door, and `SharingRuleService.defineRule`), and it reads the
 * reconcile's own ADR-0111 D7 inert-grant verdict. So the picker, the save
 * doors and the reconcile cannot disagree about which objects a rule works on:
 * an object this list leaves out is one a save would refuse with
 * `SHARING_NOT_ENABLED`, and an object it lists is one a save admits. The
 * predicate is handed in, never re-derived here.
 *
 * ## Order
 *
 * Business objects first, then platform (system) objects; inside each group
 * by label, then by machine name. A platform object is the one test
 * `effectiveSharingModel` already asks (`isPlatformObjectSchema`): the registry
 * marks it `isSystem`, or its name carries the platform's `sys_` prefix.
 */

import { isPlatformObjectSchema } from './sharing-service.js';

/** One object a sharing rule can take effect on. */
export interface ShareableObject {
  /** The object's machine name — the value `sys_sharing_rule.object_name` stores. */
  name: string;
  /** The object's declared label, or its name when it declares none. */
  label: string;
  /** `true` for a platform object (`isSystem`, or a `sys_` name); business objects are `false`. */
  system: boolean;
}

/** The slice of the data engine this list reads: the registry's object configs. */
export interface ShareableObjectsEngine {
  getConfigs?(): Record<string, unknown> | undefined;
}

/**
 * Raised when the engine cannot enumerate its objects. An empty list would
 * read as "no object can take a sharing rule", which is a different and wrong
 * answer, so the caller is told the list could not be read.
 */
export class ShareableObjectsUnavailableError extends Error {
  constructor() {
    super('The data engine cannot enumerate its objects, so the objects a sharing rule can take effect on cannot be listed.');
    this.name = 'ShareableObjectsUnavailableError';
  }
}

/**
 * Raised when the sharing-rule subsystem is not running on this kernel (record
 * sharing configured with `enforce: false`, or the subsystem failed to start).
 * No object can take a rule there, and the door says so rather than answering
 * an empty list or an unmounted path.
 */
export class SharingRulesNotRunningError extends Error {
  constructor() {
    super('Sharing rules are not running on this deployment (record-sharing enforcement is off or did not start), so no object can take one.');
    this.name = 'SharingRulesNotRunningError';
  }
}

interface ObjectConfigShape {
  name?: unknown;
  label?: unknown;
}

function labelOf(name: string, config: ObjectConfigShape): string {
  return typeof config.label === 'string' && config.label.trim().length > 0 ? config.label : name;
}

function isPlatformObject(name: string, config: ObjectConfigShape): boolean {
  return isPlatformObjectSchema(config) || name.startsWith('sys_');
}

function byGroupThenLabel(a: ShareableObject, b: ShareableObject): number {
  if (a.system !== b.system) return a.system ? 1 : -1;
  const byLabel = a.label.localeCompare(b.label, 'en', { sensitivity: 'base' });
  if (byLabel !== 0) return byLabel;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Every registered object a sharing rule can take effect on, ordered business
 * first. `refusal` is the save doors' own verdict
 * (`SharingService.sharingRuleObjectRefusal`): an object is listed when it
 * answers `null`.
 */
export function listShareableObjects(
  engine: ShareableObjectsEngine,
  refusal: (object: string) => string | null,
): ShareableObject[] {
  if (typeof engine.getConfigs !== 'function') throw new ShareableObjectsUnavailableError();
  const configs = engine.getConfigs();
  if (!configs || typeof configs !== 'object') throw new ShareableObjectsUnavailableError();
  const listed: ShareableObject[] = [];
  for (const [key, raw] of Object.entries(configs)) {
    const config: ObjectConfigShape = raw && typeof raw === 'object' ? (raw as ObjectConfigShape) : {};
    const name = typeof config.name === 'string' && config.name.length > 0 ? config.name : key;
    if (refusal(name) !== null) continue;
    listed.push({ name, label: labelOf(name, config), system: isPlatformObject(name, config) });
  }
  return listed.sort(byGroupThenLabel);
}
