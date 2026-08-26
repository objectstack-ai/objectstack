// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_oauth_client_resource — Client ↔ protected-resource grant
 *
 * Backed by `@better-auth/oauth-provider`'s `oauthClientResource` model
 * (better-auth ≥ 1.7). Join table allowing a registered client to request
 * tokens for a registered resource (RFC 8707). A missing row means the
 * client is not authorized for that audience.
 *
 * @namespace sys
 */
export const SysOauthClientResource = ObjectSchema.create({
  name: 'sys_oauth_client_resource',
  label: 'OAuth Client Resource',
  pluralLabel: 'OAuth Client Resources',
  icon: 'link',
  isSystem: true,
  managedBy: 'better-auth',
  // ADR-0010 §3.7 — managed by better-auth; tenants may not edit schema,
  // but may add overlay row-level config. Use `no-overlay` if you need to
  // forbid sys_metadata overlays entirely.
  protection: {
    lock: 'full',
    reason: 'Identity table managed by better-auth — see ADR-0010.',
    docsUrl: 'https://objectstack.ai/docs/references/shared/protection',
  },
  description: 'Grants allowing an OAuth client to request tokens for a protected resource',
  highlightFields: ['client_id', 'resource_id'],

  fields: {
    id: Field.text({
      label: 'ID',
      required: true,
      readonly: true,
    }),

    client_id: Field.text({
      label: 'Client ID',
      required: true,
      // [#11374] Bound from the referenced column: this is a foreign key to
      // sys_oauth_application.client_id, which declares maxLength: 255 (and
      // upstream @better-auth/oauth-provider's oauthClient.clientId is a
      // unique string — varchar(255) on MySQL). A referencing column takes the
      // referenced column's bound.
      maxLength: 255,
      description: 'Foreign key to sys_oauth_application.client_id',
    }),

    resource_id: Field.text({
      label: 'Resource ID',
      required: true,
      // [#11701] Narrowed 1024 → 768 so the declared `[resource_id]` index can
      // exist at all. At 1024 the column stays TEXT on MySQL and the index is
      // refused (`ER_BLOB_KEY_WITHOUT_LENGTH`), taking the whole object's
      // schema-sync down with it; 768 characters is the widest utf8mb4 value a
      // MySQL key part can hold (768 × 4 = 3072 bytes, exactly the ceiling).
      //
      // ⚠️ This is the one bound in the family that does NOT simply take its
      // referenced column's width: `sys_oauth_resource.identifier` declares
      // 1024. Narrowing below the referent is safe here because the
      // (768, 1024] band holds nothing the PRODUCING contract can emit. The
      // value is an RFC 8707 resource-indicator URI, and upstream better-auth
      // 1.7.1 — the sole writer of this table (`managedBy: 'better-auth'`) —
      // stores that same identifier in `oauthResource.identifier` as
      // **varchar(255)** on MySQL (`better-auth/dist/db/get-migration.mjs`,
      // `getType`: a unique string column → varchar(255)) and this referring
      // column as varchar(36) (its `field.references` branch). A resource
      // whose identifier exceeded 768 characters could never have been
      // registered upstream in the first place.
      //
      // 768 rather than upstream's 255 on purpose: it is the SMALLEST
      // narrowing that makes the index expressible, so it rejects the least of
      // the referent's declared domain. Guessing a tighter number to make a
      // key fit is what `sys_account.issuer` refuses to do.
      //
      // ⛔ Unlike `sys_verification.value`, this index is NOT removable: this
      // is the FK side of `sys_oauth_resource.identifier` and upstream reads it
      // as a predicate (`findOne({ clientId, resourceId })` on the client
      // registration collision path), so it is a live access path.
      maxLength: 768,
      description: 'Foreign key to sys_oauth_resource.identifier',
    }),

    metadata: Field.textarea({
      label: 'Metadata',
      required: false,
      description: 'JSON object of additional grant metadata',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      defaultValue: 'NOW()',
      readonly: true,
    }),
  },

  indexes: [
    { fields: ['client_id'] },
    { fields: ['resource_id'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: false,
    apiMethods: [],
  },
});
