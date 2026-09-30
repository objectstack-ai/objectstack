---
'@objectstack/metadata-protocol': patch
---

metadata-protocol refusals, hints and log lines no longer cite tracker numbers; each states the reason in words

Clause-②: no

Many messages the metadata protocol shows to authors, administrators and operators ended with an
issue-tracker number where the reason belonged. The number goes, and where the sentence did not
already say what was decided, it now does:

- Refusals: `insertManyData` without an engine `insertMany` now names what that method is (the
  partial-success batch insert, so a bad row neither fails the whole batch nor runs the good rows'
  `beforeInsert` hooks twice); the unknown-metadata-type refusal says a plugin cannot declare a type
  because `additionalTypes` was retired, having never been read; the stored non-canonical type
  refusals on publish and revert say the `/meta` URL door now folds a type to its canonical spelling
  before it writes, so such a row predates that.
- The schedule-flow `organization_id` hint says why the author's value is the only source: the engine
  fills only an organization the run resolved, and a schedule resolves none.
- Log lines: the three `kernel:ready` "migration skipped" warnings now say what the migration that did
  not run would have ensured; the history-counter abort says the old path took a failed read for an
  empty table; the publish-closure degrade says the batch's own drafts are left out of the closure;
  the cold-boot org-scoped audit calls the write refusal it points at declared-types-only. The
  overlay, `sys_view_definition` and `sys_setting` index messages, the seed/API tenancy repair and its
  receipt, the batch-row withhold and the object-existence gate's no-registry warning lose only the
  citation, because their sentences already said it.
- The live-MySQL testkit's isolation error loses its citation.

Text only: no error code, field name, status or behaviour changes.
