# Audit: AppSchema property liveness & necessity

**Date**: 2026-06-15 · **Scope**: `packages/spec/src/ui/app.zod.ts`. **Renderers**: `objectui` `layout/NavigationRenderer.tsx`, `app-shell` `{AppSidebar,ConsoleLayout,AppContent}`. **Method**: consumer cross-reference.

## 🔴 Spec↔renderer drift — renderer reads fields the spec doesn't declare (would be stripped by `AppSchema.parse()`)
- `branding.accentColor` — consumed `AppShell.tsx:160-165`, **absent from `AppBrandingSchema`**
- nav-item `badgeVariant` — consumed `NavigationRenderer.tsx:850/890`, absent from `BaseNavItemSchema`
- nav-item `type:'separator'` — rendered `NavigationRenderer.tsx:574/774`, **not a union member** in app.zod.ts

These are the highest-priority fixes (authoring them per spec fails; they only work because parse is bypassed somewhere).

## DEAD — aspirational, no consumer in either repo
`version`, `aria`, `objects[]`, `apis[]`, `App.sharing`, `App.embed`, `mobileNavigation`/`bottomNavItems` (fully unimplemented — even `packages/mobile` ignores it), `branding.logo` (passed at `ConsoleLayout.tsx:117` but never read in `AppShell`).
- **Misleading**: `App.sharing`/`App.embed` attach Sharing/Embed config to apps, but the only live sharing/embed path is `FormView.sharing` (`framework/.../rest-server.ts:3282`) — no public-app or iframe route reads the app-level versions.
- The spec itself labels `objects[]`/`apis[]` "config convenience"; the chatbot's object list comes from nav items (`AppHeader.tsx:500 collectNavObjects`), not `App.objects`.

## LIVE & necessary (the sidebar core — all camelCase, no snake drift)
`name`, `label`, `description`, `icon`, `active`, `isDefault`, `hidden`, `navigation` (whole tree), `areas` (precedence over navigation), `contextSelectors` (all sub-fields), `homePageId`, `defaultAgent` (dual consumer: framework `agent-runtime.ts:341` + objectui chatbot), `branding.{primaryColor,favicon}`, `protection`. Nav-item union fully live: `id/label/icon/order/badge/visible(CEL)/requiredPermissions/requiresObject/requiresService` + per-type payloads (`objectName/viewName/recordId/recordMode/dashboardName/pageName/url/target/reportName/componentRef/params/children/expanded`). NavigationContribution (ADR-0029) live via `objectql/engine.ts:912`.
- PARTIAL: `App.requiredPermissions` (app-entry gate not observed; only nav-item perms enforced), nav `type:'action'` `actionDef` (fires `onAction(item)`; `actionDef.{actionName,params}` shape read loosely in the action runtime, 0 direct grep in shell).

## Recommendation
Add the 3 drift fields to the spec (`accentColor`, `badgeVariant`, `separator`) **or** stop the renderer reading them. Prune the aspirational block; `App.sharing`/`App.embed`/`apiEnabled`-style props create a false security/feature impression.
