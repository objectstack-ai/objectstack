// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Messaging route ledger — the audited disposition of every HTTP route
 * `registerPreferenceOptionsRoutes` (`preference-options-routes.ts`),
 * `registerMyPreferencesRoutes` (`my-preferences-routes.ts`),
 * `registerInAppMessageRoutes` (`in-app-message-routes.ts`) and
 * `registerSlackLinkRoutes` (`slack-link-routes.ts`) mount.
 *
 * WHY THIS EXISTS. `MessagingServicePlugin` reaches for the `http-server`
 * service and registers straight on `IHttpServer`, so neither the dispatcher
 * ledger nor the REST ledger sees its route, the same shape as the storage,
 * settings and print families. `messaging-route-ledger.conformance.test.ts`
 * fails when the registrar mounts a route with no row here, and when a row
 * names a route it no longer mounts; the dogfood live-mount parity gate reads
 * this ledger beside the others on a real boot. The inbox routes
 * (`/api/v1/notifications*`) are not here: the runtime dispatcher serves them,
 * and they are rows of its own ledger.
 *
 * NOT SDK SURFACE. `@objectstack/client` expresses no method for any: the
 * consumers are the console's notification preference and template forms, the
 * Account app's Notification Settings page (and its Slack link), the Setup
 * screen of the organization's Slack install, and
 * the Setup action "Send in-app message" (a same-origin `type: 'api'` action,
 * which the action doors also forward for an agent), over plain HTTP. That is
 * a `server-only` disposition.
 *
 * This module is package-internal (not exported from the index): it is the
 * guard's data, not public API. It stays import-free, so a guard in another
 * package can read it as a relative SOURCE file.
 */

/** Disposition of a single messaging route. Same vocabulary as the REST ledger. */
export type MessagingRouteDisposition =
    /** Expressed by the SDK — `client` names the method (dotted path). */
    | 'sdk'
    /** Should be in the SDK and is not — an open, acknowledged gap. */
    | 'gap'
    /** Deliberately not SDK surface. */
    | 'server-only'
    /** Public, unauthenticated browser-facing route. */
    | 'public'
    /** Server and client disagree on the shape — needs reconciliation. */
    | 'mismatch';

export interface MessagingRouteLedgerEntry {
    /** `VERB /api/v1/messaging/...` — the full wire path. */
    route: string;
    /** Registrar family, for grouping and diff messages. */
    family: string;
    disposition: MessagingRouteDisposition;
    /** Dotted method path on `ObjectStackClient` — required when disposition is `sdk`. */
    client?: string;
    /** One-line rationale. Required for every non-`sdk` disposition. */
    note?: string;
}

export const MESSAGING_ROUTE_LEDGER: readonly MessagingRouteLedgerEntry[] = [
    { route: 'GET /api/v1/messaging/preference-options', family: 'messaging', disposition: 'server-only',
        note: 'the topics and channels a notification preference or template can name, for the console\'s pick-or-type inputs; any signed-in member, read-only' },
    { route: 'GET /api/v1/messaging/me/preferences', family: 'messaging', disposition: 'server-only',
        note: 'the signed-in person\'s own effective notification preferences (topic x channel, digest, quiet hours, each with its source), for the Account app\'s Notification Settings page; any signed-in person, about themselves only, read-only' },
    { route: 'POST /api/v1/messaging/in-app-messages', family: 'messaging', disposition: 'server-only',
        note: 'an organization administrator\'s in-app message to everyone in, or picked members of, their current organization; the target of the Setup action send_in_app_message on sys_notification' },
    // [#34730 step 2] The Slack link doors: the person about themselves, then
    // the organization administrator (`setup.write` in the current organization).
    { route: 'GET /api/v1/messaging/me/slack-link', family: 'messaging', disposition: 'server-only',
        note: 'the signed-in person\'s Slack link in their current organization, and the install\'s workspace, for the Account app\'s Notification Settings page; about themselves only' },
    { route: 'POST /api/v1/messaging/me/slack-link/proposal', family: 'messaging', disposition: 'server-only',
        note: 'propose a Slack link by the person\'s own email (Slack users.lookupByEmail); the proposal delivers nothing until confirmed' },
    { route: 'POST /api/v1/messaging/me/slack-link/confirm', family: 'messaging', disposition: 'server-only',
        note: 'the person confirms their own proposed Slack link; from then on notifications may reach them by Slack DM' },
    { route: 'DELETE /api/v1/messaging/me/slack-link', family: 'messaging', disposition: 'server-only',
        note: 'the person removes their own Slack link' },
    { route: 'GET /api/v1/messaging/slack/account', family: 'messaging', disposition: 'server-only',
        note: 'an organization administrator reads their organization\'s Slack install (never its token)' },
    { route: 'PUT /api/v1/messaging/slack/account', family: 'messaging', disposition: 'server-only',
        note: 'an organization administrator installs Slack or sets its bot token again; Slack proves the token before it is stored, encrypted' },
    { route: 'DELETE /api/v1/messaging/slack/account', family: 'messaging', disposition: 'server-only',
        note: 'an organization administrator removes the Slack install and every link to it; each linked person is told' },
    { route: 'GET /api/v1/messaging/slack/links', family: 'messaging', disposition: 'server-only',
        note: 'an organization administrator lists every Slack link in their organization' },
    { route: 'DELETE /api/v1/messaging/slack/links/:id', family: 'messaging', disposition: 'server-only',
        note: 'an organization administrator removes one person\'s Slack link; the person is told by inbox and email' },
];
