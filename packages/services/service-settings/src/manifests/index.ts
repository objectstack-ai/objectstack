// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/** Reference manifests bundled with service-settings. */
export { mailSettingsManifest, mailTestActionHandler } from './mail.manifest.js';
export { brandingSettingsManifest } from './branding.manifest.js';
export { featureFlagsSettingsManifest } from './feature-flags.manifest.js';
export { storageSettingsManifest, storageTestActionHandler } from './storage.manifest.js';

import { mailSettingsManifest } from './mail.manifest.js';
import { brandingSettingsManifest } from './branding.manifest.js';
import { featureFlagsSettingsManifest } from './feature-flags.manifest.js';
import { storageSettingsManifest } from './storage.manifest.js';

/** Convenience aggregate — pass to `SettingsServicePlugin({ manifests })`. */
export const builtinSettingsManifests = [
  brandingSettingsManifest,
  mailSettingsManifest,
  storageSettingsManifest,
  featureFlagsSettingsManifest,
];
