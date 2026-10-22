// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The IdP's `locale` claim → the user's language preference (`sys_user.locale`).
 *
 * When an environment creates or refreshes a user just-in-time from an
 * external IdP sign-in — the cloud as IdP on a hosted environment, or any
 * OIDC IdP — the standard OIDC `locale` claim (OIDC Core §5.1, a BCP-47 tag)
 * becomes the user's language preference, so a hosted environment follows the
 * cloud account's language. The column is the one the console reads as the
 * signed-in user's UI language and service-messaging reads per recipient.
 *
 * ## The rule
 *
 *  1. **First creation** — the claim sets the preference.
 *  2. **A later sign-in** — the claim updates it only while the user has not
 *     set a preference in the environment itself: a local choice wins.
 *  3. **An unknown or unsupported claim** — the column is left unset (an
 *     IdP-written value is cleared), so the deployment default applies, which
 *     is what an unset `sys_user.locale` means everywhere it is read. The
 *     claim is closed against the locales the i18n service reports
 *     (`getLocales()`, narrowed to the app's declared `i18n.supportedLocales`)
 *     with the platform's own matcher (`resolveLocale`: exact → case →
 *     base language → variant), and the SUPPORTED spelling is what is stored.
 *  4. **No claim at all** — the IdP said nothing, so nothing changes.
 *
 * ## How "a local choice" is told apart from an IdP-written value
 *
 * The column alone cannot say who wrote it, so the value the IdP path last
 * wrote is recorded beside it: one `sys_verification` row per user
 * ({@link idpLocaleRecordIdentifier}), written through better-auth's DATABASE
 * adapter — the implicit-linking unlink record's idiom, and for the same
 * reason (`implicit-account-linking.ts`, {@link LinkingDbAdapter}: a host
 * `secondaryStorage` cache must never be the only home of it). The IdP owns
 * the column while it is unset, or while it still holds exactly the recorded
 * value; any other value is a local choice and is never overwritten.
 *
 * Every partial failure degrades toward "local choice wins": the column is
 * written before the record, so a record that cannot be written leaves the
 * column differing from it, and the next sign-in keeps the value rather than
 * overwriting it. A user who picks the very language the IdP asserts is
 * indistinguishable from one who never picked, and keeps following the IdP —
 * the only reading under which the two cannot disagree about what they see.
 * Clearing the column locally hands it back to the IdP.
 *
 * ## Where it runs
 *
 * better-auth hands the raw IdP profile to the `validateUserInfo` seam on
 * every action of an external sign-in (`create-user`, `sign-in`,
 * `link-account`): `source.oauth.profile` for generic-OAuth and social
 * providers (the cloud IdP is a generic-OAuth provider), `source.sso.profile`
 * for `@better-auth/sso` OIDC providers. That seam may still refuse the
 * sign-in and runs before the user row exists, so it only STAGES the claim,
 * scoped to the request ({@link IdpLocaleSync.stage}). The session a
 * successful sign-in mints — new user or returning — is where the user id is
 * final, so `session.create.after` SETTLES it ({@link IdpLocaleSync.settle}).
 * A sign-in that is refused mints no session, and the staged claim dies with
 * its request.
 *
 * A failure here never fails a sign-in. It is a functional degradation — the
 * user sees the deployment default instead of the IdP's language, visibly —
 * so it is reported at `warn`.
 */

import { resolveLocale } from '@objectstack/core';
import { normalizeRecipientLocale } from '@objectstack/service-messaging';
import { authContextOf, type LinkingDbAdapter } from './implicit-account-linking.js';

/** The `sys_verification.identifier` namespace for the IdP-written locale record. */
const IDP_LOCALE_RECORD_PREFIX = 'idp-locale';

/**
 * The record's lifetime. It must outlive any realistic gap between two
 * sign-ins; better-auth's verification sweep deletes rows by `expiresAt`, so
 * the value has to be finite (the unlink record's reasoning).
 */
const IDP_LOCALE_RECORD_TTL_MS = 100 * 365 * 24 * 60 * 60 * 1000;

const VERIFICATION_MODEL = 'verification';

/** The sign-in methods whose profile is an OIDC claim set. */
const OIDC_PROFILE_SOURCES: Readonly<Record<string, 'oauth' | 'sso'>> = {
  oauth: 'oauth',
  'sso-oidc': 'sso',
};

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

