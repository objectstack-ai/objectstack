---
'@objectstack/objectql': patch
---

fix(objectql): on a kernel with an `environmentId` (`os dev`, `os serve`, `os start`, the cloud single-environment runtime), a runtime-authored object now has a metadata-service copy, so both MCP doors refuse an object whose API exposure is off

Clause-②: no

On a kernel built with an `environmentId`, the `metadata` service is sourced from the artifact and the boot bridge does not run. Until now, the copy follow that keeps a runtime-authored object's copy current also returned early on that shape. So the service held **no** copy of **any** object saved through Studio, the REST metadata door or an AI author, and the MCP exposure gates read that absence as "no declaration". Measured on the real `os dev` (`env_local`), where the REST data door refused the same objects with `OBJECT_API_DISABLED`:

- **Saved with `apiEnabled: false`, or turned off after a save.** The HTTP MCP door served `query_records` and `create_record`, and the create wrote a row. The MCP stdio door did the same.
- **Saved with `apiEnabled: false`, then a restart.** Still served: the hydrated object had no copy, and no save fired after boot.
- **Exposed objects.** `list_objects` did not name them, and `describe_object` answered "not found".

The fix is at the copy's producer, and it bounds what is written the same way the no-`environmentId` shape already does:

- **The copy follow runs on every kernel shape.** A save refreshes the copy before it returns, through `registerInMemory` (in memory, no persistence, no announce). A delete removes it once the stored row is gone and the registry no longer serves the name.
- **A kernel that hydrates its own `sys_metadata` (`hydrateMetadataFromDb`) copies its hydrated runtime-authored objects once at boot.** That option is set only on a kernel whose registry is its own. Only objects whose registry owner row is tenant-authored are copied, so a code package's objects still reach the service from the artifact alone. The full boot bridge stays off on this shape.
- **A boot copy that cannot land is logged at `error`.** The line names the objects, the consequence (the MCP exposure gates serve them even when their exposure is off) and the way out.

Both exposure gates read this service: the MCP stdio door's `enforceApiExposure`, and `refuseUnexposedDataAction`, which the HTTP MCP data verbs run through. Both now answer `OBJECT_API_DISABLED` / 404 for such an object, which is what `apiEnabled: false` declares. Neither gate's fall-open rule for an absent definition changes. The kernel shape without an `environmentId` is unchanged.
