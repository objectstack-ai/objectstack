# Metadata Property Liveness & Necessity Audit

A protocol-level audit of **every ObjectStack metadata type**: for each schema property, cross-reference its spec definition against its **actual consumers** (`file:line`) in the runtime and renderers, to answer two questions in order — **(1) does the property take effect?** and **(2) is it necessary / reasonable?**

Liveness is judged by **code consumption**, not browser observation (an unreactive UI can't distinguish "dead property" from "data didn't trigger it"). "DEAD" = parsed but read by no non-spec/non-test consumer → a **silent no-op** for authors.

## Per-type reports
| Type | Doc | Health |
|---|---|---|
| field | `2026-06-fieldschema-property-liveness.md` | ~half dead |
| object | `2026-06-objectschema-property-liveness.md` | ~half dead |
| view | `2026-06-viewschema-property-liveness.md` | list-family healthy; chart/form-variants broken |
| app | `2026-06-appschema-property-liveness.md` | nav core healthy; aspirational tail |
| page | `2026-06-pageschema-property-liveness.md` | drift breaks layouts |
| dashboard | `2026-06-dashboardschema-property-liveness.md` | ADR-0021 half-done |
| report | `2026-06-reportschema-property-liveness.md` | dataset live; chart dead |
| dataset | `2026-06-datasetschema-property-liveness.md` | live; Studio under-covers |
| action | `2026-06-actionschema-property-liveness.md` | disabled-CEL ignored; form/shortcut dead |
| flow | `2026-06-flowschema-property-liveness.md` | enum out of sync; runAs unenforced |
| agent | `2026-06-agentschema-property-liveness.md` | autonomy + access-control aspirational |
| tool | `2026-06-toolschema-property-liveness.md` | **write-only metadata** |
| skill | `2026-06-skillschema-property-liveness.md` | triggerPhrases display-only |
| hook | `2026-06-hookschema-property-liveness.md` | **healthy** (near-total) |
| validation | `2026-06-validationschema-property-liveness.md` | **healthy** (all 6 types enforced) |
| security/identity (role, permission, policy, sharing) | `2026-06-security-identity-property-liveness.md` | **policy 100% dead** |
| system/integration (email/i18n/theme/job/webhook/portal) | `2026-06-system-integration-property-liveness.md` | email + portal dead |

## Cross-cutting patterns (in priority order)

### 1. 🔴 Parsed-but-UNENFORCED security props (latent access-control gaps)
The most serious cluster — properties that imply a security boundary but enforce nothing:
- **PolicySchema** — 100% dead (password complexity, session timeout, `forceMfa`, IP allow-list, audit retention); not even registered. better-auth's hardcoded defaults govern. **False compliance.**
- **Permission `allowTransfer`/`allowRestore`/`allowPurge`** — destructive ops (transfer, undelete, GDPR purge) not gated by RBAC.
- **Agent `permissions`/`visibility`/`access`** — "who can chat with this agent" is a no-op (route hardcodes `['ai:chat','ai:agents']`).
- **Flow `runAs`** — never switches execution identity.
- **Object `apiEnabled`/`apiMethods`** — not enforced by REST (object can't be hidden from the API).
- **Action `disabled`** (CEL form) — silently ignored (renderer reads non-spec `enabled`).
- **Role `parent`** / **SharingRuleSchema** — manager rollup & spec sharing rules disconnected from the live engine.

### 2. 🔴 ADR-0021 analytics migration debt
Spec moved to `dataset`+`values`/`dimensions`, but: the **chart view variant** + **dashboard renderer + Studio WidgetConfigPanel** still read the *removed* legacy `object/valueField/categoryField/aggregate` shape; **report `chart`** is dead; `ReportColumn`/`ReportGrouping` are obsolete re-exports. (Same debt that invalidated the showcase dashboard/report seeds.)

### 3. 🟠 Naming drift → silent no-ops (spec key ≠ consumed key)
field `maxLength`/`minLength`/`referenceFilters`/`maxRating`; page `type`→`pageType` & `label`→`title` & `visibility`; dashboard `title` vs `label`; app `accentColor`/`badgeVariant`/`separator` (renderer reads, **not in spec**); action `disabled`→`enabled`; flow `http` vs `http_request`; skill `requiredPermissions` vs `permissions`; agent `knowledge.{topics→sources}`; webhook `object`→`object_name`, `isActive`→`active`.

### 4. 🟠 Aspirational config (rich spec, zero runtime) — prune or mark `experimental`
field enhanced-type configs (barcode/qr/slider/rating/color/location) + governance (encryption/masking/audit/dataQuality); object `enable`/versioning/partitioning/cdc/softDelete/search; agent autonomy (memory/guardrails/structuredOutput/lifecycle); tool `outputSchema`; job `retryPolicy`/`timeout`; theme rtl/density/touchTarget; translation `messageFormat:'icu'` (no ICU engine); **portal (entire)**; webhook non-HMAC auth.

### 5. 🟠 Write-only / disconnected metadata (type implies authorability it lacks)
**tool** (write-only projection — can't author a working tool as metadata); **EmailTemplateSchema** (registered, but runtime reads differently-shaped `sys_email_template`); **SharingRuleSchema** (runtime uses `sys_sharing_rule`); **spec-bridge** page/dashboard bridges orphaned (their exclusive props dead).

### 6. Inverse drift — renderer depends on UNDECLARED props
dashboard `component`/`data`/`rowField`/`columnField`; view `ObjectView` form-adapter keys; app `accentColor`/`badgeVariant`/`separator`. These break a strict `Schema.parse()`.

### 7. Designer authoring gaps (live prop, no Studio editor)
dataset `filter`/`format`/`derived`/`dateGranularity`; skill `triggerConditions` (the activation-critical field); flow `notify` (absent from static palette).

## Healthiest vs worst
- **Healthiest** (near-total liveness, model schemas): **hook**, **validation**.
- **Worst**: **policy** (100% dead), **portal** (100% dead), **tool** (write-only).

## Suggested ADRs
1. **Security enforcement** (cluster #1) — highest priority; either enforce or remove every parsed-but-unenforced security prop.
2. **Finish ADR-0021** (cluster #2) — migrate chart/dashboard/report renderers + Studio off the legacy inline shape.
3. **Spec hygiene** (clusters #3–#7) — normalize naming drift, prune aspirational config, reconcile write-only/disconnected types, declare the undeclared-but-read props, close designer authoring gaps.
