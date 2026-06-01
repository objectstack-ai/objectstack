# Design Document: Marketplace Protocol — Package Publishing & Distribution

> **Author:** ObjectStack Core Team  
> **Created:** 2026-02-17  
> **Updated:** 2026-05-31 — §1–2 and §6 aligned to ADR-0019 (App as the
> consumer-facing unit; no "suite contains apps"; consumer Marketplace lists
> only `type: app`).  
> **Status:** Design Specification  
> **Target Version:** v3.2 – v4.0

---

## Table of Contents

- [1. Executive Summary](#1-executive-summary)
- [2. Architecture Overview](#2-architecture-overview)
- [3. Developer Publishing Flow](#3-developer-publishing-flow)
- [4. Customer Installation Flow](#4-customer-installation-flow)
- [5. Lifecycle Management](#5-lifecycle-management)
- [6. Publishing Strategies](#6-publishing-strategies-for-multi-plugin-applications)
- [7. Security & Trust Model](#7-security--trust-model)
- [8. Pricing & Billing](#8-pricing--billing)
- [9. Development Roadmap](#9-development-roadmap)

---

## 1. Executive Summary

This document defines the **Marketplace Protocol** for the ObjectStack ecosystem — a comprehensive specification covering how metadata-driven packages are published to the marketplace and how customers discover, install, and manage them.

> **Companion document:** code-bearing contributions (plugins with npm
> dependencies, drivers, connectors, AI extensions, and client UI plugins) have
> their own supply-side distribution design in
> [`plugin-distribution.md`](./plugin-distribution.md) (decisions:
> [ADR-0025](../adr/0025-plugin-package-distribution.md),
> [ADR-0026](../adr/0026-client-ui-plugin-distribution.md)). Per ADR-0019 those
> contributions are **never** consumer-installed directly — they ship *inside an
> App* or are *operator-provisioned*. This document covers the consumer-facing
> **App** flow; the companion covers the developer/operator **contribution
> catalog**. Both share one signed `sys_*` registry + artifact backbone.

### Key Components

The marketplace protocol consists of three primary schema files:

1. **`packages/spec/src/kernel/manifest.zod.ts`** — Package manifest schema defining the structure of all packages
2. **`packages/spec/src/kernel/package-registry.zod.ts`** — Runtime lifecycle management for installed packages
3. **`packages/spec/src/cloud/marketplace.zod.ts`** — Marketplace ecosystem schemas for publishing and discovery

### Reference Implementation

**HotCRM** (`objectstack-ai/hotcrm`) demonstrates a real-world application. Per
ADR-0019, it is being refolded into a **single consumer App** (download = open =
uninstall) whose internal plugins are invisible "frameworks inside the bundle":
- Root `objectstack.config.ts` with `type: 'app'` — one consumer-facing App
- The former sub-plugins (crm, finance, marketing, …) are internal
  contributions bundled inside the App, not separately listed or installed
- The App owns the set of namespaces those contributions use; uninstall is
  atomic over that set

---

## 2. Architecture Overview

### 2.1 Package Taxonomy (ADR-0019)

The ObjectStack ecosystem exposes **one consumer-facing noun: the App.**

```
App  ← the only consumer unit (download = open = uninstall)
├── Type: app   (the only consumer-installable type; see isConsumerInstallable)
├── Namespace(s): the App owns a set; uninstall is atomic over the set
├── Apps:   at most one app surface per package (one app, many tabs — no suite)
└── Internal contributions (invisible): plugin | driver | server | ui | theme | agent | module
       — "frameworks inside the .app bundle": bundled or operator-provisioned,
         never independently listed or installed by a consumer
```

### 2.2 App vs Package vs internal contribution

From `packages/spec/src/kernel/package-registry.zod.ts` (ADR-0019):

> **App**: the one consumer-facing unit — what a tenant downloads, opens, and
> uninstalls. Only `type: app` is consumer-installable, and a consumer package
> defines **at most one app** (no "suite contains apps").  
> **Package**: the internal / control-plane artifact term; never surfaced to
> consumers as a separate noun.  
> **Internal contributions** (plugin/driver/server/…): ship inside an App or are
> operator-provisioned; a consumer never installs them directly.

### 2.3 Namespace Scoping

From `packages/spec/src/kernel/manifest.zod.ts`, namespace prevents naming collisions:

- `namespace: "crm"` → objects become `crm__account`, `crm__deal`
- `namespace: "sales"` → objects become `sales__account`, `sales__contact`
- Platform-reserved: `"base"`, `"system"` keep short names

### 2.4 Dependency Resolution

Supports semantic versioning ranges:
- `^2.0.0`: Compatible with 2.x.x
- `~2.1.0`: Compatible with 2.1.x
- Installation order: Dependencies before dependents
- Circular dependencies: Detected and rejected

---

## 3. Developer Publishing Flow

From `packages/spec/src/cloud/marketplace.zod.ts`:

```
1. Develop   → Build plugin locally using ObjectStack CLI
2. Validate  → Run `os plugin validate` (schema + security checks)
3. Build     → Run `os plugin build` (bundle + sign)
4. Submit    → Run `os plugin publish` (submit to marketplace)
5. Review    → Platform conducts automated + manual review
6. Publish   → Approved listing goes live on marketplace
```

### 3.1 Step 1: Develop

```bash
os plugin init --name hotcrm-finance --namespace finance
```

Example `objectstack.config.ts`:

```typescript
import { defineStack } from '@objectstack/spec';

export default defineStack({
  id: 'com.hotcrm.finance',
  namespace: 'finance',
  version: '1.0.0',
  type: 'plugin',
  name: 'HotCRM Finance',
  description: 'Financial management for HotCRM',
  
  permissions: ['system.object.create', 'system.object.read'],
  objects: ['./src/objects/*.object.ts'],
  dependencies: { 'com.hotcrm.core': '^1.0.0' },
  
  configuration: {
    title: 'Finance Settings',
    properties: {
      defaultCurrency: { type: 'string', default: 'USD' },
      taxRate: { type: 'number', default: 0.08 }
    }
  }
});
```

### 3.2 Step 2: Validate

```bash
os plugin validate
```

Validates:
- Schema compliance (all 30+ metadata types)
- Manifest correctness (`ManifestSchema`)
- Dependency resolution
- Security checks (no hardcoded credentials, unsafe calls)

### 3.3 Step 3: Build

```bash
os plugin build
```

Creates `.tgz` artifact with:
- Bundled metadata (JSON format)
- JSON Schema exports
- Cryptographic signature

### 3.4 Step 4: Submit

Publisher must register first:

```bash
os publisher register --name "HotCRM Inc" --type organization
os plugin publish ./dist/hotcrm-finance-1.0.0.tgz
```

`PackageSubmissionSchema` tracks submission through states:
- `pending` → `scanning` → `in-review` → `approved`/`rejected`

### 3.5 Step 5: Review

**Automated:**
- Security scan (static analysis, vulnerability check)
- Compatibility check (platform version, dependencies)
- Quality metrics (completeness, documentation)

**Manual:**
- Functionality review
- Policy compliance
- UX quality

### 3.6 Step 6: Publish

Creates `MarketplaceListingSchema` with:
- Marketing info (name, tagline, description, category, tags)
- Visual assets (icon, screenshots)
- Links (docs, support, repository)
- Pricing model
- Version history
- Statistics (installs, ratings, reviews)

---

## 4. Customer Installation Flow

### 4.1 Discovery

Search via `MarketplaceSearchRequestSchema`:

```bash
os marketplace search "financial" --category finance --pricing free
```

Supports:
- Full-text search
- Category/tag filtering
- Pricing model filter
- Publisher verification filter
- Sort by: relevance, popularity, rating, newest

### 4.2 Installation Channels

**1. CLI:**
```bash
os marketplace install com.hotcrm.finance@1.0.0
```

**2. SDK:**
```typescript
await client.marketplace.install({
  listingId: 'com.hotcrm.finance',
  version: '1.0.0',
  settings: { defaultCurrency: 'EUR' },
  enableOnInstall: true
});
```

**3. REST API:**
```bash
POST /api/v1/marketplace/install
```

**4. Studio UI:**
- Browse catalog, view details
- One-click install
- Configuration wizard

**5. Tenant Console (in-runtime):**
- Each ObjectOS runtime exposes `/api/v1/marketplace/*` via `MarketplaceProxyPlugin`,
  forwarding read-only requests to the configured `controlPlaneUrl` (Cloud).
- The console SPA (`@object-ui/console`) provides:
  - `/system/marketplace` — browse approved + listed packages with search/category filters
  - `/system/marketplace/:packageId` — detail page (readme, versions, license, homepage)
  - "Install" dialog: env Select + sample-data Checkbox, calls
    `POST cloud.../api/v1/actions/sys_package/install_package` with `credentials: 'include'`
  - When no cloud session is present (no cookie), the dialog falls back to an
    "Open on cloud" deep link to `cloud.objectos.app/apps/cloud-control/sys_package/{id}`
- Discoverability: the System Sidebar exposes "App Marketplace" under the system
  fallback navigation; the System Settings hub page also surfaces an "App Marketplace"
  card. No additional roles or tenant-side configuration are required — only
  `OS_CLOUD_URL` (a.k.a. `controlPlaneUrl`) must be set on the runtime. When unset,
  the proxy returns `503` and the entry remains discoverable but inert.

### 4.3 Installation Flow

1. Fetch manifest from artifact storage
2. Validate license (if paid)
3. Map to `InstallPackageRequest`
4. Call kernel's `SchemaRegistry.installPackage()`

### 4.4 Kernel Registration

```typescript
class SchemaRegistry {
  async installPackage(request) {
    // 1. Validate manifest
    // 2. Check namespace collision
    // 3. Resolve dependencies
    // 4. Register all metadata types (30+)
    // 5. Create InstalledPackage record
    // 6. Store in registry
    // 7. Enable if requested
  }
}
```

Registers 30+ metadata types:
- Objects, Views, Pages, Forms, Dashboards, Reports, Charts, Widgets
- Workflows, Flows, Statemachines, Schedules
- Permissions, Sharing, Security, Connectors
- Notifications, Agents, MCP, Seed Data, Actions
- Capabilities, Apps, Studio, Territories, Translations

### 4.5 Package State

`InstalledPackageSchema` tracks:
- `manifest`: Full package definition
- `status`: installing | installed | disabled | upgrading | uninstalling | error
- `enabled`: Whether metadata is active
- `installedVersion` / `previousVersion`: Version tracking
- `settings`: User configuration

---

## 5. Lifecycle Management

### 5.1 State Machine

```
installing → installed ⇄ disabled
                ↓
          upgrading → installed
                ↓
          uninstalling → [REMOVED]
                ↓
             error
```

### 5.2 Version Upgrade

```bash
os marketplace upgrade com.hotcrm.finance@2.0.0
```

Process:
1. Check current version
2. Fetch new version
3. Validate compatibility
4. Backup (store previousVersion)
5. Set status to `upgrading`
6. Unload current metadata
7. Install new version
8. Migrate data
9. Update state

Rollback: `os packages rollback com.hotcrm.finance`

### 5.3 Enable/Disable

**Disable:**
```bash
os packages disable com.hotcrm.finance
```
- Unload metadata (objects/views unavailable)
- Keep package installed
- Preserve data

**Enable:**
```bash
os packages enable com.hotcrm.finance
```
- Load metadata back
- Reactivate package

### 5.4 Uninstall

```bash
os marketplace uninstall com.hotcrm.finance
```

Steps:
1. Check no other packages depend on this
2. Set status to `uninstalling`
3. Unload metadata
4. Handle data (preserve by default, or delete with flag)
5. Remove package record
6. Clean artifacts

---

## 6. Composing a Multi-Plugin Application (ADR-0019)

The consumer model has **one user-visible noun — the App — and no "suite
contains apps" aggregator**. A solution built from many internal plugins has
exactly two valid shapes; both ship as *one App* (or several independent Apps)
to the consumer, never as a wrapper that surfaces N apps.

### 6.1 Shape A — One App, internal plugins bundled (recommended for HotCRM)

Compose all internal plugins into a single `type: 'app'` package. The plugins
are "frameworks inside the .app bundle" — invisible to the consumer. The App
defines **at most one app surface** (one app with multiple tabs) and owns the
set of namespaces its plugins use.

```typescript
// objectstack.config.ts
export default defineStack({
  manifest: { id: 'com.hotcrm', type: 'app', namespace: 'hotcrm', version: '2.0.0' },
  plugins: [crmPlugin, financePlugin, marketingPlugin, /* … */], // invisible internals
  apps: [hotcrmApp], // exactly one consumer app surface (multiple tabs), not a suite
});
```

**Pros:** one listing, one install, atomic versioning and uninstall, one noun
for the consumer.

### 6.2 Shape B — Several independent Apps (the iWork split)

If verticals are genuinely separate products, ship each as its **own App
package** — its own listing, install, namespace, and lifecycle (like Pages /
Numbers / Keynote). This is *not* a suite: there is no wrapper above them.

```bash
os publish   # com.hotcrm.crm     (type: app)
os publish   # com.hotcrm.finance (type: app)
```

**Pros:** granular adoption, independent versioning.
**Cons:** verticals do not share one install; cross-app data sharing is a
separate concern (see ADR-0019 §Out of scope).

> **Not allowed:** a "meta-package" / suite whose only job is to surface N apps
> to the consumer — the Office "suite contains applications" model ADR-0019
> removes. `defineStack` enforces *at most one app* per `type: app` package, and
> the consumer Marketplace lists only `type: app`.

---

## 7. Security & Trust Model

### 7.1 Publisher Verification

5 levels:

| Level | Requirements | Badge |
|-------|-------------|-------|
| unverified | None | None |
| pending | Docs submitted | ⏳ |
| verified | Identity confirmed | ✓ |
| trusted | 10+ packages, >1000 installs, 4.5+ rating | ⭐ |
| partner | Partnership agreement | 🤝 |

### 7.2 Package Signing

**Build:** RSA-SHA256 signature with publisher's private key  
**Install:** Verify signature with public key, reject if invalid

### 7.3 Security Scanning

Automated checks:
- No `eval()` or dangerous APIs
- Dependency vulnerability scan (CVEs)
- Permission analysis (flag excessive)
- Secret detection (API keys, passwords)

**Score:** 100 - (critical×25 + high×10 + medium×3 + low×1)  
**Minimum to publish:** 70/100

### 7.4 Permission Scope

Reviewers ensure least privilege:

```typescript
// ✅ Good
permissions: ['system.object.read', 'system.object.create']

// ❌ Bad
permissions: ['system.admin.write']  // Excessive
```

---

## 8. Pricing & Billing

### 8.1 Pricing Models

6 models:
- **free**: No cost
- **freemium**: Core free, premium paid
- **paid**: One-time purchase
- **subscription**: Monthly/annual recurring
- **usage-based**: Pay per usage
- **contact-sales**: Enterprise custom

### 8.2 License Validation

```bash
os marketplace install com.hotcrm.finance --license-key="KEY"
```

Validates:
1. Signature
2. Package match
3. Expiration (subscriptions)
4. Tenant match (enterprise)
5. Server validation

### 8.3 Billing Integration

**Subscriptions:**
- Create on install
- Periodic validation
- Disable on cancellation

**Usage-based:**
- Meter usage events
- Aggregate per period
- Generate invoices
- Enforce limits

---

## 9. Development Roadmap

### Phase 1: Foundation (Q1 2026)

| Item | Complexity | Status |
|------|-----------|--------|
| Zod Schemas | Done | ✅ |
| SchemaRegistry.installPackage() | XL | 🚧 |
| Metadata registration (30+ types) | XL | 🔜 |
| Namespace scoping | M | 🔜 |
| Dependency resolution | L | 🔜 |
| Package state tracking | M | 🔜 |

**Deliverables:**
- ✅ `packages/spec/src/kernel/manifest.zod.ts`
- ✅ `packages/spec/src/kernel/package-registry.zod.ts`
- ✅ `packages/spec/src/cloud/marketplace.zod.ts`
- 🚧 `packages/kernel/src/registry/schema-registry.ts`

### Phase 2: CLI Tooling (Q2 2026)

| Item | Complexity | Status |
|------|-----------|--------|
| os plugin validate | L | 🔜 |
| os plugin build | L | 🔜 |
| os plugin publish | M | 🔜 |
| os marketplace search | M | 🔜 |
| os marketplace install | L | 🔜 |
| os marketplace upgrade | M | 🔜 |
| os marketplace uninstall | M | 🔜 |
| os packages list/enable/disable | S | 🔜 |
| os publisher register | M | 🔜 |

**Deliverables:**
- `packages/cli/src/commands/plugin.ts`
- `packages/cli/src/commands/marketplace.ts`
- `packages/cli/src/commands/packages.ts`

### Phase 3: Marketplace Backend (Q2-Q3 2026)

| Item | Complexity | Status |
|------|-----------|--------|
| Publisher registry | M | 🔜 |
| Submission pipeline | M | 🔜 |
| Security scanner | XL | 🔜 |
| Review workflow | L | 🔜 |
| Listing management | M | 🔜 |
| Search & discovery | L | 🔜 |
| Artifact storage & CDN | M | 🔜 |
| License validation | L | 🔜 |
| Analytics & metrics | M | 🔜 |

**Deliverables:**
- `apps/marketplace-api/` (REST service)
- `packages/marketplace-scanner/` (security scanner)
- `packages/artifact-storage/` (CDN)

### Phase 4: Marketplace Frontend (Q3 2026)

| Item | Complexity | Status |
|------|-----------|--------|
| Browse & search UI | L | 🔜 |
| Package detail pages | M | 🔜 |
| One-click install | M | 🔜 |
| Install wizard | L | 🔜 |
| Installed packages UI | M | 🔜 |
| Package settings UI | M | 🔜 |
| Review & rating system | M | 🔜 |
| Publisher dashboard | L | 🔜 |

**Deliverables:**
- `apps/studio/src/pages/marketplace/` (UI)
- `apps/studio/src/pages/publisher/` (dashboard)

### Phase 5: Enterprise Features (Q4 2026)

| Item | Complexity | Status |
|------|-----------|--------|
| Private marketplace | L | 🔜 |
| Approval workflow | M | 🔜 |
| Usage-based billing | XL | 🔜 |
| Analytics dashboard | L | 🔜 |
| Auto-update policies | L | 🔜 |
| Multi-tenant isolation | M | 🔜 |
| Package sandboxing | XL | 🔜 |
| Compliance reporting | L | 🔜 |

**Deliverables:**
- `packages/kernel/src/enterprise/` (isolation, sandbox)
- `packages/billing/` (metered billing)

---

## Summary

This comprehensive design document establishes the **Marketplace Protocol** for ObjectStack:

1. **Architecture**: Package taxonomy, namespace scoping, dependency resolution
2. **Publishing**: 6-step flow (develop → validate → build → submit → review → publish)
3. **Installation**: 4 channels (CLI, SDK, API, UI) with 30+ metadata type registration
4. **Lifecycle**: State machine for install/enable/disable/upgrade/uninstall
5. **Composition** (ADR-0019): one App (internal plugins bundled) or several independent Apps — never a suite
6. **Security**: 5-level verification, signing, automated scanning, permission review
7. **Pricing**: 6 models (free to enterprise) with license validation
8. **Roadmap**: 5 phases across 4 quarters

**Key Protocol Files:**
- ✅ `packages/spec/src/kernel/manifest.zod.ts`
- ✅ `packages/spec/src/kernel/package-registry.zod.ts`
- ✅ `packages/spec/src/cloud/marketplace.zod.ts`

**Next Steps:**
1. Implement Phase 1: SchemaRegistry.installPackage() with 30+ metadata registration
2. Build Phase 2: CLI tooling (os plugin/marketplace/packages commands)
3. Deploy Phase 3: Marketplace backend services

---

**End of Document**
