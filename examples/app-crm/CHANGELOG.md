# @objectstack/example-crm

## 4.0.35

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
  - @objectstack/spec@7.7.0
  - @objectstack/runtime@7.7.0

## 4.0.34

### Patch Changes

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [55866f5]
- Updated dependencies [8e539cc]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/runtime@7.6.0

## 4.0.33

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/runtime@7.5.0

## 4.0.32

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/runtime@7.4.1

## 4.0.31

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [394d34f]
- Updated dependencies [82eb6cf]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/runtime@7.4.0

## 4.0.30

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/runtime@7.3.0

## 4.0.29

### Patch Changes

- Updated dependencies [9096dfe]
  - @objectstack/runtime@7.2.1
  - @objectstack/spec@7.2.1

## 4.0.28

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/runtime@7.2.0

## 4.0.27

### Patch Changes

- 47a92f4: Promote `email_template` to a first-class metadata type using the canonical
  `EmailTemplateDefinitionSchema`.

  Previously `email_template` had two competing Zod schemas (Prime Directive
  #8 violation): the legacy `EmailTemplateSchema` (a sub-shape of
  `Notification`) and the richer `EmailTemplateDefinitionSchema`. The runtime
  metadata protocol (`packages/objectql/src/protocol.ts`) and Studio's
  property panel registered the legacy one, which is why all the new fields
  (`name`, `label`, `category`, `locale`, `bodyHtml`, `bodyText`, …) were
  reported as “declared in form layout but missing from schema”.

  This change:

  - Repoints the `email_template` entry in `TYPE_TO_SCHEMA`
    (`packages/objectql/src/protocol.ts`) and in
    `BUILTIN_METADATA_TYPE_SCHEMAS`
    (`packages/spec/src/kernel/metadata-type-schemas.ts`) to
    `EmailTemplateDefinitionSchema`. The legacy `EmailTemplateSchema` is
    kept only as an inline sub-shape inside `Notification`.
  - Adds an `emailTemplates` collection to `defineStack()` input
    (`packages/spec/src/stack.zod.ts`), registers it in
    `MAP_SUPPORTED_FIELDS`/`PLURAL_TO_SINGULAR`
    (`packages/spec/src/shared/metadata-collection.zod.ts`), wires it into
    `ARTIFACT_FIELD_TO_TYPE` (`packages/metadata/src/plugin.ts`) and
    `APP_CATEGORY_KEYS` (`packages/runtime/src/app-plugin.ts`).
  - Rewrites `packages/spec/src/system/email-template.form.ts` for the new
    schema with sections for Identity, Subject, HTML body, Plain-text body,
    Variables, Delivery overrides, Status.
  - Ships three reference templates in `examples/app-crm/src/emails/`:
    `crm.deal_won` (rewritten to canonical shape), `crm.welcome` (new),
    `crm.lead_followup` (new), and wires them into the CRM stack via
    `emailTemplates: Object.values(emails)`.

  End-to-end verified in Studio: list view at
  `/_console/apps/studio/metadata/email_template` shows all three entries;
  the detail view renders the EmailTemplatePreview iframe and the property
  panel cleanly renders every canonical field (no missing-schema warnings).
  `GET /api/v1/meta` now returns the new `properties` set
  (`name, label, category, locale, subject, bodyHtml, bodyText, variables,
fromOverride, replyTo, active, isSystem, description`).

- Updated dependencies [47a92f4]
  - @objectstack/spec@7.1.0
  - @objectstack/runtime@7.1.0

## 4.0.26

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [3a630b6]
  - @objectstack/spec@7.0.0
  - @objectstack/runtime@7.0.0

## 4.0.25

### Patch Changes

- Updated dependencies [bac7ae5]
  - @objectstack/runtime@6.9.0
  - @objectstack/spec@6.9.0

## 4.0.24

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/runtime@6.8.1

## 4.0.23

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [50ccd9c]
  - @objectstack/spec@6.8.0
  - @objectstack/runtime@6.8.0

## 4.0.22

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/runtime@6.7.1

## 4.0.21

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [c5efe15]
- Updated dependencies [4944f3a]
- Updated dependencies [e0c593f]
  - @objectstack/spec@6.7.0
  - @objectstack/runtime@6.7.0

## 4.0.20

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/runtime@6.6.0

## 4.0.19

### Patch Changes

- @objectstack/runtime@6.5.1
- @objectstack/spec@6.5.1

## 4.0.18

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/runtime@6.5.0

## 4.0.17

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/runtime@6.4.0

## 4.0.16

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/runtime@6.3.0

## 4.0.15

### Patch Changes

- Updated dependencies [b4c74a9]
- Updated dependencies [dbb54e1]
  - @objectstack/spec@6.2.0
  - @objectstack/runtime@6.2.0

## 4.0.14

### Patch Changes

- @objectstack/runtime@6.1.1
- @objectstack/spec@6.1.1

## 4.0.13

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/runtime@6.1.0

## 4.0.12

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/runtime@6.0.0

## 4.0.11

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [b806f58]
  - @objectstack/spec@5.2.0
  - @objectstack/runtime@5.2.0
  - @objectstack/plugin-webhooks@5.2.0
  - @objectstack/driver-mongodb@5.2.0
  - @objectstack/service-analytics@5.2.0
  - @objectstack/service-automation@5.2.0

## 4.0.10

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/driver-mongodb@5.1.0
  - @objectstack/runtime@5.1.0
  - @objectstack/service-analytics@5.1.0
  - @objectstack/service-automation@5.1.0

## 4.0.9

### Patch Changes

