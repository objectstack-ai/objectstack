---
'@objectstack/spec': patch
---

Reference pages no longer open with the `@module` marker line. That tag is what
tells the docs generator which doc block describes the module, but it is
machinery for the selector, not prose — and the renderer emitted it verbatim, so
fourteen published pages opened on the literal text `@module ui/sharing` instead
of on their first sentence. `renderFileDescription` now drops the marker at prose
level, exactly as it already drops the `check:skill-examples` opt-in marker, and
as the skill-index extractor has always done. The marker stays in the source and
still selects the block; only `@module` is dropped, because `@example` and
`@category` carry prose a line-drop would take off the page. No schema behavior
changes.
