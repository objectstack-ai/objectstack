// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'package-api-contracts-unmounted-entries-retired',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span.
  surface:
    'api.PackageApiContracts.upgradePackage / api.PackageApiContracts.resolveDependencies / '
    + 'api.PackageApiContracts.uploadArtifact — the three contract-map entries that bound '
    + 'POST /api/v1/packages/upgrade, POST /api/v1/packages/resolve-dependencies and '
    + 'POST /api/v1/packages/upload',
  replacement:
    'nothing — no route serves any of the three paths, so there is no entry to read instead. '
    + 'Delete every read of `PackageApiContracts.upgradePackage`, '
    + '`PackageApiContracts.resolveDependencies` and `PackageApiContracts.uploadArtifact`, and every '
    + 'URL built from them or from the three hard-coded paths: a request to any of them was never '
    + 'answered. The per-route request/response schemas (`PackageUpgradeRequestSchema`, '
    + '`PackageUpgradeResponseSchema`, `ResolveDependenciesRequestSchema`, '
    + '`ResolveDependenciesResponseSchema`, `UploadArtifactRequestSchema`, '
    + '`UploadArtifactResponseSchema`) stay published, bound to no route. The four surviving entries '
    + '(`listPackages`, `getPackage`, `installPackage`, `uninstallPackage`) are unchanged. If the '
    + 'platform later serves a package upgrade, dependency-resolution or upload route, its entry '
    + 'arrives in the same change that mounts it.',
  reason:
    'Maintainer ruling 2026-09-23 on #19116 (director seat, decision batch #217 item 4, letter A, '
    + '「217 同意」). The contract map is the declaration SDKs, codegen and AI clients are entitled to '
    + 'trust, and three of its seven entries named paths the composed runtime mounts nowhere: the '
    + 'package dispatcher has no branch for a single-segment POST under /packages and '
    + '`@objectstack/rest` mounts only /packages/publish there, so all three answered handled=false '
    + 'while the four surviving entries answer 200/201 (measured on one HttpDispatcher over a real '
    + 'SchemaRegistry, #18604) — and the generated reference page printed '
    + 'all three as live endpoints. Unlike `installPackage` (#18058, rebound onto the serving '
    + 'POST /api/v1/packages), no serving door existed to rebind them onto, and mounting three '
    + 'capabilities with zero measured pull was ruled out (ADR-0049 enforce-or-remove). Zero '
    + 'consumers measured at the retiring PR\'s base: across this repository the three paths occur '
    + 'only in the declaring file, its unit test and the generated page, and the pinned objectui '
    + 'checkout names none of the three keys, none of the paths and not `PackageApiContracts` '
    + 'itself. A contract-map entry is not metadata — nothing authors, stores or parses it — so '
    + 'there is no source a D2 conversion could rewrite, and the removal is recorded here.',
  acceptanceCriteria:
    'No code reads `PackageApiContracts.upgradePackage`, `.resolveDependencies` or '
    + '`.uploadArtifact` from `@objectstack/spec` or `@objectstack/spec/api` — each is a TS2339 '
    + 'property error after upgrade, and at runtime the key is absent (pinned in '
    + 'api/package-api.test.ts together with the rule that no surviving entry is bound to any of the '
    + 'three paths). No client, route table or generated artefact of yours still names '
    + 'POST /api/v1/packages/upgrade, /resolve-dependencies or /upload. No metadata document needs '
    + 'editing. ⚠️ Runtime behaviour is deliberately UNCHANGED: nothing ever mounted the three paths '
    + 'or built a route from the entries, so every request answers exactly as before — the removal '
    + 'retracts a false claim, not a capability.',
};