- Updated dependencies [5e9dcb4]
- Updated dependencies [96ad4df]
- Updated dependencies [df18ae9]
- Updated dependencies [2f9073a]
  - @objectstack/runtime@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/driver-mongodb@5.0.0
  - @objectstack/service-analytics@5.0.0
  - @objectstack/service-automation@5.0.0

## 4.0.8

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/runtime@4.2.0
  - @objectstack/driver-mongodb@4.2.0
  - @objectstack/service-analytics@4.2.0
  - @objectstack/service-automation@4.2.0

## 4.0.7

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/runtime@4.1.1
- @objectstack/driver-mongodb@4.1.1
- @objectstack/service-analytics@4.1.1
- @objectstack/service-automation@4.1.1

## 4.0.6

### Patch Changes

- fcc54fd: chore(example-crm): cull duplicate/low-value reports

  Remove three reports from the CRM example that didn't pass the
  "Report vs. Dashboard" value test:

  - `LeadsBySourceReport` (single-dim count by `lead_source`) — fully
    redundant with the sales dashboard's "Lead Source" pie tile.
  - `ContactsByAccountReport` — really a Contact List View grouped by
    account, not a report.
  - `TasksByOwnerReport` — single-dim count, not navigated anywhere.

  Remaining 10 reports keep full shape coverage: summary (2), matrix (4),
  joined (2), multi-pane (1) plus a chartful summary.

- Updated dependencies [2108c30]
- Updated dependencies [96fb108]
- Updated dependencies [23db640]
- Updated dependencies [70db902]
- Updated dependencies [70db902]
  - @objectstack/spec@4.1.0
  - @objectstack/runtime@4.1.0
  - @objectstack/driver-mongodb@4.1.0
  - @objectstack/service-analytics@4.1.0
  - @objectstack/service-automation@4.1.0

## 4.0.5

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/runtime@4.0.5
  - @objectstack/driver-mongodb@4.0.5
  - @objectstack/service-automation@4.0.5
  - @objectstack/service-analytics@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2

## 3.0.26

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0

## 3.0.25

### Patch Changes

- @objectstack/spec@3.3.1

## 3.0.24

### Patch Changes

- @objectstack/spec@3.3.0

## 3.0.23

### Patch Changes

- @objectstack/spec@3.2.9

## 3.0.22

### Patch Changes

- @objectstack/spec@3.2.8

## 3.0.21

### Patch Changes

- @objectstack/spec@3.2.7

## 3.0.20

### Patch Changes

- @objectstack/spec@3.2.6

## 3.0.19

### Patch Changes

- @objectstack/spec@3.2.5

## 3.0.18

### Patch Changes

- @objectstack/spec@3.2.4

## 3.0.17

### Patch Changes

- @objectstack/spec@3.2.3

## 3.0.16

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2

## 3.0.15

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1

## 3.0.14

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0

## 3.0.13

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1

## 3.0.12

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8

## 1.2.16

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7

## 1.2.15

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6

## 1.2.14

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5

## 1.2.13

### Patch Changes

- Updated dependencies [d738987]
  - @objectstack/spec@3.0.4

## 1.2.12

### Patch Changes

- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3

## 1.2.11

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2

## 1.2.10

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1

## 1.2.9

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0

## 1.2.8

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7

## 1.2.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.6

## 1.2.6

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5

## 1.2.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.4

## 1.2.4

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.3

## 1.2.3

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2

## 1.2.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.1

## 1.2.1

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0

## 0.9.15

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.12

## 0.9.14

### Patch Changes

- @objectstack/spec@1.0.11

## 0.9.13

### Patch Changes

- @objectstack/spec@1.0.10

## 0.9.12

### Patch Changes

- @objectstack/spec@1.0.9

## 0.9.11

### Patch Changes

- @objectstack/spec@1.0.8

## 0.9.10

### Patch Changes

- @objectstack/spec@1.0.7

## 0.9.9

### Patch Changes

- Updated dependencies [a7f7b9d]
  - @objectstack/spec@1.0.6

## 0.9.8

### Patch Changes

- Updated dependencies [b1d24bd]
  - @objectstack/spec@1.0.5

## 0.9.7

### Patch Changes

- @objectstack/spec@1.0.4

## 0.9.6

### Patch Changes

- @objectstack/spec@1.0.3

## 0.9.5

### Patch Changes

- Updated dependencies [a0a6c85]
- Updated dependencies [109fc5b]
  - @objectstack/spec@1.0.2

## 0.9.4

### Patch Changes

- @objectstack/spec@1.0.1

## 0.9.3

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.9.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.2

## 0.9.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.9.1

## 0.7.5

### Patch Changes

- Updated dependencies [555e6a7]
  - @objectstack/spec@0.8.2

## 0.7.4

### Patch Changes

- @objectstack/spec@0.8.1

## 0.7.3

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 0.7.2

### Patch Changes

- Updated dependencies [fb41cc0]
  - @objectstack/spec@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.7.1

## 0.6.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.6.1

## 0.6.0

### Minor Changes

- b2df5f7: Unified version bump to 0.5.0

  - Standardized all package versions to 0.5.0 across the monorepo
  - Fixed driver-memory package.json paths for proper module resolution
  - Ensured all packages are in sync for the 0.5.0 release

### Patch Changes

- Updated dependencies [b2df5f7]
  - @objectstack/spec@0.6.0

## 1.0.9

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.4.2

## 1.0.8

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.4.1

## 1.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.3.3

## 1.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@0.3.2

## 1.0.5

### Patch Changes

- @objectstack/spec@0.3.1

## 1.0.4

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.0

## 1.0.3

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.3.0

## 1.0.2

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.2.0

## 1.0.1

### Patch Changes

- Updated dependencies
  - @objectstack/spec@0.1.2
