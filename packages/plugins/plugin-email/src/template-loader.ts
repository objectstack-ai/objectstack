// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The email-template {@link TemplateLoader}: `email_template` metadata, read
 * from the registry by `(name, locale)` (ADR-0131 D6/D10, ruling C on §6 Q1).
 *
 * Templates used to be copied into `sys_email_template` rows — the built-ins
 * by a boot seed, declared and Studio-authored ones by a boot sweep and a live
 * projector — and resolved from there. The rows are gone from the send path:
 * every template is read where it is authored, so there is one copy of it.
 *
 * ## The locale rule
 *
 * Answered from the DECLARED contract, never from storage order (#7731) —
 * `SendTemplateInput.locale` (spec contract) and
 * `EmailTemplateDefinitionSchema.locale` carry the ladder of record:
 *
 *  1. **A locale was named** → the exact `(name, locale)` member, or `null`.
 *     The `en-US` fallback stays where it is documented — in `EmailService`'s
 *     ladder — so a replacement loader cannot silently relocate it.
 *  2. **No locale** → `(name, 'en-US')`, the documented default. A bundle
 *     carrying `en-US` and `zh-CN` answers `en-US` to a caller that named no
 *     locale, whatever order the members were declared in.
 *  3. **No locale and no `en-US` member** → the bundle's lowest locale tag. A
 *     single-locale bundle keeps working rather than resolving to nothing, and
 *     the answer is the same on every boot.
 *
 * Language-only prefix matching (`zh` → `zh-CN`) is deliberately NOT here: no
 * contract declares it, and inventing it would put a resolution rule in the
 * code that no spec, doc or form describes.
 *
 * ## The name rule: `(package, name)` (ADR-0150 D3/D4)
 *
 * An email template is addressed by `(package, name)`. Before a bundle is
 * read, the name is resolved by the ONE package-scoped resolver
 * (`resolvePackageScopedName`, `@objectstack/objectql`) over the ObjectQL
 * registry, from the package the send is made from
 * (`SendTemplateInput.callerPackageId`; a flow's `notify` node passes the
 * package whose own flow body is armed): that package's own template, else
 * the one holder in its declared dependency closure, else a refusal naming
 * every candidate. A send that names no package keeps the bare-name meaning:
 * the environment's own item, else the unique package holder (the built-ins
 * rank below it, ADR-0150 D3 (b)), else a refusal naming every holder. A
 * refusal fails the send ({@link EmailTemplateAmbiguousError}). ⛔ Never a
 * first-listed pick.
 *
 * Since the type's one-holder rule narrowed to the namespace (ADR-0150 D9,
 * #31699), two packages of two namespaces may each ship a name. When the name
 * resolves to one of two or more package holders, the bundle read is the
 * resolved holder's own address (the list scoped to it: its members, its
 * pair's added members, its environment overlay), never the environment-wide
 * list, which lists every holder's members side by side. A name with one
 * package holder reads the environment-wide list exactly as before: there it
 * already IS that holder's bundle (a dependent's added member is no holder,
 * and the list leaves it out). A dependent's added member meets its base: a
 * send from the dependent resolves the name from its closure, as a send from
 * any other package of it would. The `auth.*` mails the platform sends keep
 * one overriding package per deployment (`PLATFORM_REQUESTED_BARE_NAMES_BY_TYPE`,
 * `@objectstack/core`) and resolve environment-wide whatever the caller.
 */

import {
  resolvePackageScopedName,
  type PackageScopedHolder,
  type PackageScopedRefusal,
  type PackageScopedRegistry,
} from '@objectstack/objectql';
import { stripReadDecorations } from '@objectstack/spec/kernel';
import { EmailTemplateDefinitionSchema, type EmailTemplateDefinitionParsed } from '@objectstack/spec/system';
import {
  DEFAULT_TEMPLATE_LOCALE,
  TEMPLATE_BUNDLE_LOCALES,
  type EmailTemplateRow,
  type TemplateLoader,
  type TemplateBundleLocales,
  type TemplateLoadOptions,
} from './email-service.js';

