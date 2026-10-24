/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export * from './DndProtocol.js';
export * from './KeyboardProtocol.js';
// `NotificationProtocol` removed in the 17.0.0-rc.2 uptake: it bridged
// `@objectstack/spec/ui`'s `Notification` / `NotificationConfig`, which
// objectstack#4610 deleted with no successor. The bridge had zero consumers in
// this repo — the live notification config resolution is
// `resolveNotificationConfig` in `@object-ui/react`'s `NotificationContext`,
// which declares its own `NotificationSystemConfig` and is what every surface
// reads. Re-typing the bridge would have meant re-declaring a vocabulary the
// spec had just retired (AGENTS.md #0.1).
// `ResponsiveProtocol` removed in the objectstack#11027 uptake (objectui#7580):
// it bridged `@objectstack/spec/ui`'s `ResponsiveConfig`, which that retirement
// deleted with no successor, and it had zero importers in this repo (measured on
// objectui#4773; `docs/audits/2901-spec-enum-renderer-coverage.md` had already
// recorded it as one of the zero-importer protocols). Re-typing the bridge would
// have meant re-declaring a vocabulary the spec had just retired, for a reader
// that does not exist — AGENTS.md #0.1, and the same disposition
// `NotificationProtocol` got above. The layout vocabulary that DOES have a
// renderer is re-homed instead, in `@object-ui/types` and `@object-ui/layout`.
export * from './SharingProtocol.js';
