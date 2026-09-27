# Evaluation Tests (evals/)

Evals check that AI assistants apply this skill's UI rules when generating
view / page / dashboard / report metadata.

## Current evals

- `analytics-inline-vs-dataset.json` — dataset-envelope decisions for
  dashboard/report widgets: when a data need fits a `defineDataset`, when it
  must escalate to a Cube or a stored rollup field, and when an ad-hoc
  in-page `<ObjectChart>` needs no dataset at all.
- `views-apps-actions-pages.json` — `defineView` containers, `App.create`
  navigation, `defineAction` surfaces, record / interface pages, package
  docs, wizard forms.

## Format

Each eval file is a JSON fixture with a list of evals, each carrying:

1. **prompt** — the authoring task given to the assistant
2. **expected_output** — what a correct answer does (and avoids)
3. **assertions** — `must_contain` / `must_not_contain` string checks used to
   score the output

## Contributing

When adding evals:

1. Each eval should test a single, specific rule from SKILL.md
2. Include both positive (correct) and negative (incorrect) patterns
3. Use realistic scenarios from actual ObjectStack projects
