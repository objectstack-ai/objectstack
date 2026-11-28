---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol): publishing an object draft judges it by the current ObjectSchema

Clause-②: no
Metadata-protocol: none

A save checks an object body against the current `ObjectSchema` and refuses it with `422 INVALID_METADATA`. Publishing a draft did not repeat that check. So an object draft saved before a stricter `ObjectSchema` rule landed went live at publish, even though that rule refuses it. One example is a sealed object with no `tenant_id` chain column (ADR-0154 D10).

Both publishes, per item and per package (including the pass that judges a batch before it writes on a store that cannot roll back), now check the draft the same way a save does. They refuse it with the same `422 INVALID_METADATA` and the same `issues[]`, before anything is written. The draft is checked as the publish would serve it, after the stored-row conversions are applied. So a draft stored in a spelling a later release retired, which those conversions rewrite, still publishes as before.

A refused draft stays a draft. To publish it, fix the keys the issues name and save it again, the same fix a save of that body asks for. Every body this refuses is one a save of the same body already refuses.
