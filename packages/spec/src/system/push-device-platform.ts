// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The device platforms a push device registration names: `ios`, `android`
 * and `web`.
 *
 * One list for the two schemas that carry it, the registration body
 * (`RegisterDeviceRequestSchema.platform`, `api/protocol.zod.ts`) and the
 * stored device (`UserDeviceSchema.platform`, `system/push-device.zod.ts`), so
 * a stored device never names a platform its registration would refuse.
 *
 * Internal to the package: no barrel re-exports this module, so it adds no
 * public name. Each schema builds its own `z.enum` from it and describes it.
 */
export const PUSH_DEVICE_PLATFORMS = ['ios', 'android', 'web'] as const;
