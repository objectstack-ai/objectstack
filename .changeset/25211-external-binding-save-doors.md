---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: the metadata save doors and `composeStacks` refuse an object's `external` binding on a named managed datasource, from either side of the pair

Clause-②: yes (narrowing)

Metadata-protocol: narrowed

<!-- adr-0087: not-required (already-registered object-external-binding-managed-datasource-refused) registered by #25168 before this change, amended in this diff: its surface, replacement and reason now name composeStacks and the two metadata save doors -->

**BREAKING** (what the metadata API stores narrows), shipped as `minor` under the 18.x convention for breaking changes.

ADR-0015 §4.2 allows `object.external` only on a datasource whose `schemaMode` is not `'managed'` (an absent `schemaMode` is `'managed'` by the spec default). #25168 enforced the halves a parse and a single stack can see. A binding on a datasource stored or registered at runtime, or declared by another input of a composition, still got no verdict: the save door stored an `external` object on a managed datasource, stored a datasource re-saved as managed under objects bound to it with `external`, and `composeStacks` accepted the pair split across two inputs. The runtime then disagrees with itself about the object: its schema sync skips the table as federated while the boot validation and the write gate judge it as managed.

- **FROM:** `PUT /api/v1/meta/object/NAME` stored an object with `external` and a `datasource` naming a stored or registered datasource declared `schemaMode: 'managed'` or with no `schemaMode`, in draft and publish mode and under `force`. `PUT /api/v1/meta/datasource/NAME` stored a datasource as managed (or with no `schemaMode`) while stored or registered objects bound it with `external`. `composeStacks` accepted an `external` object of one input bound to a managed datasource another input declares.
- **TO:**
  - The object save door refuses the object with `422 INVALID_METADATA`, the finding at `external`, nothing stored. The datasource it judges against is the one the door's own by-name read serves: the environment's stored row, else the definition the code layer registers.
  - The datasource save door refuses the datasource with `422 INVALID_METADATA`, one finding per bound object at `schemaMode`, the stored row unchanged. The objects it judges are the environment's active object rows and the registered objects no stored row overlays. An object's draft binds nothing until it is published.
  - Both are judged in draft and publish mode, and again when a draft is published (`publishMetaItem` and each item of a package publish), against the other half as it stands then. `force` does not skip them.
  - `composeStacks` refuses the cross-input pair with `STACK_CROSS_REFERENCE_INVALID` (422), in either input order and under every `manifest` strategy, `preserve` included. An input built with `strict: false` that holds the pair itself is refused here too, as with the artifact pass's other rules.
  - Every finding is the spec predicate's, so it reads as the parse's and `defineStack`'s do: "Object 'OBJECT' declares `external` on datasource 'NAME', whose `schemaMode` is 'managed' …".
- **Unchanged:** the rule itself. A binding on a datasource declared `schemaMode: 'external'` or `'validate-only'` is accepted on every door. A datasource no layer holds gets no verdict: the absence of a definition is no evidence about its `schemaMode`. The datasource-admin service's update (`PATCH /api/v1/datasources/NAME`) does not pass through the metadata save door and is not judged by this change. Rows already stored in the refused shape still load as before; a save of either side that leaves the pair inconsistent is refused, so the next object save waits until the datasource is external or the object drops `external`.
- **The fix for an author:** keep the pair consistent, in this order. To federate, save the datasource with `schemaMode: 'external'` (or `'validate-only'`) and its `external` settings first, then bind objects to it. To make a datasource managed, remove `external` from the objects that bind it first, then save the datasource.

This narrows the **Unchanged** bullet of the #25168 changeset, which said a binding on a datasource "registered by the host or another package, or stored at runtime" gets no verdict at the load doors: the metadata save doors now judge it, and `composeStacks` judges one another input declares.

`@objectstack/spec/data`: exports `externalBindingDatasourceRefusal` and its result type `ExternalBindingDatasourceRefusal`, the one predicate behind the rule, so a runtime door resolves the datasource it can see and asks it rather than copying the judgement. Its behaviour is unchanged.
