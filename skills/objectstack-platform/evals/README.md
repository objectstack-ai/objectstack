# Evaluation Tests (evals/)

This directory is reserved for future skill evaluation tests.

## Purpose

Evaluation tests (evals) validate that AI assistants correctly understand and apply the rules defined in this skill when generating code or providing guidance.

## Structure

When implemented, evals will follow this structure:

```
evals/
├── bootstrap/
│   ├── test-definestack-keys.md        # no phantom keys (driver:, workflows:, approvals:)
│   ├── test-manifest-required-fields.md
│   └── test-template-selection.md      # blank is the whole catalog; the five remote templates are retired
├── drivers-adapters/
│   ├── test-driver-selection.md        # memory / sql / mongodb / sqlite-wasm; turso = cloud/EE
│   └── test-hono-integration.md        # @objectstack/hono vs plugin-hono-server; no adapter-*
├── plugins/
│   ├── test-lifecycle-phases.md        # init/start/destroy, dependency order
│   ├── test-service-registry.md        # registerService throws on duplicate; no null placeholders
│   └── test-kernel-events.md           # kernel:ready/bootstrapped/listening/shutdown; NO data:* events
└── ops/
    ├── test-cli-commands.md            # real command surface (no os studio / os data seed / os meta apply)
    └── test-litekernel-testing.md      # new LiteKernel().use(...) pattern; kernel.context is protected
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
3. Reference the corresponding rule file in `rules/`
4. Use realistic scenarios from actual ObjectStack projects
