// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// New-factory authoring path (#2035) — an updated consumer.
import { defineAction } from '@objectstack/spec/ui';

export const ArchiveAccountAction = defineAction({
  name: 'dc_archive_account',
  label: 'Archive',
  objectName: 'dc_account',
  type: 'script',
  target: 'archiveAccount',
  locations: ['record_header'],
});
