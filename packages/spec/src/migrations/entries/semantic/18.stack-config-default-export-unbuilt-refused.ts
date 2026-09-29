// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// One authoring shape for a stack config (the one-authoring-shape ruling). No D2 conversion:
// the change is to the config MODULE's shape (what its default export is), not
// to any metadata key, so there is nothing `objectstack migrate meta` could
// rewrite in a stored row or a parsed stack — the fix is one wrapping call in
// the author's source.
//
// No backticks in `surface` — build-upgrade-guide.ts renders it inside a code
// span already, and a nested backtick would close it.
export const entry: SemanticMigration = {
  id: 'stack-config-default-export-unbuilt-refused',
  surface:
    'the default export of objectstack.config.ts when it is not the value defineStack or composeStacks '
    + 'returned: a plain object literal, a spread or Object.assign copy of a built stack, a JSON copy of '
    + 'one, a module with no default export — and each input handed to composeStacks',
  replacement:
    'export what the producer returned: `import { defineStack } from \'@objectstack/spec\'; export default '
    + 'defineStack({ … });` with every stack key inside the call (`api`, `plugins`, `requires`, …), or '
    + '`export default composeStacks([defineStack({ … }), …])`. Named exports beside it (`onEnable`, '
    + '`functions`) are unaffected. `defineStack(config, { strict: false })` also satisfies the doors — it '
    + 'is still the producer — but skips its judgement, so reserve it for sources a strict parse cannot yet read',
  reason:
    'The stack family\'s cross-field refusals — unknown `requires` capability, cross-references to objects '
    + 'the stack does not define, the namespace prefix, one app per app package, the hierarchy-scope and '
    + 'trigger capability requirements — run inside `defineStack` and nowhere else. A config exporting a '
    + 'plain object skipped all of them: `objectstack validate` and `objectstack build` ran only the schema '
    + 'parse, answered success, and the build shipped the artifact, so the defect surfaced at deploy or '
    + 'never (a trigger flow that silently never fires). Judging the export at the door instead is not '
    + 'possible: a built stack carries each bound standalone action twice (top level and merged into its '
    + 'object), so re-running the family on `defineStack` output refuses every correct project with a bound '
    + 'action. So both producers stamp a non-enumerable provenance mark on what they return '
    + '(`hasStackProvenance`), and `objectstack validate` / `objectstack build` refuse an unmarked default '
    + 'export right after load with `STACK_PROVENANCE_MISSING` (exit 1), before any other judgement; '
    + '`composeStacks` refuses an unmarked input with the same code. A copy of a built stack is refused '
    + 'too, because the mark does not survive a spread or JSON round-trip — by design, since the copy is '
    + 'not what the producer judged. ⚠️ No D2 conversion: the module shape is source code, not metadata. '
    + '`objectstack serve`, `objectstack migrate` and `objectstack lint` load the config as before. ADR-0087.',
  acceptanceCriteria:
    'Run `objectstack validate` (and `objectstack build`) in every project. A refusal prints '
    + '`objectstack.config.ts: the default export was not built by defineStack` and, under `--json`, carries '
    + '`code: STACK_PROVENANCE_MISSING`. Wrap the export in `defineStack({ … })`, move any key that was '
    + 'spread onto a copy inside the call, and re-run: the command either passes or now reports the stack '
    + 'family\'s own findings (`STACK_CAPABILITY_UNKNOWN`, `STACK_CROSS_REFERENCE_INVALID`, …) that the plain '
    + 'export had been hiding — fix those as each message prescribes. A project already exporting '
    + '`defineStack(...)` or `composeStacks([...])` of `defineStack` inputs is unaffected and passes '
    + 'byte-identically.',
};
