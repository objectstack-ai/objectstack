// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Is this app a CODE-LOADED platform built-in (`com.objectstack.setup` /
 * `account`, Studio, …) rather than an app somebody put into the environment (a
 * user- or AI-authored package, or one installed from the marketplace)?
 *
 * Discriminator: the platform reserves the `com.objectstack.*` package
 * namespace for its code-delivered apps; DB-created packages (including every
 * AI-built one, e.g. `app.xadv`) use other ids. This is the only field that
 * reliably distinguishes them on the `/meta/app` LIST response: `_packageId` is
 * grafted onto every list item, whereas `managedBy` / `source` are sys_metadata
 * ROW columns the LIST handler does NOT copy onto the item body, and the
 * resolved `lock` / `editable` envelope exists only on single-GET.
 *
 * Readers, one criterion so they cannot drift:
 *
 * - ADR-0057 Amendment A1.b: the AI chat's package switcher lists only
 *   authorable packages, so a built-in, which the build agent can't edit, never
 *   appears as a switch target (`AiChatPage`, `ChatDockConversation`).
 * - The console's first-run checklist: "Put your first app in" is done once
 *   the launcher lists an app that is not a built-in (objectstack#34251).
 */
const PLATFORM_PACKAGE_PREFIX = 'com.objectstack.';

export function isPlatformBuiltinApp(app: { _packageId?: unknown }): boolean {
  return typeof app._packageId === 'string' && app._packageId.startsWith(PLATFORM_PACKAGE_PREFIX);
}
