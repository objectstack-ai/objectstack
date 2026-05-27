// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * ai_conversations — AI Conversation Object
 *
 * Stores conversation metadata for persistent AI conversation management.
 * Messages are stored separately in `ai_messages` to support efficient
 * querying and pagination.
 *
 * @namespace ai
 */
export const AiConversationObject = ObjectSchema.create({
  name: 'ai_conversations',
  label: 'AI Conversation',
  pluralLabel: 'AI Conversations',
  icon: 'message-square',
  isSystem: true,
  description: 'Persistent AI conversation metadata',

  // Enable Notion / Figma-style "anyone with the link" sharing.
  // The platform's plugin-sharing service exposes the share-link UI
  // and REST surface as soon as this flag is set; no further wiring
  // is needed in service-ai. `metadata` is redacted so internal
  // tracking payloads (model token counts, source app context) do not
  // leak into public shares.
  publicSharing: {
    enabled: true,
    allowedAudiences: ['link_only', 'signed_in'],
    allowedPermissions: ['view'],
    maxExpiryDays: 90,
    redactFields: ['metadata'],
  },

  fields: {
    id: Field.text({
      label: 'Conversation ID',
      required: true,
      readonly: true,
    }),

    title: Field.text({
      label: 'Title',
      required: false,
      maxLength: 500,
      description: 'Conversation title or summary',
    }),

    agent_id: Field.text({
      label: 'Agent',
      required: false,
      maxLength: 128,
      description: 'Associated AI agent (metadata name — agents live as JSON in sys_metadata, no lookup table)',
    }),

    user_id: Field.lookup('sys_user', {
      label: 'User',
      required: false,
      description: 'User who owns the conversation',
    }),

    metadata: Field.textarea({
      label: 'Metadata',
      required: false,
      description: 'JSON-serialized conversation metadata',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
    }),
  },

  indexes: [
    { fields: ['user_id'] },
    { fields: ['agent_id'] },
    { fields: ['created_at'] },
  ],

  enable: {
    trackHistory: false,
    searchable: false,
    apiEnabled: true,
    apiMethods: ['get', 'list', 'create', 'update', 'delete'],
    trash: false,
    mru: false,
  },
});
