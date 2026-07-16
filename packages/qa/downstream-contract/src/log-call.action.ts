// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// FROZEN bare-literal fixture — authored WITHOUT the factory, the way a third
// party on an older spec did (#2035). No author-time `.parse()` runs here; only
// the contract test's schema parse validates it. DO NOT migrate this to the
// factory — that would hide the backward-compat break this file exists to catch.
import type { ActionInput } from '@objectstack/spec/ui';

export const LogCallAction: ActionInput = {
  name: 'dc_log_call',
  label: 'Log Call',
  objectName: 'dc_account',
  type: 'script',
  target: 'logCall',
  locations: ['record_header'],
  successMessage: 'Call logged.',
};
