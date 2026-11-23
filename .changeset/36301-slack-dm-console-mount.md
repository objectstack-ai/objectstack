---
'@objectstack/service-messaging': patch
---

fix(messaging): the approval Slack DM links the Console page under its mount

Clause-②: no
Metadata-protocol: none

The Slack channel made a notification's relative `actionUrl` absolute as the deployment origin plus the path, with no Console mount. A relative `actionUrl` is a Console route (the approval DM's is `/system/approvals?request=ID`), and a server serves the Console under its own mount (`AuthConfig.uiBasePath`, `/_console` by default), so on a default deployment the DM's one link opened a "not found" page.

The DM link now goes under the mount the auth service composes (`getConsoleUrl`), read at send time: `https://host/_console/system/approvals?request=ID` on a default deployment, the custom mount where `uiBasePath` sets one, and no mount where it is `/`. Only the composer's path is used, less any base path it shares with the origin, so a deployment under a sub-path is not prefixed twice; the origin is still the channel's own (`getPublicOrigin`, else `OS_AUTH_URL` / `BETTER_AUTH_URL` / `OS_BASE_URL`). A composition with no auth service, or one whose auth service composes no Console pages, gets the link it got before. An absolute `actionUrl` is sent as it is.

`createSlackChannel` takes a new optional `getConsoleUrl` option, and the package exports `consoleLinkBase` (the origin plus the Console mount a relative `actionUrl` is made absolute under) and the `ConsolePageComposer` type. `MessagingServicePlugin` wires the composer from the `auth` service; a host that builds the channel itself passes it to get the mount.
