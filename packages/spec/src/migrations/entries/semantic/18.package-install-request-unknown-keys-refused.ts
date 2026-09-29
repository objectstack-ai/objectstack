// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// Registered as a structured TODO (ADR-0087 D3) rather than a conversion (D2),
// for the reason every strictness entry gives: an arbitrary unknown key has no
// mapping target, and deleting it automatically is the silent data loss
// ADR-0078 bans. Nothing is retired either — no key leaves the declaration —
// so there is no RETIRED_KEYS entry: the refusal is the shape's own strict
// close naming the key. HTTP-only, like the list-pagination entry beside it:
// nobody authors a PackageInstallRequest into a metadata source and nothing
// persists one, so `objectstack migrate meta` has no file to rewrite and the
// TODO lands with whoever builds the request body.
export const entry: SemanticMigration = {
  id: 'package-install-request-unknown-keys-refused',
  // No backticks in `surface` — build-upgrade-guide.ts renders it inside a
  // code span AND a table cell.
  surface:
    'api.installPackage request body, WRAPPED form — an undeclared TOP-LEVEL key beside '
    + 'manifest on POST /api/v1/packages (PackageInstallRequestSchema, the wrapped branch of '
    + 'PackageInstallBodySchema)',
  replacement:
    'the declared wrapped body: `manifest`, plus any of the declared install options '
    + '(`settings`, `enableOnInstall`, `overwrite`, `platformVersion`, `artifactRef`). A '
    + 'misspelled option is respelled as the option it meant — `enabledOnInstall` → '
    + '`enableOnInstall`, which the refusal itself offers — and any other undeclared key is '
    + 'removed. The bare form (a manifest as the whole body) is unchanged: it was already '
    + 'closed, and it still carries no install options.',
  reason:
    'One rule for the whole install contract (the maintainer\'s ruling of 2026-09-27, option A: '
    + 'the wrapped form refuses an unknown top-level key by name). The manifest and the bare form '
    + 'already refused an unknown key by '
    + 'name; the wrapped top level was the one position still declared strip mode, so '
    + '`{ manifest, enabledOnInstall: false }` — a misspelled `enableOnInstall` — parsed green '
    + 'with the key DROPPED, and the install door, which answers exactly what this declaration '
    + 'says since it parses the whole body (c02fa1276), installed the package ENABLED: the '
    + 'caller\'s explicit `false` inverted, with no word said. The sentence that had forbidden '
    + 'this close rested on «the declaration must not refuse a body the door answers 201 to», '
    + 'which held only while the door did not parse its body; with the door answering per '
    + 'declaration the premise became circular and constrains nothing. No alias and no grace '
    + 'window. Not losslessly convertible: an unknown key has no mapping target, and '
    + 'auto-deleting it would repeat the silent drop this closes, so each occurrence needs the '
    + 'caller\'s decision — respell or remove. First-party reach measured before the close: '
    + 'the SDK install call sends only `manifest`, `settings`, `enableOnInstall` and '
    + '`overwrite`, and the objectui package dialog sends only `{ manifest }`, so no in-repo '
    + 'caller breaks. Out-of-repo callers are NOT MEASURED — a caller that sends a private '
    + 'top-level key now gets a 400 naming it.',
  acceptanceCriteria:
    'Every wrapped install body carries only `manifest` and declared install options. A body '
    + 'with any other top-level key is refused `400` / `VALIDATION_ERROR` at POST '
    + '/api/v1/packages with the key named and nothing installed, and PackageInstallRequestSchema '
    + 'answers the same body with one `unrecognized_keys` issue at the top level naming the '
    + 'key. `{ manifest }` alone, and `manifest` with every declared option, parse and install '
    + 'exactly as before.',
};
