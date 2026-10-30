---
'@objectstack/types': patch
'@objectstack/service-automation': patch
'@objectstack/service-datasource': patch
---

fix: a plugin-driver datasource refused at boot for its connector instance's credential recovers on the next granted borrow, and the connector call path withholds the form-encoded spelling of a credential

Clause-②: yes (widening)
Metadata-protocol: none

- **`@objectstack/service-datasource`**: a datasource served by a plugin driver (driver-odata) that names `external.connector`, whose instance could not lend at boot (undeclared, disabled, no `auth`), was recorded `failed-credentials` and marked unavailable until a restart, although the driver borrows again on every request and served as soon as the instance was repaired. The first borrow the lender grants for that instance now retracts the verdict and the engine's unavailable mark, so Setup → Datasources shows it available again with no restart. A grant for any other instance leaves it standing. The degraded-boot banner says which recovery applies; with no lender registered the verdict still lasts until a restart.
- **`@objectstack/types`**: `IConnectorCredentialSource` gains an optional `onLent(listener)`, called with the instance's name on every granted borrow and returning the unsubscribe. A source without it keeps working; nothing then retracts such a verdict.
- **`@objectstack/service-automation`**: the connector credential source implements `onLent`. The connector call path's `credentialForms` now takes its list from `borrowedCredentialForms`, so an upstream that echoes an API key in a form-encoded query string (a space written `+`) has that spelling withheld from the degraded reason, the stored status and the logs, as a datasource borrowing the same credential already had.
