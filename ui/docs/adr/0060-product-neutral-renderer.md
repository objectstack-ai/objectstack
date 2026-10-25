# ADR-0060: objectui is a product-neutral renderer

**Status**: Accepted — maintainer ruling (2026-10-12); this record and its ratchet land on the maintainer's approval
**Consumers**: every product that renders through objectui (ObjectStack Cloud, HotCRM, any app built on the stack); `@object-ui/app-shell` and `@object-ui/types`, which carry today's product-specific surfaces; `@object-ui/i18n`, whose built-in catalogues carry their copy
**Enforced by**: `packages/app-shell/src/__tests__/product-neutral-renderer.ratchet.test.ts`, its live list `product-specific.allowlist.json` beside it, and the frozen-baseline block at the end of this record

---

## The ruling

Two answers, given in chat on 2026-10-12, quoted verbatim and untranslated:

> 现在转向

> 规则应该写入 objectui 仓库，要不然每个项目都会有页面定制的需求

The first turned the cloud console's pages away from objectui widgets: those pages stay metadata, objectui
ships only product-agnostic blocks, and no new `cloud:*` widget is added. The second placed the rule here,
in the renderer's own repository rather than in any consumer's, because every product would otherwise bring
its own page customisations to it.

## Decision

1. **objectui is a product-neutral renderer.** A product — cloud, HotCRM, any app — composes its pages from
   the generic blocks of `@objectstack/spec`'s page vocabulary and keeps its copy in its own bundles.
2. **A page that cannot be composed is fixed generically.** The fix is a **generic** block in objectui, named
   for what it draws (`stat`, `usage-bar`, `checklist`), or a **contract door** in `@objectstack/spec`
   (`needs:contract-review`). Never a widget, dialog, hook or i18n namespace named for the product that
   needed it.
3. **What already exists stays until its page migrates, and may only shrink.**

`AGENTS.md` › "Product-neutral renderer" carries the same three rules for every agent that edits this
repository.

## Why

The cloud control plane had accreted into this repository: registered widgets, the environment pages under
`app-shell/src/environment/` (the environment list toolbar, the paywall dialog, the entitlements hook), the
organization pages under `app-shell/src/console/organizations/`, and the copy all of them read from the
built-in locale catalogues. Every cloud wording change became an objectui pull request plus a pin bump; one
lane waited on cloud for a single plan-tier string. The next consumer would have done the same.

## The ratchet

The test named above runs in the root `unit` project, so every `pnpm test` runs it; because it reads the
tree off disk, the affected-test selector puts it in every pull request's fast set as well. It measures
three populations from the tree on every run:

- **Registrations** — every component registry key that `deriveRegistryKeys`
  (`scripts/check-doc-component-types.mjs`, the one registration reader `objectui check` and the doc-type
  gate already share) produces, whose colon-separated segment leads with a product word.
- **Files** — every non-test file under `packages/`, `apps/` and `examples/` that sits in a frozen
  directory, or whose path has a segment led by a product word.
- **Locale keys** — in every built-in locale, every leaf key under a frozen namespace, and every key, at any
  depth, whose own name leads with a product word.

Two lists bound them:

- **The live list**, `product-specific.allowlist.json`, must equal the measurement exactly. An unlisted hit
  is a new product-specific surface and turns the test red; a listed entry the tree no longer has is stale and
  turns it red too, which is what makes the list shrink as pages migrate. It is edited only to delete.
- **The ceiling** is the frozen-baseline block below. Every live entry must be in it, and it also carries the
  rules: the product words, the frozen directories and the frozen namespaces. This file is a governed
  surface, so the one way a new product-specific entry can turn the test green is an amendment to this
  record that the maintainer approves. Appending to the live list alone stays red. The block is the gate's
  input, not a census: the census is what the test derives.

What the ratchet cannot see, stated so that a green run is not read as more than it is:

- product code under a neutral name outside the frozen directories — a `PaywallDialog` in `views/`. Names
  are all it reads; the rest is left to review, which the template's checkbox prompts only on web-form PRs;
- growth inside an existing file — the file half counts files, not lines;
- registration spellings the derivation reads under a premise that does not hold, which its own header lists
  as KNOWN GAP readings. A spelling it does not recognise is a finding, and a finding turns the ratchet red
  instead of shrinking the population;
- re-adding something the live list already deleted, because the ceiling keeps the entry until an amendment
  drops it.

## Readings taken where the card was literal

### Product words

`cloud` and `hotcrm`, the two products the ruling's own text names. A name is product-named when a product
word **leads** it at a word boundary: `cloud`, `cloud-connection`, `cloudOnboarding`, `CloudPlanStatus.tsx`,
`HotCRM`. A hook's leading `use` is skipped first, so `useCloudThing` counts, because the ruling names hooks.
Leading, not anywhere: `word-cloud` names a chart, and `cloudy` is not `cloud`. A generic block whose natural
name starts with a product word takes another name. The vocabulary grows by amending this record, and
shrinking it is a weakening that needs the same approval.

