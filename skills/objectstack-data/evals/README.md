# Evaluation Tests (evals/)

JSON fixtures in the objectui shape (`skill_name`, `evals[]`: `prompt`,
`expected_output`, `assertions.must_contain` / `must_not_contain`):

- `objects-fields-relationships.json` — naming, field types (`secret` vs
  `password`), relationships (junction vs multi-value lookup,
  `deleteBehavior`, on a `user` field too), validation (`state_machine`, unique **index**),
  conditional field rules, the record owner (负责人 is `owner_id`), an
  object extension placing what it brings (`place`), the `.custom` pair's
  whole arrangement (`relatedLists`, `{ list, hidden: true }`).
- `hooks-security-seeds-datasources.json` — search mirrors via hooks,
  permission-set scopes, external datasources, seeds (`externalId`,
  CEL dynamic values).
- `triggers.json` — trigger cases (`should_trigger` in place of
  `assertions`): requests that should load this skill and near misses that
  should not, graded on whether the skill was loaded.
