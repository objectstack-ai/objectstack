---
'@objectstack/service-automation': patch
---

feat(service-automation): the automation engine holds a connector instance by its package and name, and a dispatch addresses the one instance its caller's name resolves to (ADR-0150 D4, #31699)

Clause-②: yes (widening) — additive in-process surface only: `AutomationEngine` gains `resolveConnectorInstance`, `resolveConnectorInstanceFor` and `resolveConnectorActionInputSchema`; `registerConnector`, `registerDegradedConnector` and `unregisterConnector` take an optional instance (its package, and `soleOfName`); `resolveConnectorAction`, `resolveConnectorActionEffect`, `getConnectorOrigin`, `getConnectorDegradedReason` and `getConnectorDegradedHold` take an optional package; the barrel exports the types `ConnectorInstanceResolution` and `ConnectorInstanceOptions`. Dispatch answers change in one transitional state (an unstamped entry whose name gains a second holder after boot), as an intended tightening; the phase-1 one-holder refusal keeps a supported install out of that state, since it refuses a second holder at install and at package registration. Three smaller answers move too, each listed under "What answers differently" below: a dispatch that joins a refresh in flight for another connection row is refused 503 once, the store's two-holder refusal names a different remedy, and a re-registered instance moves to the end of the connector list. Every other dispatch, door and HTTP answer is as before: the declared-connector reconcile still keeps one instance per name (the one-holder backstop, its duplicate-name refusal, and `soleOfName` on every declarative registration), and a lookup by bare name answers that one instance.
Metadata-protocol: none
Skills-docs: none — nothing a skill or a docs page teaches changes while one instance per name is kept; the two-holder connector docs come with the PR that narrows the backstop.

Part of #31699 (ADR-0150 child B, PR 3b). PR 3a-ii made the connection store, the connect door and the OAuth callback address an instance by package and name; this PR makes the engine hold and dispatch it so.

**The engine's instances.**

- The registered connectors are held by `(package, name)` (`ConnectorInstances`): a declarative instance by the package the connection door addresses it by (`connectorInstancePackage`: its real stamp; none for the environment's stored entry; the name's durable holder for an unstamped or compatibility-default entry), a plugin's connector by no package.
- A plugin's connector and a declarative instance still never share a name, whatever package the instance is of (ADR-0097 §4). With `soleOfName`, a declarative registration drops any other declarative instance of the name: the reconcile registers every instance so, and keeps one per name, until the backstop narrows.
- A read by bare name answers the one instance of the name, and none when there are two, never one of them. `getRegisteredConnectors` lists each name once; `getConnectorDescriptors` lists every instance.

**Dispatch.**

- `connector_action` resolves its `connectorId` for the calling flow's package (`resolveConnectorInstance`): a refused name is refused as before, naming every candidate; a resolved holder is dispatched to its own instance, and its action's `inputSchema` and `effect` are read from that instance. A caller with no package, a name no registry holds, or a resolved holder with no instance registered under it (a plugin's connector of a declared name) is answered by the one instance of the name, as the dispatch by name answered; two are not dispatched. `connectorNameRefusal` answers as before.
- The OAuth2 grant handle asks its instance's package on every read of the connection store, so an unstamped entry's connections are read under the package its name resolves to now, not when the handle was made. A cached access token is served only for the connection row it was obtained for (its row id, beside its revision): a read that now chooses another row (another package's connection of the organization) refreshes, never serves the other row's token.

**The reconcile.**

- The instance package is part of a provider-bound entry's desired signature, so an unstamped entry whose name's holder changes (installed, uninstalled, a second holder) is registered again under the package it resolves to now, on the next reconcile. The engine's instance and the connection the grant handle reads stay one package.
- An instance the reconcile drops (no longer declared, degraded and removed) is unregistered by name, every instance of it: the reconcile keeps one per name, whatever package it was registered under.
- Limit: the boot's second reconcile (packages registered during the boot) is skipped when the declared list's fingerprint is unchanged, and the fingerprint carries no package, so a holder that changes in that window without the declared list changing is followed on the next reload or restart.

**What answers differently.**

- An unstamped (or compatibility-default) declared entry whose name gains a second durable holder: its dispatch was answered with the connection of the package that held the name at boot (200) until a restart. It is now read under the package the name resolves to at that moment, which is no one package, so it is refused 503 (no connection of its own): under two holders a row is its own package's only (PR 3a-ii's store rule), as the connection door already refuses that name (409). It is recovered by stamping the entry or by uninstalling the second holder. A holder that is uninstalled or replaced, leaving one holder, changes no answer: every row of the name still answers the one instance, and the next reconcile registers the instance again under the package it resolves to now (any provider-bound instance is re-materialized on such a change). A re-materialized OAuth2 instance starts with a new grant handle whose access-token cache is empty, so a connection with no refresh token reads `reconnect_required` at its next dispatch, as after a restart.
- A dispatch that joins an access-token refresh already in flight for another connection row of the organization (the instance's package changed while the refresh was out) is refused 503, never served that row's token; the next dispatch refreshes its own row.
- The store's refusal of a row of a two-holder name that names none of the holders now names the remedy that works for it: `os migrate stored-references bind` for a row naming no package, and uninstalling one of the holders for a row already naming another package, which the bind refuses (PR 3a-ii contract review N4).
- On a change of holder, the instance is re-registered, so its name moves to the end of `getRegisteredConnectors()` and `GET /automation/connectors`.

**Not in this PR (moved to the PR that narrows the backstop).**

- The materializer's own bookkeeping (`desired`, the materialized, degraded and credential-refusal maps, `grantHandles`, retry and dematerialize) stays keyed by name: under the backstop the reconcile cannot hold two instances of one name, so re-keying it is observable only once the duplicate-name refusal is lifted, and lands with it and with a two-live-instance test. Its registrations and unregistrations already pass the instance package.
- The connector pull keeps reading its connector by bare name (the one instance): whether a mapping's connector is resolved for the job's package, and refused where that name is refused, changes an answer and is decided with the narrowing.
- The resolved-holder fallback above (a resolved holder with no registered instance answered by the one instance of the name) is right only while one instance per name is kept; with two instances alive the narrowing PR makes it `none`.
- `ConnectorDescriptor.packageId`, the addressed connection door (`?package=`), connector into the namespace-scoped type sets, and the backstop itself.
- `registerConnector(def, handlers, 'declarative', { packageId })` without `soleOfName` is public and keeps two instances of one name side by side (the engine tests use it). So does `registerConnector(def, handlers, 'declarative')` with no instance argument over a name the reconcile holds under a package: it is registered under no package beside that instance instead of replacing it, and a bare-name read answers neither until the next reconcile. Nothing in-tree registers either way outside the tests; the reconcile always passes the instance with `soleOfName`.

**In-process APIs.** Listed under Clause-② above. All additive; every new parameter is optional and its absence answers as before, except the declarative registration with no instance argument named in the list above.
