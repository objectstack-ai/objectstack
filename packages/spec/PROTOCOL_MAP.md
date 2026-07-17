# ObjectStack Protocol Registry

This document serves as the **Grand Map** of the ObjectStack specification. It lists every protocol definition available in the system, categorized by domain.

> **Guidance for AI Agents:**
> *   **Primary Protocols** (marked with ⭐) are the most frequently used definitions.
> *   **Support Protocols** provide internal structures or auxiliary types.
> *   Always check the file content for specific Zod schema definitions.

> **Maintaining this file.** It is hand-written and not generated. Every `src/…`
> link is asserted to resolve by `scripts/protocol-map.test.ts`, so a rename that
> orphans a row fails CI — repoint the row at the schema that replaced it, or drop
> the row if the concept is gone. The listing is a *curated digest*, not an
> exhaustive index: not every schema in `src/` appears here, and that is by design.

---

## 🏗️ 1. Data Protocol (`src/data`)
*The "Database as Code" layer. Defines the shape, validation, and storage of data.*

| File | Status | Description |
| :--- | :--- | :--- |
| [`object.zod.ts`](src/data/object.zod.ts) | ⭐ | **Object Definition**. The core unit of data (tables), including fields, permissions, and event hooks. |
| [`field.zod.ts`](src/data/field.zod.ts) | ⭐ | **Field Types**. Defines all supported data types (text, number, lookup, formula, etc.). |
| [`query.zod.ts`](src/data/query.zod.ts) | ⭐ | **ObjectQL**. The JSON-based query language AST (filters, sorts, expands). |
| [`validation.zod.ts`](src/data/validation.zod.ts) | ⭐ | **Validation Rules**. Server-side data validation logic and error messages. |
| [`datasource.zod.ts`](src/data/datasource.zod.ts) | | **Datasource Config**. Connection settings for external databases (Postgres, Mongo, etc.). |
| [`driver.zod.ts`](src/data/driver.zod.ts) | | **Driver Interface**. Abstract base for database drivers. |
| [`driver-sql.zod.ts`](src/data/driver-sql.zod.ts) | | **SQL Driver**. Specific configurations for SQL-based drivers. |
| [`driver-nosql.zod.ts`](src/data/driver-nosql.zod.ts) | | **NoSQL Driver**. Specific configurations for NoSQL drivers. |
| [`driver/mongo.zod.ts`](src/data/driver/mongo.zod.ts) | | **MongoDB Driver**. MongoDB specific connection options. |
| [`driver/postgres.zod.ts`](src/data/driver/postgres.zod.ts) | | **PostgreSQL Driver**. PostgreSQL specific connection options. |
| [`seed.zod.ts`](src/data/seed.zod.ts) | | **Seed**. Seed data / fixtures — bootstrap, reference, and demo rows applied on publish. (Was `dataset` until #1620; the `dataset` name now belongs to the analytics semantic layer.) |
| [`seed-loader.zod.ts`](src/data/seed-loader.zod.ts) | | **Seed Loader**. How seed rows are resolved and applied. |
| [`analytics.zod.ts`](src/data/analytics.zod.ts) | | **Data Analytics**. Aggregation and multidimensional analysis types. |
| [`document.zod.ts`](src/data/document.zod.ts) | | **Document**. Unstructured document storage protocol. |
| [`external-lookup.zod.ts`](src/data/external-lookup.zod.ts) | | **External Lookup**. Virtual lookups to external API data. |
| [`filter.zod.ts`](src/data/filter.zod.ts) | | **Filter**. Low-level filter syntax definitions. |
| [`hook.zod.ts`](src/data/hook.zod.ts) | | **Triggers/Hooks**. Database trigger definitions (before/after insert/update). |
| [`mapping.zod.ts`](src/data/mapping.zod.ts) | | **Data Mapping**. Rules for transforming data between schemas. |
| [`data-engine.zod.ts`](src/data/data-engine.zod.ts) | | **Data Engine**. Internal engine configuration. |

---

## 🎨 2. UI & Experience (`src/ui`)
*The "Frontend as Code" layer. Defines the user interface and interactions.*

| File | Status | Description |
| :--- | :--- | :--- |
| [`app.zod.ts`](src/ui/app.zod.ts) | ⭐ | **App Container**. Defines the application shell, navigation menu, and branding. |
| [`view.zod.ts`](src/ui/view.zod.ts) | ⭐ | **Views**. List views (Grid, Kanban) and Record views (Form layouts). |
| [`page.zod.ts`](src/ui/page.zod.ts) | ⭐ | **Custom Pages**. Drag-and-drop page builder definitions. |
| [`dataset.zod.ts`](src/ui/dataset.zod.ts) | ⭐ | **Analytics Dataset**. The one semantic layer (ADR-0021): a base object plus declared dimensions and measures. `report` / `dashboard` bind to it by reference instead of declaring their own queries. |
| [`dashboard.zod.ts`](src/ui/dashboard.zod.ts) | ⭐ | **Dashboards**. Logic for grid-based analytic dashboards. |
| [`report.zod.ts`](src/ui/report.zod.ts) | ⭐ | **Reports**. Reporting definitions (tabular, summary, matrix). |
| [`action.zod.ts`](src/ui/action.zod.ts) | ⭐ | **Actions**. Buttons, links, and operations available on UI. |
| [`chart.zod.ts`](src/ui/chart.zod.ts) | | **Charts**. Visualization configurations (Bar, Pie, Line, etc.). |
| [`widget.zod.ts`](src/ui/widget.zod.ts) | | **Widgets**. Reusable UI components for dashboards and pages. |
| [`component.zod.ts`](src/ui/component.zod.ts) | | **Components**. Low-level component definitions. |
| [`theme.zod.ts`](src/ui/theme.zod.ts) | | **Theming**. Color palettes and visual styling rules. |

---

## ⚡ 3. Automation (`src/automation`)
*The "Logic as Code" layer. Defines business processes and orchestration.*

| File | Status | Description |
| :--- | :--- | :--- |
| [`state-machine.zod.ts`](src/automation/state-machine.zod.ts) | ⭐ | **State Machines**. Strict lifecycle transitions and guards. |
| [`flow.zod.ts`](src/automation/flow.zod.ts) | ⭐ | **Visual Flow**. Complex orchestration logic (decisions, loops, CRUD). |
| [`approval.zod.ts`](src/automation/approval.zod.ts) | ⭐ | **Approval Node**. Flow node config for human approval pauses. |
| [`webhook.zod.ts`](src/automation/webhook.zod.ts) | ⭐ | **Webhooks**. Outbound HTTP notification configuration. |
| [`trigger-registry.zod.ts`](src/automation/trigger-registry.zod.ts) | | **Trigger Registry**. Central registry for all automation triggers. |
| [`etl.zod.ts`](src/automation/etl.zod.ts) | | **ETL Jobs**. Extract-Transform-Load definitions. |
| [`sync.zod.ts`](src/automation/sync.zod.ts) | | **Data Sync**. Bi-directional synchronization rules. |

---

## 🧠 4. AI & Intelligence (`src/ai`)
*The "Agent as Code" layer. Defines autonomous actors and cognitive pipelines.*

| File | Status | Description |
| :--- | :--- | :--- |
| [`agent.zod.ts`](src/ai/agent.zod.ts) | ⭐ | **AI Agent**. Attributes of an AI assistant (role, personality, model). |
| [`tool.zod.ts`](src/ai/tool.zod.ts) | ⭐ | **Tools**. Capabilities exposed to the AI (function calling). Was `agent-action`. |
| [`skill.zod.ts`](src/ai/skill.zod.ts) | ⭐ | **Skills**. Named bundles of instructions plus tools, activated by trigger phrases or conditions. |
| [`mcp.zod.ts`](src/ai/mcp.zod.ts) | ⭐ | **Model Context Protocol (MCP)**. Standard protocol for connecting AI to tools, resources, and data sources. |
| [`model-registry.zod.ts`](src/ai/model-registry.zod.ts) | | **LLM Registry**. Configuration for model providers (OpenAI, Anthropic). |
| [`conversation.zod.ts`](src/ai/conversation.zod.ts) | | **Chat Session**. History and context management for AI chats. |
| [`knowledge-source.zod.ts`](src/ai/knowledge-source.zod.ts) | | **Knowledge Source**. What to index and which adapter to use (the RAG retrieval binding). |
| [`knowledge-document.zod.ts`](src/ai/knowledge-document.zod.ts) | | **Knowledge Document**. Document / chunk / hit shapes shared by every knowledge adapter. |
| [`embedding.zod.ts`](src/ai/embedding.zod.ts) | | **Embeddings**. Embedding model and vector store configuration. |
| [`solution-blueprint.zod.ts`](src/ai/solution-blueprint.zod.ts) | | **Solution Blueprint**. Plan-first authoring target for high-level goals (ADR-0033). |
| [`usage.zod.ts`](src/ai/usage.zod.ts) | | **Usage**. Token consumption measurement. Was `cost`. |

---

## 🛡️ 5. Identity & Security (`src/identity`, `src/security`)
*The "Access as Code" layer. Defines users, organization, and permissions.*

| File | Status | Description |
| :--- | :--- | :--- |
| [`identity.zod.ts`](src/identity/identity.zod.ts) | ⭐ | **User Identity**. User accounts, authentication attributes. |
| [`organization.zod.ts`](src/identity/organization.zod.ts) | ⭐ | **Organization**. Multi-tenancy structure (spaces, companies). |
| [`permission.zod.ts`](src/security/permission.zod.ts) | ⭐ | **Permissions**. ACLs for Objects, Fields, and Apps. |
| [`position.zod.ts`](src/identity/position.zod.ts) | | **Positions**. The assignable bundle of permission sets a user holds. Renamed from `role` by ADR-0090 (`sys_role`→`sys_position`); `profile` was removed in the same wave. |
| [`sharing.zod.ts`](src/security/sharing.zod.ts) | | **Sharing Rules**. Record-level access rules (sharing calculation). |
| [`explain.zod.ts`](src/security/explain.zod.ts) | | **Access Explain**. Why a principal can or cannot reach a record. |
| [`rls.zod.ts`](src/security/rls.zod.ts) | | **Row Level Security**. Database-level RLS definitions. |
| [`territory.zod.ts`](src/security/territory.zod.ts) | | **Territory Management**. Sales territory models. |
| [`scim.zod.ts`](src/identity/scim.zod.ts) | | **SCIM Protocol**. Identity provisioning standards. |

---

## 🔌 6. Integration (`src/integration`)
*The "Connectivity as Code" layer. Defines external connections.*

| File | Status | Description |
| :--- | :--- | :--- |
| [`connector.zod.ts`](src/integration/connector.zod.ts) | ⭐ | **Connector Definition**. Metadata for external API integrations (OpenAPI wrapper). |
| [`connector/saas.zod.ts`](src/integration/connector/saas.zod.ts) | | **SaaS Connectors**. Specifics for SaaS APIs (Salesforce, Stripe). |
| [`connector/database.zod.ts`](src/integration/connector/database.zod.ts) | | **DB Connectors**. External database integration. |
| [`connector/file-storage.zod.ts`](src/integration/connector/file-storage.zod.ts) | | **Storage Connectors**. S3, Blob Storage integrations. |
| [`connector/message-queue.zod.ts`](src/integration/connector/message-queue.zod.ts) | | **MQ Connectors**. Kafka, RabbitMQ integrations. |
| [`connector/github.zod.ts`](src/integration/connector/github.zod.ts) | | **GitHub Connector**. Logic for Git integration. |
| [`connector/vercel.zod.ts`](src/integration/connector/vercel.zod.ts) | | **Vercel Connector**. Deployment integration. |

---

## 🖥️ 7. System & Infrastructure (`src/system`)
*The "Infrastructure as Code" layer. Defines runtime behaviors.*

| File | Status | Description |
| :--- | :--- | :--- |
| [`job.zod.ts`](src/system/job.zod.ts) | ⭐ | **Background Jobs**. Cron and scheduled task definitions. |
| [`auth-config.zod.ts`](src/system/auth-config.zod.ts) | | **Auth Configuration**. SSO, OIDC, SAML settings. |
| [`http-server.zod.ts`](src/system/http-server.zod.ts) | | **HTTP Server**. Server port, CORS, and middleware settings. |
| [`logging.zod.ts`](src/system/logging.zod.ts) | | **Logging**. Log levels and output formats. |
| [`audit.zod.ts`](src/system/audit.zod.ts) | | **Audit Trail**. Audit logging configuration. |
| [`cache.zod.ts`](src/system/cache.zod.ts) | | **Caching**. Redis/Memory cache strategies. |
| [`metrics.zod.ts`](src/system/metrics.zod.ts) | | **Observability**. Prometheus/OpenTelemetry metrics. |
| [`tracing.zod.ts`](src/system/tracing.zod.ts) | | **Tracing**. Distributed tracing configuration. |
| [`object-storage.zod.ts`](src/system/object-storage.zod.ts) | | **File Storage**. S3 bucket and upload configurations. |
| [`message-queue.zod.ts`](src/system/message-queue.zod.ts) | | **Message Queue**. Internal event bus settings. |
| [`search-engine.zod.ts`](src/system/search-engine.zod.ts) | | **Search**. Elasticsearch/Meilisearch configuration. |
| [`notification.zod.ts`](src/system/notification.zod.ts) | | **Notifications**. System-wide notification preferences. |
| [`translation.zod.ts`](src/system/translation.zod.ts) | | **i18n**. Internationalization and localization. |
| [`worker.zod.ts`](src/system/worker.zod.ts) | | **Worker Nodes**. Background worker scaling config. |
| [`encryption.zod.ts`](src/system/encryption.zod.ts) | | **Encryption**. At-rest and in-transit encryption keys. |
| [`migration.zod.ts`](src/system/migration.zod.ts) | | **Migration**. Database schema migration tracking. |
| [`license.zod.ts`](src/system/license.zod.ts) | | **Licensing**. License keys and entitlements. |
| [`registry-config.zod.ts`](src/system/registry-config.zod.ts) | | **Registry Config**. Configuration for the package registry. |
| [`tenant.zod.ts`](src/system/tenant.zod.ts) | | **Tenant**. Multi-tenant environment isolation. |
| [`change-management.zod.ts`](src/system/change-management.zod.ts) | | **Change Mgmt**. Deployment history and rollbacks. |
| [`collaboration.zod.ts`](src/system/collaboration.zod.ts) | | **Collaboration**. Real-time collaboration settings. |

---

## 🌐 8. API Networking (`src/api`)
*The "Interface as Code" layer. Defines the external API surface.*

| File | Status | Description |
| :--- | :--- | :--- |
| [`protocol.zod.ts`](src/api/protocol.zod.ts) | ⭐ | **Stack Protocol**. valid requests and responses for the platform. |
| [`dispatcher.zod.ts`](src/api/dispatcher.zod.ts) | ⭐ | **HttpDispatcher**. Route-to-service mapping for API routing. |
| [`discovery.zod.ts`](src/api/discovery.zod.ts) | ⭐ | **Service Discovery**. Service registration and API routes discovery. |
| [`endpoint.zod.ts`](src/api/endpoint.zod.ts) | | **API Endpoints**. REST API route definitions. |
| [`graphql.zod.ts`](src/api/graphql.zod.ts) | | **GraphQL**. Schema and resolver configuration. |
| [`rest-server.zod.ts`](src/api/rest-server.zod.ts) | | **REST Server**. REST-specific server settings. |
| [`auth.zod.ts`](src/api/auth.zod.ts) | | **API Auth**. Authentication schemes for APIs. |
| [`analytics.zod.ts`](src/api/analytics.zod.ts) | | **API Analytics**. Usage tracking for APIs. |
| [`documentation.zod.ts`](src/api/documentation.zod.ts) | | **Docs**. OpenAPI/Swagger generation config. |
| [`realtime.zod.ts`](src/api/realtime.zod.ts) | | **Realtime**. WebSocket/SSE configurations. |
| [`websocket.zod.ts`](src/api/websocket.zod.ts) | | **WebSockets**. Low-level text/binary socket frames. |
| [`router.zod.ts`](src/api/router.zod.ts) | | **Routing**. API Gateway routing rules. |
| [`http-cache.zod.ts`](src/api/http-cache.zod.ts) | | **HTTP Cache**. Cache-Control headers and CDNs. |
| [`errors.zod.ts`](src/api/errors.zod.ts) | | **Error Handling**. Standard error response formats. |
| [`metadata.zod.ts`](src/api/metadata.zod.ts) | | **Metadata API**. Endpoints for schema retrieval. |
| [`odata.zod.ts`](src/api/odata.zod.ts) | | **OData**. OData protocol support. |
| [`batch.zod.ts`](src/api/batch.zod.ts) | | **Batch API**. Bulk request processing. |
| [`contract.zod.ts`](src/api/contract.zod.ts) | | **API Contracts**. Versioned API signatures. |
| [`storage.zod.ts`](src/api/storage.zod.ts) | | **Storage API**. File upload/download endpoints. |
| [`registry.zod.ts`](src/api/registry.zod.ts) | | **Registry API**. Package registry interface. |
| [`package-api.zod.ts`](src/api/package-api.zod.ts) | | **Package API**. Package lifecycle endpoints (`/api/v1/packages`). |

---

## ⚙️ 9. Kernel & Runtime (`src/kernel`)
*The "OS as Code" layer. Defines low-level plugin lifecycles.*

| File | Status | Description |
| :--- | :--- | :--- |
| [`plugin.zod.ts`](src/kernel/plugin.zod.ts) | ⭐ | **Plugin Definition**. The structure of an ObjectStack plugin. |
| [`manifest.zod.ts`](src/kernel/manifest.zod.ts) | ⭐ | **Manifest**. The `package.json` equivalent for the stack. |
| [`context.zod.ts`](src/kernel/context.zod.ts) | | **Execution Context**. Request-scoped context (user, transaction). |
| [`events.zod.ts`](src/kernel/events.zod.ts) | | **Kernel Events**. System lifecycle events. |
| [`feature.zod.ts`](src/kernel/feature.zod.ts) | | **Feature Flags**. Toggleable system features. |
| [`service-registry.zod.ts`](src/kernel/service-registry.zod.ts) | | **Service Registry**. Internal dependency injection. |
| [`metadata-loader.zod.ts`](src/kernel/metadata-loader.zod.ts) | | **Loader**. Logic for loading definitions from disk/DB. |
| [`plugin-loading.zod.ts`](src/kernel/plugin-loading.zod.ts) | ⭐ | **Plugin Loading**. Loading strategies, production-safe hot reload (`environment`, `productionSafety`), full plugin sandboxing (`scope`, `ipc`), code splitting, caching, and performance monitoring. |
| [`plugin-runtime.zod.ts`](src/kernel/plugin-runtime.zod.ts) | ⭐ | **Dynamic Loading**. Runtime load/unload of plugins (`DynamicLoadRequest`, `DynamicUnloadRequest`), activation events, plugin discovery from registries/directories, and source resolution (npm/local/url/registry/git). |
| [`plugin-registry.zod.ts`](src/kernel/plugin-registry.zod.ts) | | **Plugin Registry**. Metadata for available plugins. |
| [`plugin-security.zod.ts`](src/kernel/plugin-security.zod.ts) | | **Plugin Security**. Security verification for plugins. |
| [`plugin-versioning.zod.ts`](src/kernel/plugin-versioning.zod.ts) | | **Versioning**. Semantic versioning rules for plugins. |
| [`plugin-validator.zod.ts`](src/kernel/plugin-validator.zod.ts) | | **Validation**. Integrity checks for plugins. |
| [`plugin-structure.zod.ts`](src/kernel/plugin-structure.zod.ts) | | **Structure**. Zod rules for folder layout and file naming. |
| [`plugin-capability.zod.ts`](src/kernel/plugin-capability.zod.ts) | | **Capabilities**. What a plugin can do. |
| [`plugin-lifecycle-events.zod.ts`](src/kernel/plugin-lifecycle-events.zod.ts) | | **Lifecycle Events**. Hooks for plugin state changes. |
| [`plugin-lifecycle-advanced.zod.ts`](src/kernel/plugin-lifecycle-advanced.zod.ts) | | **Advanced Lifecycle**. Health monitoring, hot reload state management, graceful degradation, and update strategies. |
| [`plugin-security-advanced.zod.ts`](src/kernel/plugin-security-advanced.zod.ts) | | **Advanced Security**. Permission system, sandbox configuration (V8/WASM/container/process), security scanning, and trust levels. |
| [`startup-orchestrator.zod.ts`](src/kernel/startup-orchestrator.zod.ts) | | **Startup**. Boot sequence orchestration. |