/**
 * The package the built-in auth templates are code-declared under: the email
 * plugin's own manifest (`EmailServicePlugin.init` registers them through it).
 * Module-internal — exported for this package's own wiring and tests only.
 */
export const BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID = 'com.objectstack.service.email';

/** The metadata type the loader reads. */
const EMAIL_TEMPLATE_TYPE = 'email_template' as const;

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
  protocol?: { getMetaItemsForExecution(request: { type: string; packageId?: string }): Promise<{ items?: unknown[] }> };
  /**
   * The ObjectQL `SchemaRegistry`. Its items are read ONLY when no `protocol`
   * is registered: such a host has no metadata door, so no environment item
   * can exist and the code declarations the registry holds are already the
   * effective set. When it carries the package-scoped slice
   * ({@link PackageScopedRegistry}), every name is resolved over it first
   * (module doc, "The name rule").
   */
  registry?: { listItems(type: string): unknown[] } & Partial<PackageScopedRegistry>;
}

/**
 * [ADR-0150 D3, epic #31527 red line 2] A template name that resolves to no
 * single template: two packages ship it, and nothing picks one. `code` +
 * `status` are the conflict envelope (409 `RESOURCE_CONFLICT`, the status
 * ADR-0150 D5 gives an ambiguous bare name); `candidates` names every holder,
 * and so does the message.
 */
export class EmailTemplateAmbiguousError extends Error {
  readonly code = 'RESOURCE_CONFLICT';
  readonly status = 409;
  /** The template name. */
  readonly template: string;
  /** Every holder of the name, in the resolver's order. */
  readonly candidates: readonly PackageScopedHolder[];
  constructor(refusal: PackageScopedRefusal) {
    super(`email template '${refusal.name}' cannot be sent: ${refusal.message}`);
    this.name = 'EmailTemplateAmbiguousError';
    this.template = refusal.name;
    this.candidates = refusal.candidates;
  }
}

/** The registry, when it carries the slice the package-scoped resolver reads. */
function packageScopedRegistryOf(registry: EmailTemplateRegistrySources['registry']): PackageScopedRegistry | undefined {
  return typeof registry?.packageScopedHoldersOf === 'function'
    && typeof registry.getPackageScopedItem === 'function'
    && typeof registry.getEnvironmentScopedItem === 'function'
    && typeof registry.getPackage === 'function'
    && typeof registry.getAllPackages === 'function'
    ? (registry as PackageScopedRegistry)
    : undefined;
}

/**
 * [ADR-0150 D3/D9, #31699] The package whose own address the bundle of `name`
 * is read at, for a send made from `callerPackageId`; `undefined` to read the
 * environment-wide list, as before. Throws the refusal when the name does not
 * resolve for the caller.
 *
 * Only a name two or more packages hold (the built-ins aside, which rank
 * below any of them) is read at one address: with one holder the
 * environment-wide list is already its bundle. A caller whose own holding is a
 * bundle ADDITION (a locale a dependent adds to another package's template,
 * which holds no name for anyone else) meets its base: the name is resolved
 * again from its closure over the holders every other reader sees.
 */
