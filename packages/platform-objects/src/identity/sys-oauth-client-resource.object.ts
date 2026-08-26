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
      // [#12313] Narrowed 768 -> 255, taking the referent's sourced bound.
      //
      // #11701 chose 768 as the SMALLEST narrowing that made the declared
      // `[resource_id]` index expressible on MySQL at all (768 x 4 = 3072
      // bytes, exactly the utf8mb4 key-part ceiling; at 1024 the column stayed
      // TEXT and the index was refused with `ER_BLOB_KEY_WITHOUT_LENGTH`,
      // taking the object's whole schema-sync down). It deliberately did NOT
      // source that number -- sourcing the referent was a separate ruling.
      // That ruling landed: `sys_oauth_resource.identifier` is now 255, taken
      // from better-auth 1.7.1's own varchar(255) emission, and a referencing
      // column takes the referenced column's bound -- the same derivation
      // `client_id` above uses. 255 is still <= 768, so the index stays
      // expressible and this column keeps the live access path #11701 kept it
      // for (`findOne({ clientId, resourceId })`).
      //
      // What the narrowing REJECTS: values in (255, 768] moved from "the
      // referrer accepts, the referent accepts" to "both refuse". Nothing
      // legitimate lived there -- the sole writer cannot emit an identifier
      // that long (see the referent's citation).
      //
      // ⚠️ Upstream's OWN referring column is narrower still, and is
      // deliberately NOT copied. Measured by running better-auth 1.7.1's
      // migration generator against live MySQL 8.0.46 and reading
      // `information_schema.COLUMNS` as its own query,
      // `oauthClientResource.resourceId` lands as **varchar(191)** -- NOT the
      // varchar(36) that `getType`'s `field.references` arm would suggest.
      // That arm never runs for this column: `resourceId` participates in
      // table-level indexes, so `getType` receives a `tableIndexStringLength`
      // argument, which takes precedence over every `field.*` arm, and
      // `getDatabaseIndexStringLength` seeds its reduce at MySQL's
      // 191-character default and can only shrink from there.
      //
      // 191 is therefore an artifact of upstream's index budget on upstream's
      // own physical schema. ObjectStack emits its own schema and owns its own
      // key budget, so this column inherits the REFERENT's 255 rather than
      // upstream's key-budget rounding -- which is also what keeps the pair
      // symmetric: referent and referrer now accept exactly the same domain,
      // and the silent register-then-never-authorize dead-end is closed.
      maxLength: 255,
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
