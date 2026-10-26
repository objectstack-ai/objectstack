// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { SysMember } from '@objectstack/platform-objects/identity';
import { translateMetaList } from '@objectstack/rest';
import { EMAIL_TEMPLATE_FLOOR_LOCALE } from '@objectstack/spec/system';

/**
 * What the invitation mail's `{{role}}` names: the invitee's membership role
 * as the reader of that mail reads it — the `sys_member.role` option LABEL in
 * the mail's locale (`成员`, `メンバー`, `Miembro`, `Member`), never the stored
 * enum value (`member`).
 *
 * ## Where the label comes from — the console's own read, not a second table
 *
 * The label is the one the console shows for the same option: the
 * `sys_member` object's own `role` options (`BUILTIN_MEMBERSHIP_ROLE_OPTIONS`,
 * declared once in `@objectstack/spec/identity`), translated by
 * `translateMetaList` — the function both `/meta` transports run before they
 * serve an object document — over the runtime's i18n service. So the platform
 * bundles `platform-objects` contributes, a host bundle laid over them and a
 * tenant's Studio-authored translation all reach the mail exactly as they reach
 * the console, through the same negotiation (`en-US` reads the `en` bundle) and
 * the same chain (requested locale → the deployment's declared fallback → the
 * authored label). ⛔ No copy of the labels lives here.
 *
 * ## The locale is the mail's, never the inviter's
 *
 * `locale` is the locale the send names (the invitee's stored language, then
 * the deployment default — the caller's rule, unchanged here). A send that
 * names none renders the documented floor row ({@link EMAIL_TEMPLATE_FLOOR_LOCALE}),
 * so the label is read in that locale too: one artefact, one language.
 *
 * ## A value with no label is named as it is stored, and said so once
 *
 * A stored role is a comma-separated list (better-auth joins an array of
 * roles with `,`), so each token is labelled on its own and the labels are
 * joined as a list in the mail's locale (`管理员和成员`, `Admin and Member`).
 * A token outside the option list has no label: it is named verbatim — never
 * dropped, never an empty string — and one `warn` names it. An i18n read that
 * throws degrades to the authored (English) labels with one `warn`; it never
 * blocks the invitation.
 *
 * ## A label with no translation in the mail's locale is said so once, too
 *
 * The read can also answer without throwing and still leave the mail in two
 * languages: no i18n service at all, a service holding no bundle for the
 * mail's locale, or one whose bundle has no entry for the option — each one
 * hands back the authored label (`Member`), or the English fallback-chain
 * entry that repeats it, inside a Chinese sentence. When the mail's locale is
 * not the authored labels' own language ({@link AUTHORED_LABEL_LANGUAGE}) and
 * a token's label is still its authored text, one `warn` names the tokens and
 * the locale, the same way the thrown read does. The mail still goes; the
 * deployment learns that its i18n service never reached this locale's labels.
 */
export async function invitationRoleLabel(
  role: string,
  locale: string | undefined,
  deps: {
    /**
     * The runtime's i18n service, resolved at send time (`AuthManagerOptions.getI18n`);
     * omitted or answering `undefined` when the deployment has none.
     */
    getI18n?: () => unknown;
    warn?: (msg: string, meta?: Record<string, unknown>) => void;
  } = {},
): Promise<string> {
  const tokens = role
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) return role;

  const mailLocale = locale ?? EMAIL_TEMPLATE_FLOOR_LOCALE;
  const authored = SysMember.fields.role;
  const labels = new Map<string, string>();
  const collect = (options: unknown): void => {
    if (!Array.isArray(options)) return;
    for (const option of options) {
      const label = option?.label;
      if (typeof label === 'string' && label.length > 0) labels.set(String(option.value), label);
    }
  };
  let readFailed = false;
  let i18nService: unknown;
  try {
    const [translated] = (await translateMetaList(
      {
        resolveI18nService: async () => (i18nService = deps.getI18n?.()),
        // A packaged base only decides between a catalog and an OVERRIDDEN
        // object scalar; option labels never consult it.
        resolveProtocol: async () => undefined,
        requestLocale: () => mailLocale,
      },
      'object',
      [{ name: SysMember.name, fields: { role: authored } }],
    )) as Array<{ fields?: { role?: { options?: unknown } } }>;
    collect(translated?.fields?.role?.options);
  } catch (err) {
    readFailed = true;
    deps.warn?.(
      '[AuthManager] invitation mail: the membership role labels could not be read from the i18n service; ' +
        'the mail names the authored (English) labels instead',
      { locale: mailLocale, error: (err as Error)?.message ?? String(err) },
    );
  }
  if (labels.size === 0) collect(authored?.options);

  const unlabelled = tokens.filter((token) => !labels.has(token));
  if (unlabelled.length > 0) {
    deps.warn?.(
      `[AuthManager] invitation mail: role value(s) ${unlabelled.map((t) => `'${t}'`).join(', ')} ` +
        'have no sys_member.role option label; the mail names the stored value as it is',
      { role, locale: mailLocale },
    );
  }
  if (!readFailed && !isAuthoredLabelLanguage(mailLocale)) {
    const authoredLabels = new Map<string, string>();
    for (const option of (authored?.options ?? []) as Array<{ value?: unknown; label?: unknown }>) {
      if (typeof option?.label === 'string') authoredLabels.set(String(option.value), option.label);
    }
    const untranslated = tokens.filter((token) => labels.has(token) && labels.get(token) === authoredLabels.get(token));
    if (untranslated.length > 0) {
      deps.warn?.(
        `[AuthManager] invitation mail: no '${mailLocale}' label was found for the membership role(s) ` +
          `${untranslated.map((t) => `'${t}'`).join(', ')}; the mail names the authored (English) label instead. ` +
          'The i18n service holds no translation of sys_member.role for this locale: check that the platform ' +
          'translation bundles are loaded into it and that the locale is among the declared i18n.supportedLocales',
        { role, locale: mailLocale, i18nService: i18nService !== undefined },
      );
    }
  }
  const named = tokens.map((token) => labels.get(token) ?? token);
  if (named.length === 1) return named[0]!;
  // `Intl.ListFormat` is ES2021; this package compiles against the ES2020 lib,
  // so the constructor is probed rather than assumed.
  const ListFormat = (Intl as unknown as { ListFormat?: IntlListFormatConstructor }).ListFormat;
  try {
    if (ListFormat) return new ListFormat(mailLocale, { type: 'conjunction' }).format(named);
  } catch {
    // A tag `Intl` refuses (a tenant overlay's own spelling) still gets a list.
  }
  return named.join(', ');
}

/**
 * The language `sys_member.role`'s authored option labels are written in:
 * `platform-objects` authors its metadata in English, and its `en` bundle is
 * regenerated from that source. A mail in this language reads the authored
 * label as its own text, so only a mail in any OTHER language can be left
 * untranslated.
 */
const AUTHORED_LABEL_LANGUAGE = 'en';

function isAuthoredLabelLanguage(locale: string): boolean {
  return locale.trim().toLowerCase().split(/[-_]/)[0] === AUTHORED_LABEL_LANGUAGE;
}

type IntlListFormatConstructor = new (
  locale: string,
  options: { type: 'conjunction' },
) => { format(list: readonly string[]): string };
