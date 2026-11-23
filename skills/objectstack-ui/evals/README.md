# Evaluation Tests (evals/)

Evals check that AI assistants apply this skill's UI rules when generating
view / page / dashboard / report metadata.

## Current evals

- `analytics-inline-vs-dataset.json` — dataset-envelope decisions for
  dashboard/report widgets: when a data need fits a `defineDataset`, when it
  must escalate to a stored field or app code, when an ad-hoc
  in-page `<ObjectChart>` needs no dataset at all, and a dataset authored
  for a Chinese brief, whose members carry Chinese `synonyms` and a
  one-sentence `description`.
- `record-page.json` — the record page as the object declares it: a tab
  put first, and the attachments tab removed, by the parent's `relatedLists`
  naming every tab it keeps (no page file); a field placed in its group's
  own `fields`; a child table placed between field sections by a group's
  `relatedList`; an object's list opening a record one way, with the
  deprecated `navigation.mode` left unauthored; and `placedActions: true`
  on a full page's `page:header` so packaged header actions draw without an
  id list.
- `report-period-export.json` — a non-`joined` report's `dateRange` (one
  `type: 'date'` dataset dimension) and `exportOptions` (csv / xlsx under the
  base object's `allowExport` permission).
- `views-apps-actions-pages.json` — `defineView` containers, `App.create`
  navigation, `defineAction` surfaces, record / interface pages, package
  docs, the New and Edit form built from the object (field groups,
  `showOnCreate`, line items), a view added beside the list (and the empty
  board over a field added with it), a write button whose body writes, the
  view kind the request names.
- `triggers.json` — trigger cases: requests that should load this skill
  (`should_trigger: true`) and near misses that should not (`false`), graded
  on whether the skill was loaded, never on the answer.

## Format

Each eval file is a JSON fixture with a list of evals, each carrying:

1. **prompt** — the authoring task given to the assistant
2. **expected_output** — what a correct answer does (and avoids)
3. **assertions** — `must_contain` / `must_not_contain` string checks used to
   score the output
4. **files** — paths under `evals/files/` a case needs on disk (empty when
   the prompt states its context)

A trigger case carries `should_trigger` in place of `expected_output` and
`assertions`.

## Contributing

When adding evals:

1. Each eval should test a single, specific rule from SKILL.md
2. Include both positive (correct) and negative (incorrect) patterns
3. Use realistic scenarios from actual ObjectStack projects
