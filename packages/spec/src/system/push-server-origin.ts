// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The server origin a push names: the origin the Console was loaded from
 * (`window.location.origin`), which is the address the mobile shell saved
 * for that server. A shell with several saved servers reads it on tap to open
 * the push on the server that sent it.
 *
 * One rule for the three schemas that carry it, so a value the registration
 * accepts is one the device row stores and the push data carries:
 *
 * - the registration body (`RegisterDeviceRequestSchema.origin`,
 *   `api/protocol.zod.ts`): the Console writes it when it registers the
 *   device;
 * - the stored device (`UserDeviceSchema.origin`,
 *   `system/push-device.zod.ts`): the device registry keeps the
 *   registration's value on the row;
 * - the push data (`PushDeliveryDataSchema.origin`,
 *   `api/push-delivery.zod.ts`): the push channel copies it from the device
 *   the push goes to, and the shell picks the saved server by it.
 *
 * The shape is a serialized URL origin, exactly what `window.location.origin`
 * answers: `http` or `https`, `://`, a lowercase host (a DNS name, a dotted
 * IPv4 address, which the DNS-name arm admits, or a bracketed IPv6 address)
 * and an optional port. Nothing else: no path (not even a trailing `/`), no
 * query, fragment or user info. Because the value is that canonical form, the
 * shell can compare it with a saved server's origin byte for byte. A path,
 * another scheme or a bare host is refused, with the same message in all three
 * schemas. The rule is a pattern, so the published JSON Schema carries it too.
 *
 * Where the pattern is narrower or looser than a URL origin, knowingly:
 *
 * - **Narrower: DNS-hostname labels.** A label is letters, digits and inner
 *   hyphens, so an origin `window.location.origin` can answer is still refused
 *   when its host has an underscore (`http://my_svc:3000`, a container or
 *   compose service name) or ends in a dot (a fully qualified
 *   `https://crm.example.com.`). A registration naming one is refused as a
 *   whole, like any refused member, so the producer leaves `origin` out for
 *   such a host; that device's pushes then carry no origin.
 * - **Looser: the port and the IPv6 arm.** The port is one to five digits, so
 *   a default port written out (`:443` on https, `:80` on http), a leading
 *   zero or a number past 65535 is admitted, none of which
 *   `window.location.origin` ever answers; the bracketed arm admits any run of
 *   hex digits, colons and dots, `[:::]` included. Nothing here canonicalises
 *   or range-checks either. The bound is the producer: the Console is the one
 *   writer, and it sends `window.location.origin` as the browser serialised
 *   it, which is already canonical. A value no browser produces equals no
 *   saved server's origin byte for byte, so it can never name the wrong one.
 *
 * Internal to the package: no barrel re-exports this module, so it adds no
 * public name. Each schema builds its own `z.string().regex(...)` from it and
 * describes it.
 */
export const PUSH_SERVER_ORIGIN_PATTERN =
  /^https?:\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::[0-9]{1,5})?$/;

/** The one refusal message the three `origin` members answer. */
export const PUSH_SERVER_ORIGIN_MESSAGE =
  'A push server origin is the origin the Console was loaded from: http:// or https://, a lowercase host and an '
  + 'optional port, with no path, query or fragment (for example https://crm.example.com or http://localhost:3000).';
