---
'@objectstack/spec': patch
---

Clean up two stale code-side doc remnants found during the ADR-0085 docs sweep (#2529):

- `RecordDetailsProps` (ui/component.zod.ts) `layout`/`fields` descriptions taught the
  deprecated `compactLayout` name — now teach the ADR-0085 canonical `highlightFields`
  (`compactLayout` remains a supported alias). Regenerated
  `skills/objectstack-ui/{contracts/react-blocks.contract.json,references/react-blocks.md}`.
- Removed an orphaned JSDoc block in data/object.zod.ts describing `defaultDetailForm`,
  a prop that was never implemented and was removed from the spec in #2402.

Doc-text only; no schema shape or behavior change.
