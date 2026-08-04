# Evaluation Tests (evals/)

This directory is reserved for future skill evaluation tests.

## Purpose

Evaluation tests (evals) validate that AI assistants correctly understand and apply the rules defined in this skill when generating code or providing guidance.

## Structure

When implemented, evals will follow this structure:

```
evals/
├── routes/
│   ├── test-data-prefix.md          # CRUD routes live under /api/v1/data/{object}
│   ├── test-query-vs-aggregate.md   # aggregation via POST /data/{object}/query, no GET /aggregate
│   └── test-batch-routes.md         # per-object /data/{object}/batch vs cross-object /batch
├── errors/
│   ├── test-dispatcher-envelope.md  # { success: false, error: { code, message, ... } }
│   └── test-data-route-errors.md    # flat { error, code } bodies (CONCURRENT_UPDATE 409, VALIDATION_FAILED 400)
├── endpoints/
│   ├── test-rest-endpoint-shape.md  # RestApiEndpointSchema fields (public/permissions, schema name refs)
│   ├── test-api-endpoint-types.md   # only object_operation/flow execute; script/proxy rejected at publish
│   ├── test-endpoint-path-carveout.md  # /api/v1/apps/<manifest.namespace>/<subpath>, explicit namespace
│   ├── test-auth-required-default.md   # defaults true — omission is safe, explicit false opens anonymous
│   └── test-d6-armed-rate-limit.md     # authRequired:false REQUIRES rateLimit.enabled === true (ADR-0121 D6)
└── ...
```

## Format

Each eval file will contain:
1. **Scenario** — Description of the task
2. **Expected Output** — Correct implementation
3. **Common Mistakes** — Incorrect patterns to avoid
4. **Validation Criteria** — How to score the output

## Status

⚠️ **Not yet implemented** — This is a placeholder for future development.

## Contributing

When adding evals:
1. Each eval should test a single, specific rule or pattern
2. Include both positive (correct) and negative (incorrect) examples
3. Validate expected outputs against the Zod schemas in `node_modules/@objectstack/spec/src/api/`
4. Use realistic scenarios from actual ObjectStack projects
