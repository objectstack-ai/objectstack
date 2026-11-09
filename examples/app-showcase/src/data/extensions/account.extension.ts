// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineObjectExtension } from '@objectstack/spec/data';

/**
 * Object extension (overlay) demo — additive fields merged into
 * `showcase_account` at registration time WITHOUT re-declaring the object.
 * The ObjectQL engine merges extension fields into the target during
 * `registerApp` (higher `priority` wins on conflict), so these fields show
 * up on the Account form/list exactly as if they were authored inline —
 * the mechanism packages use to extend objects they don't own.
 */
export const AccountExtension = defineObjectExtension({
  extend: 'showcase_account',
  label: 'Account (Success Overlay)',
  // The plural travels with the label: an extension that renames an object
  // without one is served with no plural at all (the base's `Accounts` names
  // the old label), so the list title would fall back to the singular.
  pluralLabel: 'Accounts (Success Overlay)',
  fields: {
    loyalty_tier: {
      name: 'loyalty_tier',
      label: 'Loyalty Tier',
      type: 'select',
      options: [
        { value: 'bronze', label: 'Bronze' },
        { value: 'silver', label: 'Silver' },
        { value: 'gold', label: 'Gold' },
        { value: 'platinum', label: 'Platinum' },
      ],
    },
    linkedin_url: {
      name: 'linkedin_url',
      label: 'LinkedIn URL',
      type: 'url',
    },
    csat_score: {
      name: 'csat_score',
      label: 'CSAT Score',
      type: 'number',
      min: 0,
      max: 100,
    },
  },
  priority: 210,
});

export const allObjectExtensions = [AccountExtension];
