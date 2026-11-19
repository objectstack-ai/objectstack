// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The settings a cloud-managed environment does not offer at its doors (#33891).
 *
 * A hosted environment's file storage and its AI provider are provided and
 * configured by the hosting platform, so an administrator of the environment
 * neither sees nor changes them. Whether this process is hosted is
 * `isCloudManaged()` from `@objectstack/core` (`OS_CLOUD_MANAGED=1`) and
 * nothing else; a self-hosted deployment never sets it, and there every door
 * answers exactly as before.
 *
 * ## A door check, not a registry withholding
 *
 * The registry stays whole. The storage service reads
 * `settings.getNamespace('storage')` for its adapter and its limits on every
 * pass, and `SettingsService.get` throws `UnknownKeyError` for an unregistered
 * key, so withholding the manifest at `init()` (what the branding namespace
 * does under a walled posture) would break the hosted readers this platform
 * configures through. The hiding happens where a CALLER meets the settings:
 *
 *  - `GET /api/settings`: a whole-hidden namespace is left out of the list, and
 *    a per-key namespace is served without its hidden keys;
 *  - `GET /api/settings/:namespace`: a whole-hidden namespace is refused, a
 *    per-key namespace is served without its hidden keys (manifest, values and
 *    `live`);
 *  - `PUT /api/settings/:namespace`: a whole-hidden namespace is refused, and a
 *    write that names any hidden key is refused WHOLE, nothing written, the way
 *    `setMany` refuses a write that names an unknown key;
 *  - `POST /api/settings/:namespace/:actionId`: the refused actions;
 *  - the data API's read of `sys_setting` / `sys_platform_setting` and their
 *    audit trails (`settings-read-door.ts`): the hidden rows are filtered out
 *    for every caller that is not the system.
 *
 * In-process readers (the storage service, the AI service) call the service
 * directly and keep reading every value.
 *
 * ## The refusal
 *
 * `409 RESOURCE_CONFLICT`, no code minted: the house answer of every
 * cloud-managed door (plugin-auth's `cloudManagedRefusal`, cloud-connection's
 * platform-managed doors), on the same rule — the refusal comes from the
 * runtime's state, not from the request. It is told apart from
 * `404 UNKNOWN_NAMESPACE` by its code, and `details.managedBy: 'platform'`
 * names the reason, so the console can draw "managed by the platform" instead
 * of "no such page".
 */

import { isCloudManaged } from '@objectstack/core';

/** What a cloud-managed environment hides of one namespace. */
export interface CloudManagedNamespaceRule {
  /** `'*'` hides the whole namespace; a list hides those keys only. */
  readonly keys: '*' | readonly string[];
  /** The actions refused (`'*'` = every action). */
  readonly actions: '*' | readonly string[];
  /** What the platform provides here, for the refusal's sentence. */
  readonly provides: string;
}

/**
 * The hosted projection. ONE table, read by every door.
 *
 * `ai` hides per key: the provider and its per-provider sections (model and
 * credentials), the generation defaults (temperature, max output, timeout) and
 * the embedder (its provider, model and credentials). The conversation-title
 * and observability keys stay served. Its `test` / `test_embedder` buttons
 * exercise the hidden credentials, and `reset` clears every stored `ai` row,
 * hidden ones included, so all three are refused.
 */
export const CLOUD_MANAGED_HIDDEN_SETTINGS: Readonly<Record<string, CloudManagedNamespaceRule>> = Object.freeze({
  storage: {
    keys: '*',
    actions: '*',
    provides: 'file storage',
  },
  ai: {
    keys: Object.freeze([
      'provider',
      'gateway_model', 'gateway_api_key',
      'openai_api_key', 'openai_model', 'openai_base_url',
      'anthropic_api_key', 'anthropic_model',
      'google_api_key', 'google_model',
      'deepseek_api_key', 'deepseek_model',
      'dashscope_api_key', 'dashscope_model',
      'cloudflare_account_id', 'cloudflare_gateway_id', 'cloudflare_api_key', 'cloudflare_model',
      'siliconflow_api_key', 'siliconflow_model',
      'openrouter_api_key', 'openrouter_model',
      'temperature', 'max_tokens', 'request_timeout_ms',
      'embedder_provider', 'embedder_api_key', 'embedder_model', 'embedder_base_url',
      'embedder_dimensions', 'embedder_batch_size',
    ]),
    actions: Object.freeze(['test', 'test_embedder', 'reset']),
    provides: 'the AI provider, its model and credentials',
  },
});

/** The keys of `ai` a hosted environment still serves — the complement, pinned. */
export const CLOUD_MANAGED_SERVED_AI_KEYS: readonly string[] = Object.freeze([
  'title_generation_enabled', 'title_max_length', 'trace_enabled', 'log_prompts',
]);

/** The `details` a cloud-managed refusal carries. */
export interface SettingsCloudManagedDetails {
  namespace: string;
  managedBy: 'platform';
  keys?: string[];
  actionId?: string;
}

/** A settings door refused because the hosting platform manages what was asked for. */
export class SettingsCloudManagedError extends Error {
  readonly details: SettingsCloudManagedDetails;
  constructor(message: string, details: SettingsCloudManagedDetails) {
    super(message);
    this.name = 'SettingsCloudManagedError';
    this.details = details;
  }
}

/** The status and code every cloud-managed settings refusal answers. */
export const SETTINGS_CLOUD_MANAGED_STATUS = 409;
export const SETTINGS_CLOUD_MANAGED_CODE = 'RESOURCE_CONFLICT' as const;

