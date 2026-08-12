// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7730 / #7774] i18n bundles — metadata types whose IDENTITY is a pair.
 *
 * Most metadata types are identified by `name` alone. `email_template`
 * declares otherwise: `EmailTemplateDefinitionSchema` states that "multiple
 * rows with the same `name` but different `locale` form an i18n bundle; the
 * service picks the best match for the recipient's locale, falling back to
 * `en-US`" (`packages/spec/src/system/email-template.zod.ts`), and its header
 * says a template "is resolved by `(name, locale)`".
 *
 * Every layer that keys metadata by `name` therefore has to agree on ONE
 * answer to "what else is part of this type's identity?", or a bundle survives
 * one layer and collapses at the next:
 *
 *  - `@objectstack/objectql`'s `SchemaRegistry` keys its item collections
 *    (`registerItem` / `getItem` / `listItems`) — fixed by #7730;
 *  - `@objectstack/metadata-protocol`'s unscoped `/meta/<type>` list merge
 *    keys the sys_metadata overlay and MetadataService merges (`metaItemKey`,
 *    `mergePackageAwareOverlay`) — fixed by #7774, which is why the table
 *    lives HERE rather than in the registry that first needed it.
 *
 * `@objectstack/objectql` depends on `@objectstack/metadata-protocol`, so the
 * protocol package cannot import the table from the registry — the reverse
 * import would close a cycle turbo rejects. This package is the one both sides
 * already depend on and it depends on neither, the same criterion that sank
 * the engine write-verb dispatch predicates (#5619), the audit-field
 * governance table (#4513) and the injected-system-column definitions (#6562)
 * here. `objectql` re-exports `ITEM_KEY_DISCRIMINATORS` from `registry.ts`, so
 * its public surface is unchanged.
 *
 * What deliberately did NOT move: the registry's storage-key FORMAT
 * (`BUNDLE_KEY_SEPARATOR`, `withDiscriminator`, `bundleBaseKey`,
 * `collectBundle`). Those encode a discriminator into the registry's own
 * `<packageId>:<name>` Map keys and parse it back out again; the protocol
 * layer builds its own NUL-separated merge key and never parses a registry
 * key, so it needs the IDENTITY question answered — the table and
 * {@link itemDiscriminator} — not the encoding. Moving the encoding too would
 * have published a registry-internal key format as a cross-package contract.
 */

/**
 * Metadata types whose identity is `(name, <discriminator field>)`.
 *
 * The discriminator is declared PER TYPE rather than duck-typed off a `locale`
 * property, because the key computation is generic to every registered
 * metadata type: reading whatever `item.locale` happened to be set would
 * silently re-key any other type that grows a locale-ish field, which is a much
 * larger contract change than the one this table makes. `email_template` is the
 * only type whose schema declares a top-level `locale` that is part of its
 * identity.
 *
 * `canonical` is the bundle member a bare-name read resolves to, and the value
 * a member that declares no discriminator is keyed as. It mirrors the schema's
 * own `locale` default and `sendTemplate`'s documented fallback;
 * `registry-i18n-bundle-key.test.ts` (objectql) pins the two together so this
 * copy cannot drift from the spec.
 */
export const ITEM_KEY_DISCRIMINATORS: Readonly<Record<string, { field: string; canonical: string }>> = {
  email_template: { field: 'locale', canonical: 'en-US' },
};

/**
 * The discriminator value an item declares, trimmed; `''` when it declares
 * none. `content[field]` is consulted too, because a stored metadata body may
 * carry the definition nested under `content`.
 */
export function readDiscriminatorValue(item: unknown, field: string): string {
  const holder = item as Record<string, any> | null | undefined;
  const raw = holder?.[field] ?? holder?.content?.[field];
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * The canonical-normalized discriminator of `item` under `type`, or
 * `undefined` when `type` declares none.
 *
 * `undefined` is the load-bearing return: every caller appends this to a key
 * ONLY when it is defined, so an undiscriminated type's key stays
 * byte-identical to what it was before this table existed. A discriminated
 * item that declares no value is keyed as the `canonical` member — the same
 * row a bare-name read resolves to — so the bundle-blind and bundle-aware
 * answers agree for a single-member "bundle".
 *
 * @param type Singular metadata type name (`'email_template'`, not the plural).
 */
export function itemDiscriminator(type: string, item: unknown): string | undefined {
  const disc = ITEM_KEY_DISCRIMINATORS[type];
  if (!disc) return undefined;
  return readDiscriminatorValue(item, disc.field) || disc.canonical;
}
