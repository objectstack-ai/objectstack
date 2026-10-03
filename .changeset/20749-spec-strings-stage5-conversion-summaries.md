---
'@objectstack/spec': patch
---

The protocol 17 → 18 conversion summaries no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

A conversion's `summary` is the line an author reads when upgrading metadata: `os migrate meta --json` reports it under `specChanges` (its chain already runs to protocol 18), and it becomes the "Change" column of the upgrade guide's protocol 17 → 18 table and the `to` text of `spec-changes.json`'s `converted[]` records once protocol 18 ships. Thirty-five of the protocol-18 summaries pointed at an issue-tracker number for the reason behind a rewrite. The number goes; where the sentence did not already say what was decided, it now does. For example:

- The six duration-key renames (`hook.timeout` → `timeoutMs`, `apis[].cacheTtl` → `cacheTtlSeconds` and the rest) say the rule they follow: a duration key carries its unit in its name.
- `translation-per-app-settings-removed` says why both application doors lose `settings`: settings copy belongs to the platform, and the bundle entry and the translation item are two doors of one type that accept one shape.
- `flow-decision-mode-inclusive-explicit` says the decision node now follows mainstream engines (first match wins) and that taking every true edge must be declared.
- `list-view-sort-string-clause-to-array` and `page-component-filter-record-to-rule-array` say what "one orthography platform-wide" means for each, and why combinator filters are named rather than flattened.

Text only: no conversion's id, surface, protocol step, transform or order changes, and no schema key, shape or default moves. A tool or test that matches the old summary text (for example a tracker-number suffix) needs the new spelling.
