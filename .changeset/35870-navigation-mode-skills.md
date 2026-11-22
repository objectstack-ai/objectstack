---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

The `objectstack-ui` skill teaches how an object's list opens a record after `navigation.mode` was deprecated there:

- Record-page rule, step 5: on an object's list the record's name opens the full page and the hover icon beside it opens the drawer. `navigation.mode` is deprecated there: `drawer`, `page` and `new_window` change nothing, so the key is omitted; `none` still means rows open nothing (prefer `preventNavigation: true`); a page block's `navigation` still honours every value. The step no longer teaches `navigation: { mode: 'page' }` as the way to open the full page.
- Step 6 no longer lists the Display menu's Open records choice or the drawer's full-width state among the reader's own choices: both were removed.
- The navigation rule's Surface bullet states the same rule in place of "`page` only by declaration".
- Eval `record-page` case 2 ("open contracts as a full page, and beside the list") now expects nothing to be authored: it requires the answer to name the icon and forbids a `mode: 'page'` declaration. The case has a new hash, so `skill-evals --regrade` sets it apart from a round recorded before this change.
