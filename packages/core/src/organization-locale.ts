// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The organization's language — ONE reader of the deployment-default ladder
 * (maintainer ruling 2026-09-02, quoted in `@objectstack/plugin-auth`'s
 * `auth-manager.ts`: 「……其次才是部署默认（`localization.locale` →
 * `i18n.defaultLocale`）。」), for a sentence the platform writes on the
 * organization's behalf rather than for one person.
 *
 * Two rungs, first answer wins (ruling 6913660232, parameter 3):
 *
 *   1. **The organization's Localization setting** — `localization.locale`
 *      read through the `settings` service for `organizationId`, so the
 *      service's own cascade (env override, the organization's row, the
 *      `global` row) decides. ⛔ Only a value somebody SET counts: the
 *      manifest's built-in default (`en-US`, `source: 'default'`) is the
 *      platform's placeholder, not the organization's choice, and taking it
 *      would make rung 2 unreachable — every organization that never opened
 *      Setup → Localization would read `en-US` over the app's declared default.
 *   2. **The app's declared `i18n.defaultLocale`** — what the `i18n` service
 *      answers from `getDefaultLocale()`. ⛔ NOT the settings cascade's
 *      default layer, and so NOT `resolveLocalizationContext().locale`: that
 *      layer holds the `en-US` placeholder and answers it on a `zh-CN` boot.
 *
 * No rung answers ⇒ `undefined`: the caller writes the text as authored.
 * Never an `'en'` guess.
 *
 * A host with no `settings` service has no organization setting to honour, so
 * rung 1 is skipped. A settings read that THROWS is not skipped: the
 * organization's choice may exist and could not be read, and answering another
 * language over it would look like success. The throw reaches the caller,
 * which decides what a failed read means for its own write. The `i18n` hop is
 * probed rather than assumed, as every other reader of the deployment default
 * probes it: `getDefaultLocale` is optional on the contract, so a service
 * without it, or one whose call throws, answers nothing for rung 2.
 *
 * The other readers of the same ladder keep their own code because each
 * answers a different question: the auth mail binds the workspace's setting at
 * boot and on change, the notification text reads the recipient first, and the
 * seed load reads the installing user between the two rungs. The seed load's
 * rung 1 IS this one and calls {@link readOrganizationLocaleSetting}.
 */

/** Which rung answered. */
export type OrganizationLocaleSource = 'organization-setting' | 'app-default';

/** The organization's language and where it came from (for a caller's log line). */
export interface ResolvedOrganizationLocale {
  locale: string;
  source: OrganizationLocaleSource;
}

/** The part of the `settings` service read here — structural, as `plugin-auth` reads it. */
export interface OrganizationLocaleSettingsDoor {
  get(
    namespace: string,
    key: string,
    ctx?: { tenantId?: string },
  ): Promise<{ value?: unknown; source?: string } | undefined | null>;
}

/** What {@link resolveOrganizationLocale} is handed. Every field is optional. */
export interface OrganizationLocaleInput {
  /** The `settings` service, or `undefined` when the host has none. */
  settings?: unknown;
  /** The `i18n` service, or `undefined` when the host has none. */
  i18n?: unknown;
  /** The organization the text is written for. Absent: the settings service's own reach for a caller naming none. */
  organizationId?: string;
}

/** A non-empty, trimmed string, or `undefined`. */
function localeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Rung 1 alone: the organization's `localization.locale` when somebody SET it
 * (`source !== 'default'`), else `undefined`. A `settings` value without a
 * `get` answers `undefined`; a `get` that throws propagates.
 */
export async function readOrganizationLocaleSetting(
  settings: unknown,
  organizationId: string | undefined,
): Promise<string | undefined> {
  const door = settings as Partial<OrganizationLocaleSettingsDoor> | null | undefined;
  if (!door || typeof door.get !== 'function') return undefined;
  const orgId = localeText(organizationId);
  const resolved = await door.get('localization', 'locale', orgId ? { tenantId: orgId } : {});
  const value = localeText(resolved?.value);
  return value && resolved?.source !== 'default' ? value : undefined;
}

/** Rung 2 alone: the app's declared default language off the `i18n` service, probed. */
function appDefaultLocale(i18n: unknown): string | undefined {
  const service = i18n as { getDefaultLocale?: unknown } | null | undefined;
  if (!service || typeof service.getDefaultLocale !== 'function') return undefined;
  try {
    return localeText((service.getDefaultLocale as () => unknown).call(service));
  } catch {
    // Optional on the contract and best-effort at every reader: no answer.
    return undefined;
  }
}