### Registrations: both spellings, from the one reader

A registration stores its key in two spellings: `register('cloud:x', C)`, and
`register('x', C, { namespace: 'cloud', skipFallback: true })`, which stores `cloud:x` and no bare `x`. Two
of today's four cloud widgets use the second spelling, so a scan for the literal `register('cloud:` would
have seen half of them. The ratchet does not scan at all; it reads the keys `deriveRegistryKeys` already
derives for `objectui check`, which resolves both spellings and treats an options argument it cannot read as
a finding. A fixture control in the test pins both spellings against a synthetic tree, so the namespace half
stays proven after the last product widget has migrated away. The same reader found a fifth product
registration the card's inventory did not list, `cloud-connection:panel`; it and the `app-shell:`-namespaced
twin each registration stores are all in the baseline.

### Frozen directories, test files, and product-named files

`app-shell/src/environment/` and `app-shell/src/console/organizations/` are frozen **recursively**:
`organizations/manage/` holds the organization-management pages and is inside. Test files are outside the
file half — anything under `__tests__`, `__mocks__`, `__fixtures__`, `__benchmarks__`, `test`, `tests` or
`e2e`, and any `*.test.*`, `*.spec.*` or `*.stories.*` file. A test adds no product surface, since no test
ships in a package's `dist`, and a regression test on frozen code has to stay writable until that code
migrates.

The card named `console/home/Cloud*.tsx`. The ratchet generalises it to any non-test file whose path has a
segment led by a product word, because rule 2 is about names, not about one directory. At this record's head
that predicate also finds `console/cloud-connection/CloudConnectionPanel.tsx`,
`console/diagnostics/CloudAiModelStatus.tsx`, and `@object-ui/types`' `cloud.ts` and `zod/cloud.zod.ts`,
which declare the cloud widgets' node types. All of them are in the baseline.

### Locale keys: what "a new top-level namespace" means here

Read literally, the card's clause fails on **any** new top-level namespace, and its list may only lose
entries. Taken together, those two sentences would forbid every new namespace forever, including the copy
for the generic blocks rule 2 asks for. That contradicts the rule the clause enforces. The reading taken
instead follows rule 2's own words, "never an i18n namespace named for the product":

- a namespace, or a key at any depth, whose name leads with a product word fails unless a frozen namespace
  holds it;
- under a frozen namespace, no key may be added in any locale;
- a new namespace with a neutral name passes, and generic block copy goes there.

The price is the first bound above: product copy filed under a neutral name, outside the frozen namespaces,
is review's to catch, not the test's.

### Frozen namespaces

- **Led by a product word**: `cloudConnection`, `cloudOnboarding`, `cloudPlanStatus`,
  `cloudWorkspaceTimezoneNotice`.
- **Named by the card's inventory**: `organizations` and `workspace`, and `environment`. The card named
  `environment.entitlement`; the whole `environment` namespace is frozen because every source consumer of
  its keys sits in the frozen `environment/` directory, which makes the namespace that directory's copy.
- **Measured, beyond the card's inventory**: `planTier`, whose one consumer is the environment list toolbar
  in the frozen directory, and `aiModelStatus`, whose one consumer is the `cloud:ai-model-status` widget.
- **Considered and not frozen**: `organization` (singular), whose keys are also read by the layout's
  organization indicator and switcher and by `@object-ui/auth`; `chatbotQuota`, which
  `@object-ui/plugin-chatbot` reads for a quota-exhausted state any backend can raise; and `marketplace` and
  `connectAgent`, features of the open stack. Freezing any of them is an amendment to this record.

The consumer readings above were taken once, at this record's head, and nothing re-derives them. They
explain the choice; the block below is the frozen set.

## Escalation path

A page that cannot be composed from the generic blocks is a card that names what it needs: either the generic
block, which is built here, named for what it draws, with its copy in a neutral namespace, or the contract
door in `@objectstack/spec`, which goes through `needs:contract-review` in objectstack. A card that asks
objectui for a product-named widget, dialog, hook or copy namespace is refiled in one of those two shapes.

## Consequences

- The live list shrinks as cloud's pages migrate. Each migrating pull request deletes its entries, and the
  test's stale half makes it.
- A new product-specific surface needs an amendment to this record, which only lands with the maintainer's
  approval. Appending to the live list does not turn the test green.
- A pull request opened through the web form starts with the template's checkbox; one opened through the API,
  as the fleet's are, does not. The checkbox prompts human authors; it is not a gate.
- The residuals are the four bounds listed under "The ratchet" above.

## Provenance

objectstack-ai/objectui#12224, filed from the cloud maintainer's session on 2026-10-12, carries the ruling
and the card's inventory; the pull request that adds this record carries the mutation proofs.

## Frozen baseline

The ratchet test reads this block. Edit it only by amending this record; the maintainer approves the change.

```json
{
  "productWords": ["cloud", "hotcrm"],
  "frozenDirectories": [
    "packages/app-shell/src/console/organizations",
    "packages/app-shell/src/environment"
  ],
  "registrations": [
    "app-shell:cloud-connection:panel",
    "app-shell:cloud:ai-model-status",
    "app-shell:cloud:onboarding-next",
    "cloud-connection:panel",
    "cloud:ai-model-status",
    "cloud:onboarding-next",
    "cloud:plan-status",
    "cloud:workspace-timezone-notice"
  ],
  "files": [
    "packages/app-shell/src/console/cloud-connection/CloudConnectionPanel.tsx",
    "packages/app-shell/src/console/diagnostics/CloudAiModelStatus.tsx",
    "packages/app-shell/src/console/home/CloudOnboardingNext.tsx",
    "packages/app-shell/src/console/home/CloudPlanStatus.tsx",
    "packages/app-shell/src/console/home/CloudWorkspaceTimezoneNotice.tsx",
    "packages/app-shell/src/console/organizations/CreateWorkspaceDialog.tsx",
    "packages/app-shell/src/console/organizations/OrganizationsLayout.tsx",
    "packages/app-shell/src/console/organizations/OrganizationsPage.tsx",
    "packages/app-shell/src/console/organizations/index.ts",
    "packages/app-shell/src/console/organizations/manage/AcceptInvitationPage.tsx",
    "packages/app-shell/src/console/organizations/manage/InvitationsPage.tsx",
    "packages/app-shell/src/console/organizations/manage/InviteMemberDialog.tsx",
    "packages/app-shell/src/console/organizations/manage/MembersPage.tsx",
    "packages/app-shell/src/console/organizations/manage/OrganizationLayout.tsx",
    "packages/app-shell/src/console/organizations/manage/SettingsPage.tsx",
    "packages/app-shell/src/console/organizations/manage/orgCapabilities.ts",
    "packages/app-shell/src/console/organizations/manage/orgContext.ts",
    "packages/app-shell/src/console/organizations/manage/orgEnvironments.ts",
    "packages/app-shell/src/console/organizations/orgErrorMessage.ts",
    "packages/app-shell/src/console/organizations/orgRoleLabel.ts",
    "packages/app-shell/src/console/organizations/provisionEnvironment.ts",
    "packages/app-shell/src/console/organizations/resolveHomeUrl.ts",
    "packages/app-shell/src/environment/EnvironmentEntitlementDialog.tsx",
    "packages/app-shell/src/environment/EnvironmentListToolbar.tsx",
    "packages/app-shell/src/environment/entitlements.ts",
    "packages/app-shell/src/environment/useEnvironmentEntitlements.ts",
    "packages/types/src/cloud.ts",
    "packages/types/src/zod/cloud.zod.ts"
  ],
  "i18n": {
    "aiModelStatus": ["adapter", "modelUnknown", "noOverrides", "overridesInEffect", "readFailed", "readFailedWithStatus", "rowConversational", "rowReasoning", "rowStructured", "sourceCodeDefault", "sourceInherits", "sourcePinned", "sourceUnknown", "summary", "summaryRouting"],
    "cloudConnection": ["bound.approvedBy", "bound.disconnect", "bound.environment", "bound.organization", "bound.privatePackages", "bound.runtime", "bound.runtimeId", "bound.since", "bound.title", "checking", "errors.accessDenied", "errors.bindFailed", "errors.deviceCodeFailed", "errors.expired", "retry", "unbound.body", "unbound.connect", "unbound.title", "waiting.cancel", "waiting.codePrefilled", "waiting.copied", "waiting.copy", "waiting.openApproval", "waiting.openItHere", "waiting.polling", "waiting.popupOpened"],
    "cloudOnboarding": ["createEnvironment", "hintCreate", "hintReady", "manageEnvironments", "openWorkspace"],
    "cloudPlanStatus": ["current"],
    "cloudWorkspaceTimezoneNotice": ["seeded"],
    "environment": ["addDevelopment", "developmentLocked", "entitlement.contactSalesCta", "entitlement.freePlan", "entitlement.limitBody", "entitlement.limitBodyWithCount", "entitlement.limitTitle", "entitlement.namedPlan", "entitlement.planLockedBody", "entitlement.planLockedTitle", "entitlement.productionLimitBody", "entitlement.productionLimitTitle", "entitlement.upgradeCta", "setUpProduction"],
    "organizations": ["create", "current", "emptyDescription", "emptyTitle", "heading", "manage", "mine", "new", "noMatches", "searchPlaceholder", "subtitle", "title"],
    "planTier": ["teamAndUp"],
    "workspace": ["createButton", "createDescription", "createFailed", "createTitle", "default", "invite", "label", "members", "multiOrgDisabled", "nameLabel", "namePlaceholder", "settings", "slugHint", "slugLabel", "switch"]
  }
}
```
