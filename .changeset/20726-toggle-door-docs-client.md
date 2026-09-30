---
'@objectstack/client': patch
---

docs(client): `automation.toggle` says it switches packaged flows only, and names a customer flow's switch (#20726)

`client.automation.toggle` had no docblock of its own: its one line had drifted above an unrelated member. It now says that it switches packaged flows only, and that a flow authored in the deployment is refused with 409 `RESOURCE_CONFLICT`. Such a flow's switch is its `status`, sent with the complete definition through `automation.update`. This is prose only: the method's signature and behaviour are unchanged.