/** The rule for a namespace in THIS process: none when it is not cloud-managed. */
export function cloudManagedRule(namespace: string): CloudManagedNamespaceRule | undefined {
  if (!isCloudManaged()) return undefined;
  return Object.prototype.hasOwnProperty.call(CLOUD_MANAGED_HIDDEN_SETTINGS, namespace)
    ? CLOUD_MANAGED_HIDDEN_SETTINGS[namespace]
    : undefined;
}

function prefix(rule: CloudManagedNamespaceRule): string {
  return `This environment is cloud-managed: ${rule.provides} is provided and configured by the hosting platform`;
}

/** Refuse a read or write of a namespace hidden whole. */
export function assertNamespaceServed(namespace: string, verb: 'read' | 'write'): void {
  const rule = cloudManagedRule(namespace);
  if (rule?.keys !== '*') return;
  throw new SettingsCloudManagedError(
    `${prefix(rule)}, so its settings are not ${verb === 'read' ? 'shown' : 'changed'} here.`
      + (verb === 'write' ? ' Nothing was written.' : ''),
    { namespace, managedBy: 'platform' },
  );
}

/** Refuse a write that names any hidden key — the whole write, nothing applied. */
export function assertWriteServed(namespace: string, keys: Iterable<string>): void {
  assertNamespaceServed(namespace, 'write');
  const rule = cloudManagedRule(namespace);
  if (!rule || rule.keys === '*') return;
  const hidden = new Set(rule.keys);
  const named = [...keys].filter((k) => hidden.has(k));
  if (named.length === 0) return;
  throw new SettingsCloudManagedError(
    `${prefix(rule)}, so ${named.map((k) => `'${k}'`).join(', ')} cannot be changed here. Nothing was written.`,
    { namespace, managedBy: 'platform', keys: named },
  );
}

/** Refuse an action the hosted projection refuses. */
export function assertActionServed(namespace: string, actionId: string): void {
  const rule = cloudManagedRule(namespace);
  if (!rule) return;
  if (rule.actions !== '*' && !rule.actions.includes(actionId)) return;
  throw new SettingsCloudManagedError(
    `${prefix(rule)}, so '${actionId}' is not run here.`,
    { namespace, managedBy: 'platform', actionId },
  );
}

interface SpecifierLike { type?: string; key?: string; id?: string; handler?: unknown }

/**
 * The manifest a hosted caller is served: hidden keys removed, refused action
 * buttons removed, and every group (with the layout items under it) whose
 * section is left with no served key removed. A section runs from a `group`
 * to the next one; items before the first group form their own section.
 */
export function projectManifest<M extends { namespace: string; specifiers: readonly unknown[] }>(manifest: M): M {
  const rule = cloudManagedRule(manifest.namespace);
  if (!rule || rule.keys === '*') return manifest;
  const hidden = new Set(rule.keys);
  const refusedAction = (id: string | undefined) =>
    id !== undefined && (rule.actions === '*' || rule.actions.includes(id));
  const sections: SpecifierLike[][] = [];
  for (const s of manifest.specifiers as SpecifierLike[]) {
    if (s.type === 'group' || sections.length === 0) sections.push([]);
    sections[sections.length - 1].push(s);
  }
  const served: SpecifierLike[] = [];
  for (const section of sections) {
    const kept = section.filter((s) => {
      if (s.key !== undefined) return !hidden.has(s.key);
      if (s.type === 'action_button') return !refusedAction(s.id);
      return true;
    });
    const keyed = section.some((s) => s.key !== undefined);
    const servesAKey = kept.some((s) => s.key !== undefined);
    // A section that held keys and kept none goes whole: its heading and its
    // banners describe settings this environment does not offer. A keyless
    // section (action buttons only) keeps what survived.
    if (keyed && !servesAKey) continue;
    served.push(...kept);
  }
  return { ...manifest, specifiers: served };
}

/** The list a hosted caller is served: whole-hidden namespaces left out, the rest projected. */
export function projectManifestList<M extends { namespace: string; specifiers: readonly unknown[] }>(manifests: M[]): M[] {
  return manifests
    .filter((m) => cloudManagedRule(m.namespace)?.keys !== '*')
    .map((m) => projectManifest(m));
}

/** A key-indexed map with a namespace's hidden keys removed. */
export function projectKeyed<V>(namespace: string, values: Record<string, V>): Record<string, V> {
  const rule = cloudManagedRule(namespace);
  if (!rule || rule.keys === '*') return values;
  const hidden = new Set(rule.keys);
  return Object.fromEntries(Object.entries(values).filter(([k]) => !hidden.has(k)));
}

/**
 * The row predicate the data-API read door ANDs in for a non-system caller in
 * a hosted process: no row of a whole-hidden namespace, and no row of a hidden
 * key. `null` when nothing is hidden (self-hosted). Built only from the shapes
 * the read door already composes (`$and`, `$or`, `$nin`).
 */
export function cloudManagedRowScope(): Record<string, unknown> | null {
  if (!isCloudManaged()) return null;
  const whole: string[] = [];
  const perKey: Record<string, unknown>[] = [];
  for (const [namespace, rule] of Object.entries(CLOUD_MANAGED_HIDDEN_SETTINGS)) {
    if (rule.keys === '*') whole.push(namespace);
    else perKey.push({ $or: [{ namespace: { $nin: [namespace] } }, { key: { $nin: [...rule.keys] } }] });
  }
  const terms: Record<string, unknown>[] = [];
  if (whole.length > 0) terms.push({ namespace: { $nin: whole } });
  terms.push(...perKey);
  if (terms.length === 0) return null;
  return terms.length === 1 ? terms[0] : { $and: terms };
}