export function idpLocaleRecordIdentifier(userId: string): string {
  return `${IDP_LOCALE_RECORD_PREFIX}:${userId}`;
}

/** What one IdP sign-in asserted about the user's language. */
export interface IdpLocaleClaim {
  /** The provider that asserted it, for the record and the logs. */
  providerId?: string;
  /** The raw claim value — anything, as the IdP sent it. */
  value: unknown;
}

/**
 * The `locale` claim of the IdP profile a `validateUserInfo` source carries,
 * or `undefined` when the source is not an OIDC sign-in or its profile has no
 * `locale` key. A present-but-unusable value IS a claim (rule 3).
 */
export function readIdpLocaleClaim(source: unknown): IdpLocaleClaim | undefined {
  const s = source as { method?: unknown; oauth?: unknown; sso?: unknown } | null | undefined;
  const branch = typeof s?.method === 'string' ? OIDC_PROFILE_SOURCES[s.method] : undefined;
  if (!branch) return undefined;
  const carrier = s?.[branch] as { providerId?: unknown; profile?: unknown } | undefined;
  const profile = carrier?.profile;
  if (!profile || typeof profile !== 'object' || !('locale' in profile)) return undefined;
  return {
    providerId: typeof carrier?.providerId === 'string' ? carrier.providerId : undefined,
    value: (profile as { locale?: unknown }).locale,
  };
}

/**
 * The supported locale a claim names, in the SUPPORTED spelling, or
 * `undefined` for an unknown or unsupported claim. OIDC Core §5.1 notes that
 * some implementations write the region with an underscore (`en_US`); that
 * spelling is read as the BCP-47 tag it stands for.
 */
export function resolveIdpLocale(claim: unknown, supported: readonly string[]): string | undefined {
  const tag = normalizeRecipientLocale(typeof claim === 'string' ? claim.replace(/_/g, '-') : claim);
  if (!tag) return undefined;
  return resolveLocale(tag, [...supported]);
}

/** The state the decision reads. */
export interface IdpLocaleState {
  /** The supported locale the claim names (`undefined`: unknown or unsupported). */
  resolved: string | undefined;
  /** `sys_user.locale` as stored (`undefined`: unset). */
  stored: string | undefined;
  /** The value the IdP path last wrote (`undefined`: no record). */
  recorded: string | undefined;
}

/**
 * What to write, or `null` to leave both the column and the record as they
 * are. `locale: null` clears the column; `record: null` drops the record.
 */
export type IdpLocaleWrite = { locale: string | null; record: string | null } | null;

/** The rule (module header), as a pure decision. */
export function decideIdpLocaleWrite(state: IdpLocaleState): IdpLocaleWrite {
  const { resolved, stored, recorded } = state;
  const idpOwnsColumn = stored === undefined || (recorded !== undefined && stored === recorded);
  if (!idpOwnsColumn) return null;
  const target = resolved ?? null;
  const columnChanges = target !== (stored ?? null);
  const recordChanges = target !== (recorded ?? null);
  if (!columnChanges && !recordChanges) return null;
  return { locale: target, record: target };
}

