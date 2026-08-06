# Client Integration Tests

This directory contains integration tests that verify `@objectstack/client` against a live ObjectStack server.

## Running Tests

### Prerequisites

**Note:** Integration tests require a running ObjectStack server with test data. The server is provided by a separate repository and must be set up independently.

1. **Start a test server (external dependency):**
   ```bash
   # In the ObjectStack server repository (separate from this package)
   # Follow that project's documentation for test server setup
   # Example: cd /path/to/objectstack-server && pnpm dev:test
   ```

2. **Run integration tests (from this package):**
   ```bash
   pnpm test:integration
   ```

### Environment Variables

- `TEST_SERVER_URL` - Base URL of the test server (default: `http://localhost:3000`)
- `TEST_USER_EMAIL` - Test user email (default: `test@example.com`)
- `TEST_USER_PASSWORD` - Test user password (default: `TestPassword123!`)

## Test Structure

Tests are organized by protocol namespace, one file per namespace, numbered in the order
a session goes through them. **What exists today is exactly this:**

```
01-discovery.test.ts          # Discovery & connection
```

That is the whole list. Read it as the list — do not infer a suite from the numbering.

### Not yet written

The namespaces below have no integration coverage yet. This is a topic-level backlog, not
a specification: write each file against the SDK's **current** return shapes
(`packages/client/src/index.ts`) and the server routes the ledgers record, never against a
remembered shape.

- Authentication — login / register / logout / current session (route names come from
  `packages/plugins/plugin-auth/src/auth-route-ledger.ts`; the SDK wraps the session
  payload in `data`, it is not flattened onto the response root)
- Metadata — type listing, item read/write, ETag-conditional reads
- Data CRUD — create / read / update / delete, filtering, pagination
- Data batch — createMany / updateMany / deleteMany and mixed batches
- Data query — ObjectQL AST queries, lookup expansion, aggregation
- Notifications, AI, i18n, analytics, packages, storage, automation, approvals

Namespaces that no longer exist are deliberately absent: `permissions`, `workflow`,
`realtime` and `views` were removed in #3612 because no server surface ever mounted their
routes. Do not add tests for them.

## Related Documentation

- [Client Spec Compliance](../../CLIENT_SPEC_COMPLIANCE.md)
- [Auth route ledger](../../../plugins/plugin-auth/src/auth-route-ledger.ts) — the audited
  auth route table, guarded by a conformance test

> A hand-written `CLIENT_SERVER_INTEGRATION_TESTS.md` "Test Specification" used to sit
> beside this file. It described 13–17 test files of which only `01-discovery.test.ts` was
> ever written, and its assertions had drifted from the SDK's actual return shapes, so it
> read as a finished suite that did not exist. It was retired in #5824; the full text is in
> git history (`git log --diff-filter=D -- packages/client/CLIENT_SERVER_INTEGRATION_TESTS.md`).

## CI/CD

Integration tests can be run in CI, but require:
- A running ObjectStack server instance (from separate repository)
- Test database with sample data
- Proper environment configuration

No CI workflow runs them today. Wiring one up means standing that server up in the job
first; there is no ready-made workflow file to copy.