/** Resolve the organization's language. See the module docblock for the rungs. */
export async function resolveOrganizationLocale(
  input: OrganizationLocaleInput,
): Promise<ResolvedOrganizationLocale | undefined> {
  const set = await readOrganizationLocaleSetting(input.settings, input.organizationId);
  if (set) return { locale: set, source: 'organization-setting' };
  const declared = appDefaultLocale(input.i18n);
  return declared ? { locale: declared, source: 'app-default' } : undefined;
}

/**
 * The settings service's refusal of a namespace or key nobody REGISTERED —
 * `SETTINGS_UNKNOWN_NAMESPACE` / `SETTINGS_UNKNOWN_KEY`, as `@objectstack/objectql`'s
 * home-localization bridge reads them.
 */
function isUnregisteredSetting(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return code === 'SETTINGS_UNKNOWN_NAMESPACE' || code === 'SETTINGS_UNKNOWN_KEY';
}

/**
 * [ruling 6913660232, review 6924979595 S1] The settings door a WRITER of
 * organization-language text hands {@link resolveOrganizationLocale} (through
 * {@link readOrganizationTextLocale}): an
 * unregistered `localization.locale` is answered as not set, so the next rung
 * (the app's declared default) answers. A host that loads no `localization`
 * manifest has no setting anybody could have set. Any other throw still
 * propagates: the setting may exist and could not be read, and the writer
 * fails rather than store another language over it.
 *
 * Shared by every writer of such text — the flow record write
 * (`@objectstack/service-automation`) and a hook's or action's declared text
 * (`ctx.text`, `@objectstack/runtime`, #34374) — and kept apart from the
 * reader itself, so the seed loader's rung 1 keeps propagating every throw.
 */
function treatUnregisteredLocaleSettingAsUnset(settings: unknown): unknown {
  const door = settings as { get?: unknown } | null | undefined;
  if (!door || typeof door.get !== 'function') return settings;
  const get = door.get as (namespace: string, key: string, ctx?: { tenantId?: string }) => Promise<unknown>;
  return {
    async get(namespace: string, key: string, ctx?: { tenantId?: string }) {
      try {
        return await get.call(settings, namespace, key, ctx);
      } catch (err: unknown) {
        if (isUnregisteredSetting(err)) return undefined;
        throw err;
      }
    },
  };
}

/**
 * The organization's language for a sentence the platform WRITES into a record
 * on the organization's behalf — the one reading every such writer shares:
 * the flow record write's text field (`@objectstack/service-automation`) and a
 * hook's or action's declared text (`ctx.text`, `@objectstack/runtime`,
 * #34374). {@link resolveOrganizationLocale} over the `settings` and `i18n`
 * services, both looked up at QUESTION time (a service registered after the
 * caller bound is still found), with an unregistered Localization setting
 * answered as not set. `undefined`: no rung answered, write the authored text.
 * A settings read that throws rejects.
 *
 * NOT a second reading of the setting: rung 1 here IS
 * {@link readOrganizationLocaleSetting}, reached through
 * {@link resolveOrganizationLocale}. What this adds over that reader, for a
 * writer only, and why the seed loader keeps calling that reader bare:
 *
 *  | the setting answers…                         | `readOrganizationLocaleSetting` | this                  |
 *  | set (`source !== 'default'`)                 | the value                       | the value             |
 *  | the `source: 'default'` placeholder          | `undefined`                     | the app default       |
 *  | no settings service                          | `undefined`                     | the app default       |
 *  | `SETTINGS_UNKNOWN_NAMESPACE` / `…_KEY`       | rejects                         | the app default       |
 *  | any other throw                              | rejects                         | rejects               |
 *
 * — rung 2 (the app's declared `i18n.defaultLocale`), an unregistered setting
 * read as not set, and both services looked up at question time by name.
 */
export async function readOrganizationTextLocale(
  getService: ((name: string) => unknown) | undefined,
  organizationId: string | undefined,
): Promise<string | undefined> {
  let settings: unknown;
  let i18n: unknown;
  try { settings = getService?.('settings'); } catch { settings = undefined; }
  try { i18n = getService?.('i18n'); } catch { i18n = undefined; }
  return (await resolveOrganizationLocale({
    settings: treatUnregisteredLocaleSettingAsUnset(settings),
    i18n,
    organizationId,
  }))?.locale;
}
