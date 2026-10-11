// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `sys_email_template` {@link TemplateLoader} — locale resolution that
 * answers from the DECLARED contract instead of from driver row order (#7731).
 *
 * ## What was wrong
 *
 * The loader used to be four lines inline in `EmailServicePlugin`: build
 * `where = { name }`, add `where.locale` only when a locale was passed, then
 * `find(..., { limit: 1 })` with **no ordering**. "First row of an unordered
 * set" is whatever the driver happens to yield — so an i18n bundle with `en-US`
 * and `zh-CN` rows under one name rendered `zh-CN` for a caller that named no
 * locale at all, on two consecutive fresh boots. Nothing in the system declares
 * that; three separate places declare the opposite:
 *
 *  - `SendTemplateInput.locale` (spec contract): *"Falls back to `'en-US'`"*.
 *  - `EmailTemplateDefinitionSchema.locale`: the resolver *"matches
 *    `(name, locale)` **exactly**"* and, for a call that named a locale,
 *    retries exactly one rung — `EMAIL_TEMPLATE_FLOOR_LOCALE`.
 *  - `sys_email_template`'s own object doc: resolved by an exact
 *    `(name, locale)` match with that same single `en-US` rung.
 *
 * Those last two bullets are CITED, not quoted in full, and deliberately:
 * both sentences once read "picks the best match for the recipient's locale"
 * / "picks the best-matching locale for the recipient" — the claim the rule
 * below says the resolver has never implemented. They were corrected to the
 * ladder as built (#18499), together with `sys_notification_template.locale`
 * and the platform checklist's locale clause; a quotation is what stranded
 * them here in the first place.
 *
 * ## The rule this implements
 *
 * Every branch below pins the row it wants in the `where` clause; none of them
 * asks the store to pick a locale for us:
 *
 *  1. **A locale was named** → exact `(name, locale)` match, or `null`. The
 *     en-US fallback stays where it is documented — in `sendTemplate`'s ladder
 *     — so a replacement loader cannot silently relocate it.
 *  2. **No locale** → `(name, 'en-US')`, the documented default. This is the
 *     #7731 fix: the *query* names en-US, so even a driver that honours no
 *     ordering at all cannot answer with a different locale.
 *  3. **No locale and no en-US row** → the bundle's lowest locale tag, ordered.
 *     A store holding only `zh-CN` rows worked before this change (there was
 *     exactly one row to pick arbitrarily from), and refusing it now would
 *     trade one bug for an outage. Ordered rather than arbitrary, so the answer
 *     is the same on every boot.
 *
 * Language-only prefix matching (`zh` → `zh-CN`) is deliberately NOT here: no
 * contract declares it, and inventing it would put a resolution rule in the
 * code that no spec, doc or form describes.
 *
 * Ordering is spelled `orderBy` — the canonical engine key. `sort` is the wire
 * spelling and `find()` rejects it outright, so a tie-break has to be spelled
 * this way to exist at all.
 */

import { DEFAULT_TEMPLATE_LOCALE, type EmailTemplateRow, type TemplateLoader } from './email-service.js';
import { EMAIL_TEMPLATE_OBJECT } from './bootstrap-declared-email-templates.js';
import { stripReadDecorations } from '@objectstack/spec/kernel';
import { EmailTemplateDefinitionSchema, type EmailTemplateDefinitionParsed } from '@objectstack/spec/system';

/** System read context — template resolution is not an end-user query. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * The slice of the ObjectQL engine this loader calls. Declared here rather than
 * imported as `IDataEngine` so the seam a test has to fake is one method.
 */
export interface TemplateLoaderEngine {
  find(object: string, query: Record<string, unknown>): Promise<unknown>;
}

/** Sort node shape as the engine spells it (`orderBy`, never the wire `sort`). */
interface TemplateSort { field: string; order: 'asc' | 'desc' }

/**
 * Tie-break for a query that already pins `(name, locale)`: duplicates of one
 * locale (an org overlay row landing beside the platform one) must still
 * resolve the same way on every boot.
 */
const BY_ID: readonly TemplateSort[] = [{ field: 'id', order: 'asc' }];

/** Deterministic order for the unpinned last resort — lowest locale tag wins. */
const BY_LOCALE: readonly TemplateSort[] = [
  { field: 'locale', order: 'asc' },
  { field: 'id', order: 'asc' },
];

/** Options for {@link createSysEmailTemplateLoader}. */
export interface CreateTemplateLoaderOptions {
  /** Backing object name; overridable for tests. */
  object?: string;
}

/**
 * Build the `sys_email_template` loader `EmailService` resolves templates
 * through. See the module doc for the resolution rule it implements.
 */
export function createSysEmailTemplateLoader(
  engine: TemplateLoaderEngine,
  options: CreateTemplateLoaderOptions = {},
): TemplateLoader {
  const object = options.object ?? EMAIL_TEMPLATE_OBJECT;

  const first = async (
    where: Record<string, unknown>,
    orderBy: readonly TemplateSort[],
  ): Promise<EmailTemplateRow | null> => {
    const rows = await engine.find(object, {
      where,
      orderBy: orderBy.map((s) => ({ ...s })),
      limit: 1,
      context: SYSTEM_CTX,
    });
    const row = Array.isArray(rows) ? rows[0] : (rows as any)?.data?.[0];
    return (row as EmailTemplateRow) || null;
  };

  return {
    async load(name, locale) {
      if (locale) return first({ name, locale }, BY_ID);
      const preferred = await first({ name, locale: DEFAULT_TEMPLATE_LOCALE }, BY_ID);
      if (preferred) return preferred;
      // No en-US row in this bundle — rule 3 in the module doc.
      return first({ name }, BY_LOCALE);
    },
  };
}

// ============================================================================
// The registry loader (ADR-0131 D6/D10, ruling C on §6 Q1)
// ============================================================================

/**
 * The package the built-in auth templates are code-declared under: the email
 * plugin's own manifest (`EmailServicePlugin.init` registers them through it).
 * Module-internal — exported for this package's own wiring and tests only.
 */
export const BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID = 'com.objectstack.service.email';

/** The metadata type the loader reads. */
const EMAIL_TEMPLATE_TYPE = 'email_template';

/**
 * The reads {@link createRegistryEmailTemplateLoader} resolves through, looked
 * up again at every load so a service that registers late is still seen.
 */
export interface EmailTemplateRegistrySources {
  /**
   * The `protocol` service. `getMetaItemsForExecution` is the layered list
   * `GET /meta/email_template` serves — the environment's stored item over
   * each code package's declaration, one item per `(package, name, locale)`
   * slot — read on its execution face, the one an in-process engine that
   * runs the definitions it reads is meant to use.
   */
  protocol?: { getMetaItemsForExecution(request: { type: string }): Promise<{ items?: unknown[] }> };
  /**
   * The ObjectQL `SchemaRegistry`. Read ONLY when no `protocol` is
   * registered: such a host has no metadata door, so no environment item can
   * exist and the code declarations the registry holds are already the
   * effective set.
   */
  registry?: { listItems(type: string): unknown[] };
}

/** An item's locale as the bundle key reads it: the schema default when it declares none. */
function itemLocale(item: Record<string, unknown>): string {
  return typeof item.locale === 'string' ? item.locale : DEFAULT_TEMPLATE_LOCALE;
}

/**
 * The render input for one resolved definition. Optional keys stay absent
 * rather than `null`, so the renderer derives the plain-text part from the
 * HTML exactly when the author wrote no `bodyText`.
 */
function toRenderInput(tpl: EmailTemplateDefinitionParsed): EmailTemplateRow {
  return {
    name: tpl.name,
    locale: tpl.locale,
    subject: tpl.subject,
    body_html: tpl.bodyHtml,
    ...(tpl.bodyText ? { body_text: tpl.bodyText } : {}),
    ...(tpl.fromOverride?.address ? {
      from_address: tpl.fromOverride.address,
      ...(tpl.fromOverride.name ? { from_name: tpl.fromOverride.name } : {}),
    } : {}),
    ...(tpl.replyTo ? { reply_to: tpl.replyTo } : {}),
    active: tpl.active,
    ...(tpl.variables?.length ? { variables_json: JSON.stringify(tpl.variables) } : {}),
  };
}

/**
 * Build the {@link TemplateLoader} `EmailService` resolves templates through:
 * `email_template` metadata, read from the registry by `(name, locale)`.
 *
 * ## What it reads
 *
 * The layered list the metadata door serves (see
 * {@link EmailTemplateRegistrySources.protocol}). Every population of a
 * template lives there: an app's declaration (`emailTemplates:`, a
 * `*.email-template.ts` file), a Studio save (environment level, ADR-0131
 * D6 — no organization's item is read), and the built-in auth templates,
 * which `EmailServicePlugin` code-declares under
 * {@link BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID}. Nothing is copied into a
 * `sys_email_template` row, so a Studio save is live on the next send with no
 * projection and no restart.
 *
 * Why not `SchemaRegistry.getItem` / `listItems` directly (measured on the
 * showcase): `getItem` answers one member of an i18n bundle per name, and
 * `listItems` hands back an environment item beside the package entry it
 * overrides, both wearing the package's `_packageId` / `_provenance` — so the
 * winner cannot be told from the loser there. The layered list has already
 * decided it.
 *
 * ## The resolution rule (unchanged from the row loader it replaces)
 *
 *  1. **A locale was named** → that exact `(name, locale)`, or `null`. The
 *     `en-US` fallback stays in `EmailService`'s ladder.
 *  2. **No locale** → `(name, 'en-US')`.
 *  3. **No locale and no `en-US` member** → the bundle's lowest locale tag.
 *
 * Within one `(name, locale)`, an item from any other package — or from no
 * package — wins over the built-in: an app that declares `auth.password_reset`
 * overrides the platform's copy, and an environment item stands in for every
 * package slot it overrides.
 *
 * A failed read propagates. Answering it from the registry would serve the
 * package wording over every environment item on a transient storage error;
 * the send fails instead, and its caller decides whether to retry.
 *
 * A malformed item is refused with the schema's own message, never skipped:
 * skipping it would fall through to the built-in copy — the mail an author
 * believed they had replaced.
 */
export function createRegistryEmailTemplateLoader(
  sources: EmailTemplateRegistrySources | (() => EmailTemplateRegistrySources),
): TemplateLoader {
  const resolveSources = typeof sources === 'function' ? sources : () => sources;

  const readBundle = async (name: string): Promise<Record<string, unknown>[]> => {
    const { protocol, registry } = resolveSources() ?? {};
    let items: unknown[];
    if (typeof protocol?.getMetaItemsForExecution === 'function') {
      const listed = await protocol.getMetaItemsForExecution({ type: EMAIL_TEMPLATE_TYPE });
      items = (listed?.items ?? []).map(stripReadDecorations);
    } else if (typeof registry?.listItems === 'function') {
      items = registry.listItems(EMAIL_TEMPLATE_TYPE) ?? [];
    } else {
      items = [];
    }
    return items.filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object' && (item as Record<string, unknown>).name === name,
    );
  };

  /** One `(name, locale)` slot: any other package's item before the built-in. */
  const pick = (bundle: Record<string, unknown>[], locale: string): Record<string, unknown> | undefined => {
    const slot = bundle.filter((item) => itemLocale(item) === locale);
    return slot.find((item) => item._packageId !== BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID) ?? slot[0];
  };

  const render = (item: Record<string, unknown> | undefined): EmailTemplateRow | null => {
    if (!item) return null;
    const parsed = EmailTemplateDefinitionSchema.safeParse(item);
    if (!parsed.success) {
      throw new Error(
        `email template '${String(item.name)}' (${itemLocale(item)}) is not a valid email template, so it `
        + `cannot be sent: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
      );
    }
    return toRenderInput(parsed.data);
  };

  return {
    async load(name, locale) {
      const bundle = await readBundle(name);
      if (locale) return render(pick(bundle, locale));
      const preferred = pick(bundle, DEFAULT_TEMPLATE_LOCALE);
      if (preferred) return render(preferred);
      // No en-US member in this bundle — rule 3: the lowest locale tag.
      const lowest = [...new Set(bundle.map(itemLocale))].sort()[0];
      return lowest === undefined ? null : render(pick(bundle, lowest));
    },
  };
}