function bundleAddressOf(scoped: PackageScopedRegistry, name: string, callerPackageId: string | null): string | undefined {
  const resolved = resolvePackageScopedName(scoped, { type: EMAIL_TEMPLATE_TYPE, name, callerPackageId });
  if (resolved.status === 'refused') throw new EmailTemplateAmbiguousError(resolved);
  if (resolved.status !== 'resolved' || resolved.holder.kind !== 'package') return undefined;
  const holders = (scoped.packageScopedHoldersOf(EMAIL_TEMPLATE_TYPE, name) ?? [])
    .filter((id) => id !== BUILTIN_EMAIL_TEMPLATES_PACKAGE_ID);
  if (holders.length < 2) return undefined;
  const holder = resolved.holder.packageId;
  if (holders.includes(holder)) return holder;
  // The caller holds an addition only: resolve from its closure over the
  // holders every other reader sees (its own addition left out).
  const shared: PackageScopedRegistry = {
    getPackage: (id) => scoped.getPackage(id),
    getAllPackages: () => scoped.getAllPackages(),
    getPackageScopedItem: (type, n, packageId, member) => scoped.getPackageScopedItem(type, n, packageId, member),
    getEnvironmentScopedItem: (type, n, member) => scoped.getEnvironmentScopedItem(type, n, member),
    packageScopedHoldersOf: (type, n) => scoped.packageScopedHoldersOf(type, n),
  } as PackageScopedRegistry;
  const base = resolvePackageScopedName(shared, { type: EMAIL_TEMPLATE_TYPE, name, callerPackageId });
  if (base.status === 'refused') throw new EmailTemplateAmbiguousError(base);
  return base.status === 'resolved' && base.holder.kind === 'package' ? base.holder.packageId : undefined;
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
 * ## Which item wins one `(name, locale)`
 *
 * The locale rule is the module doc's. Within one `(name, locale)`, an item
 * from any other package — or from no package — wins over the built-in: an
 * app that declares `auth.password_reset` overrides the platform's copy, and
 * an environment item stands in for every package slot it overrides.
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

  const readBundle = async (name: string, options?: TemplateLoadOptions): Promise<Record<string, unknown>[]> => {
    const { protocol, registry } = resolveSources() ?? {};
    // [ADR-0150 D3] The name first, from the package the send is made from (a
    // caller with no package when it names none). A refusal fails the send,
    // naming every candidate; a name two packages hold is read at the
    // resolved holder's own address; any other answer leaves the bundle to the
    // environment-wide read below, as before.
    const scoped = packageScopedRegistryOf(registry);
    const address = scoped ? bundleAddressOf(scoped, name, options?.callerPackageId ?? null) : undefined;
    let items: unknown[];
    if (typeof protocol?.getMetaItemsForExecution === 'function') {
      const listed = await protocol.getMetaItemsForExecution(
        address === undefined ? { type: EMAIL_TEMPLATE_TYPE } : { type: EMAIL_TEMPLATE_TYPE, packageId: address },
      );
      items = (listed?.items ?? []).map(stripReadDecorations);
    } else if (typeof registry?.listItems === 'function') {
      items = registry.listItems(EMAIL_TEMPLATE_TYPE) ?? [];
      if (address !== undefined) {
        items = items.filter((item) => (item as { _packageId?: unknown } | null)?._packageId === address);
      }
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

  // [#28880] The bundle's tags, for the service's fold (module-private key,
  // not on `TemplateLoader`): sorted, so each first-match step of
  // `resolveLocaleAmong` (the table language's first mapped tag, variant
  // expansion's first variant) answers the lowest tag, whatever order the
  // list carries.
  const bundleLocales: TemplateBundleLocales = async (name, options) =>
    [...new Set((await readBundle(name, options)).map(itemLocale))].sort();

  const loader: TemplateLoader & { [TEMPLATE_BUNDLE_LOCALES]: TemplateBundleLocales } = {
    [TEMPLATE_BUNDLE_LOCALES]: bundleLocales,
    async load(name, locale, options) {
      const bundle = await readBundle(name, options);
      if (locale) return render(pick(bundle, locale));
      const preferred = pick(bundle, DEFAULT_TEMPLATE_LOCALE);
      if (preferred) return render(preferred);
      // No en-US member in this bundle — rule 3: the lowest locale tag.
      const lowest = [...new Set(bundle.map(itemLocale))].sort()[0];
      return lowest === undefined ? null : render(pick(bundle, lowest));
    },
  };
  return loader;
}
