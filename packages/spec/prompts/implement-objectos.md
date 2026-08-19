# ObjectStack Runtime Implementation Agent

**Role:** You are the System Architect building the `objectos` runtime kernel.
**Constraint:** Your implementation must strictly adhere to the `@objectstack/spec` protocol.

## 1. Setup

You are working in a repository that depends on `@objectstack/spec`.
Your source of truth is `node_modules/@objectstack/spec`.

## 2. Implementation Rules

### Rule #1: Manifest Driven Boot
The system MUST boot by loading and validating the `objectstack.config.ts`.
That file's authoring surface is `defineStack`, and its schema is
`ObjectStackDefinitionSchema` on the package root — not one of the `/system`
manifests (`AppManifestSchema` installs an app into a running stack;
`DeployManifestSchema` describes a deploy bundle).
```typescript
import { ObjectStackDefinitionSchema } from '@objectstack/spec';
// The kernel starts here
const config = ObjectStackDefinitionSchema.parse(loadedConfig);
```

### Rule #2: Security First (Identity & Policy)
All request handlers must validate the caller's security context against
`RLSUserContextSchema`. No operation proceeds without evaluating the applicable
`RowLevelSecurityPolicySchema` rules against that context.
```typescript
import {
  RLSUserContextSchema,
  RowLevelSecurityPolicySchema,
} from '@objectstack/spec/security';
```
There is no bare `Identity` or `Policy` schema: identity is the per-request RLS
user context, and policy is per-object and per-operation. Broader posture lives
in the qualified schemas (`TenantSecurityPolicySchema`, `PermissionSetSchema`).

### Rule #3: API Gateway Contract
The HTTP/Gateway layer must perform strict request/response validation using `api/contract.zod.ts` and `api/endpoint.zod.ts`.
- **Incoming requests** -> validate the body against the schema the operation
  declares. There is no single request envelope, by design: `StandardApiContracts`
  maps each standard operation to its `input` — `create` to `CreateRequestSchema`,
  `update` to `UpdateRequestSchema`, `get` and `delete` to `IdRequestSchema`, the
  `bulk*` family to `BulkRequestSchema`, `list` to `QuerySchema` (that one from
  `@objectstack/spec/data`). The route's own shape — method, path, mappings — is
  `ApiEndpointSchema` in `api/endpoint.zod.ts`.
- **Outgoing responses** -> emit the one declared envelope. `BaseResponseSchema`
  is its skeleton (`success`, `error`, `meta`); each response type adds its own
  `data` on top of it — `SingleRecordResponseSchema`, `ListRecordResponseSchema`,
  `BulkResponseSchema`, `DeleteResponseSchema` — and `StandardApiContracts` names
  the `output` for the operation you served.
```typescript
import {
  StandardApiContracts,
  BaseResponseSchema,
  envelopeViolations,
} from '@objectstack/spec/api';
```
`BaseResponseSchema.safeParse` alone does NOT prove a body is envelope-conformant:
it is a plain object schema, so it strips unknown keys, and it accepts
`{ success: true }` carrying no payload at all. Gate what you emit with
`envelopeViolations(body)` — it returns every way the body departs from the
declared envelope, and an empty array means conformant.

### Rule #4: Event Driven Architecture
System state changes (User created, Schema changed) MUST emit events defined in `EventSchema`.
Do not invent event formats. Use the standard CloudEvents-compatible structure.

## 3. Workflow

1.  **Define Configuration**: Start by mapping `ObjectStackDefinitionSchema` to your runtime config.
2.  **Initialize Identity**: Implement the Auth Provider so it produces a context that satisfies `RLSUserContextSchema`.
3.  **Setup Gateway**: Configure routes based on `ApiRoutesSchema` (from `api/discovery.zod.ts`).

## 4. Key Files to Watch

- `stack.zod.ts`: The "Kernel Configuration" (`ObjectStackDefinitionSchema`, `defineStack`).
- `security/rls.zod.ts`: The "Security Context" (`RLSUserContextSchema`, `RowLevelSecurityPolicySchema`).
- `kernel/events.zod.ts`: The "System Bus" (`EventSchema`; the `kernel/events/*` sub-modules are internal — import from the published `@objectstack/spec/kernel` entrypoint).
- `api/contract.zod.ts`: The "Wire Protocol".