/** The slice of the data engine the settle step uses. */
export interface IdpLocaleEngine {
  findOne(object: string, query: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  update(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export interface IdpLocaleSyncDeps {
  getEngine(): IdpLocaleEngine | undefined;
  /** The i18n service's reported locales; `undefined` when there is no service to ask. */
  getSupportedLocales(): readonly string[] | undefined;
  /** better-auth's auth context, for a call whose endpoint context carries none. */
  resolveAuth(): Promise<{ adapter: LinkingDbAdapter } | undefined>;
  warn(message: string, meta?: Record<string, unknown>): void;
}

const storedLocaleOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** One per auth manager: stages a sign-in's claim, then settles it on the session. */
export class IdpLocaleSync {
  /** Scoped to the request: the entry dies with the endpoint context that staged it. */
  private readonly staged = new WeakMap<object, IdpLocaleClaim>();
  private warnedNoLocales = false;

  constructor(private readonly deps: IdpLocaleSyncDeps) {}

  /** `validateUserInfo` half: stage the claim. Never throws, never refuses. */
  stage(data: unknown, ctx: unknown): void {
    if (!ctx || typeof ctx !== 'object') return;
    const claim = readIdpLocaleClaim((data as { source?: unknown } | null)?.source);
    if (claim) this.staged.set(ctx, claim);
  }

  /** `session.create.after` half: apply the rule for the session's user. Never throws. */
  async settle(session: unknown, ctx: unknown): Promise<void> {
    if (!ctx || typeof ctx !== 'object') return;
    const claim = this.staged.get(ctx);
    if (!claim) return;
    this.staged.delete(ctx);
    const userId = (session as { userId?: unknown } | null)?.userId;
    if (typeof userId !== 'string' || !userId) return;
    try {
      const supported = this.deps.getSupportedLocales();
      if (!supported || supported.length === 0) {
        // Without the list nothing can be judged supported, and clearing an
        // IdP-written value on that ground would be judging anyway.
        if (!this.warnedNoLocales) {
          this.warnedNoLocales = true;
          this.deps.warn(
            '[auth] the IdP locale claim was not applied: no i18n service reports a supported locale, ' +
              "so a user's language does not follow their IdP. Register an i18n service (or declare " +
              'i18n.supportedLocales) to have external sign-ins set the user language preference.',
          );
        }
        return;
      }
      const engine = this.deps.getEngine();
      if (!engine) return;
      const auth = authContextOf(ctx) ?? (await this.deps.resolveAuth());
      if (!auth) throw new Error('the auth store is unavailable');
      const row = await engine.findOne('sys_user', {
        where: { id: userId },
        fields: ['id', 'locale'],
        context: SYSTEM_CTX,
      });
      if (!row) return;
      const record = await auth.adapter.findOne({
        model: VERIFICATION_MODEL,
        where: [{ field: 'identifier', value: idpLocaleRecordIdentifier(userId) }],
      });
      const write = decideIdpLocaleWrite({
        resolved: resolveIdpLocale(claim.value, supported),
        stored: storedLocaleOf(row.locale),
        recorded: recordedLocaleOf(record),
      });
      if (!write) return;
      if (write.locale !== (storedLocaleOf(row.locale) ?? null)) {
        await engine.update('sys_user', { id: userId, locale: write.locale }, { context: SYSTEM_CTX });
      }
      await writeRecord(auth.adapter, userId, write.record, claim.providerId);
    } catch (e) {
      this.deps.warn(
        '[auth] the IdP locale claim was not applied: the sign-in succeeded, and the user keeps the ' +
          'language preference they had. It is applied again on their next external sign-in once the ' +
          'user store and the auth store are writable.',
        { userId, providerId: claim.providerId, error: (e as Error)?.message },
      );
    }
  }

  /** `user.delete.after` half: a deleted user leaves no record behind. Never throws. */
  async forget(user: unknown, ctx: unknown): Promise<void> {
    const id = (user as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !id) return;
    try {
      const auth = authContextOf(ctx) ?? (await this.deps.resolveAuth());
      if (!auth) return;
      await auth.adapter.deleteMany({
        model: VERIFICATION_MODEL,
        where: [{ field: 'identifier', value: idpLocaleRecordIdentifier(id) }],
      });
    } catch (e) {
      // Inert once its user is gone: a new user never has the deleted id.
      this.deps.warn('[auth] could not clear the IdP locale record of a deleted user', {
        error: (e as Error)?.message,
      });
    }
  }
}

function recordedLocaleOf(record: unknown): string | undefined {
  const value = (record as { value?: unknown } | null)?.value;
  if (typeof value !== 'string') return undefined;
  try {
    return storedLocaleOf((JSON.parse(value) as { locale?: unknown } | null)?.locale);
  } catch {
    return undefined;
  }
}

/** Replace the user's record with `locale`, or drop it when `locale` is `null`. */
async function writeRecord(
  adapter: LinkingDbAdapter,
  userId: string,
  locale: string | null,
  providerId: string | undefined,
): Promise<void> {
  const identifier = idpLocaleRecordIdentifier(userId);
  await adapter.deleteMany({ model: VERIFICATION_MODEL, where: [{ field: 'identifier', value: identifier }] });
  if (locale === null) return;
  const now = new Date();
  await adapter.create({
    model: VERIFICATION_MODEL,
    data: {
      identifier,
      value: JSON.stringify({ locale, providerId: providerId ?? null, writtenAt: now.toISOString() }),
      expiresAt: new Date(now.getTime() + IDP_LOCALE_RECORD_TTL_MS),
      createdAt: now,
      updatedAt: now,
    },
  });
}
