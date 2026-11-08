# Naming Conventions

ObjectStack enforces strict naming conventions to ensure consistency and machine readability.

## Rules

| Context | Convention | Pattern | Example |
|:--------|:-----------|:--------|:--------|
| Object `name` | `snake_case` | `/^[a-z_][a-z0-9_]*$/` | `project_task` |
| Field keys | `snake_case` | `/^[a-z_][a-z0-9_]*$/` | `first_name`, `due_date` |
| Schema property keys (TS config) | `camelCase` | Standard JS | `maxLength`, `lookupFilters` |
| Option `value` | lowercase machine ID | lowercase | `in_progress` |
| Option `label` | Any case | — | `"In Progress"` |

## Critical Rules

1. **Never** use `camelCase` or `PascalCase` for object names or field keys
2. **Always** use `camelCase` for TypeScript configuration property keys
3. **Option values** must be lowercase machine identifiers (use snake_case for multi-word)
4. **Option labels** can use any case for display purposes
5. **Machine names are immutable** — changing them requires data migration
6. **Labels follow the user's language.** Object, field and option `label`s are
   written in the language the request is in (a Chinese brief gets Chinese
   labels); only machine names stay ASCII `snake_case`. An app built from a
   Chinese brief with English column headers reads as half-translated.
