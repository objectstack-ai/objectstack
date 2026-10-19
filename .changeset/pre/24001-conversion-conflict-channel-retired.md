---
'@objectstack/spec': minor
'@objectstack/service-automation': minor
'@objectstack/metadata-protocol': minor
---

feat(spec)!: the ADR-0078 conversion-conflict channel is retired — `CONVERSION_CONFLICT_CODE`, `ConversionConflictNotice`, `ConversionConflictDetail`, the `onConflict` / `reservedNodeTypes` conversion options, the `conflicts` arrays and the `FLOW_CONVERSION_CONFLICT` 409

Clause-②: yes (narrowing)

**BREAKING (published API):** the ADR-0087 conversion API carried a channel for a rename REFUSED because its old token was a live name in the environment: a conversion reported it through `ConversionContext.reportConflict`, `applyConversions` handed it to an `onConflict` sink as a `ConversionConflictNotice` (code `OS_METADATA_CONVERSION_CONFLICT`), the automation engine collected it in `canonicalizeStoredFlow`'s `conflicts` array, and the metadata protocol answered it with `409 FLOW_CONVERSION_CONFLICT`. Its only producer was the live-executor guard inside the flow-node HTTP callout rename. Protocol 18 reserved those three names (`FLOW_RESERVED_NODE_TYPES`), so the engine refuses an executor under one, no live owner can exist, and the guard went. Nothing can raise a conversion conflict any more, so the channel leaves the published surface rather than staying as a live-looking failure mode nothing triggers.

## FROM → TO

| you wrote | write instead |
| --- | --- |
| `import { CONVERSION_CONFLICT_CODE, type ConversionConflictNotice, type ConversionConflictDetail } from '@objectstack/spec'` | delete the import — no replacement |
| `applyConversions(stack, { onConflict, reservedNodeTypes, … })` (likewise `applyConversionsToFlow`, `applyConversionsToStoredItem`, `collectConversionNotices`) | delete both options; keep `onNotice` / `onTodo` |
| a conversion's `apply` reading `context.reservedNodeTypes` or calling `context.reportConflict` | a rename over an open namespace reserves its old names instead (the `FLOW_RESERVED_NODE_TYPES` pattern), so the refusal happens at registration; a site with no lossless rewrite goes to `context.reportTodo` |
| an `IAutomationService.canonicalizeStoredFlow` implementation returning `conflicts: […]` (or a `StoredFlowCanonicalization` from `@objectstack/metadata-protocol` carrying one) | drop the member; return `parsed`, `storable`, `notices` and optionally `todos` |
| a client branch on `error.code === 'FLOW_CONVERSION_CONFLICT'` / HTTP 409 from a flow save, a package duplication or an unmanaged package import | delete the branch — no request can produce it |

**The one-line fix:** delete every reference; the branch it guarded was already dead, so deleting it changes no behaviour.

**What an upgrader sees.** Importing a removed name is `TS2305`; passing a removed option, or returning a `conflicts` member from a typed canonicalizer, is an excess-property `tsc` error. `ErrorCode` no longer parses `FLOW_CONVERSION_CONFLICT`.

**Runtime behaviour is unchanged.** The removed branches could not fire: a stored flow carrying a reserved callout name still loads as `http` (the rewrite has been unconditional since the names were reserved), and `saveMetaItem`, `duplicatePackage`, `importUnmanagedPackage` and `os migrate meta --stored` answer exactly as before. No metadata document needs editing.

## The retirement kit

- **`@objectstack/spec`:** the three exports leave the root; `ApplyConversionsOptions` loses `onConflict` and `reservedNodeTypes`, `ConversionContext` loses `reservedNodeTypes` and `reportConflict`, the `IAutomationService.canonicalizeStoredFlow` result loses `conflicts`; the error-code ledger drops `FLOW_CONVERSION_CONFLICT` by its own "Retiring a code" rule (a row comes out with its last emitter).
- **`@objectstack/service-automation`:** `AutomationEngine.canonicalizeStoredFlow` no longer returns `conflicts`, and the engine no longer builds a live-name set for the conversion pass.
- **`@objectstack/metadata-protocol`:** `StoredFlowCanonicalization` loses `conflicts`; the flow save door's 409, the stored-migration pass's `failed` row for a refused rename, `duplicatePackage`'s failed item and `importUnmanagedPackage`'s 409 are gone with it.
- **The D3 entry `conversion-conflict-channel-removed`.** No D2 conversion and no tombstone: no metadata document ever carried any of it.
- **No deprecation window**, per the project's startup-stage posture.

⚠️ **The out-of-repo consumer population is NOT MEASURED.** The three packages are published, so this is breaking for consumers no telemetry was consulted for.

<!-- adr-0087: registered conversion-conflict-channel-removed -->
