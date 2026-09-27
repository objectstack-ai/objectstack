# Evaluation Tests (evals/)

JSON fixtures in the objectui shape (`skill_name`, `evals[]`: `prompt`,
`expected_output`, `assertions.must_contain` / `must_not_contain`):

- `objects-fields-relationships.json` — naming, field types (`secret` vs
  `password`), relationships (junction vs multi-value lookup,
  `deleteBehavior`), validation (`state_machine`, unique **index**),
  conditional field rules.
- `hooks-security-seeds-datasources.json` — search mirrors via hooks,
  permission-set scopes, external datasources, seeds (`externalId`,
  CEL dynamic values).
