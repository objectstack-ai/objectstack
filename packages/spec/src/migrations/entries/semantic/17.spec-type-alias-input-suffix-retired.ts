// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'spec-type-alias-input-suffix-retired',
  // Plain text, no markdown: build-upgrade-guide.ts renders this field inside a
  // code span AND inside a table cell, so backticks here break both.
  surface:
    'type alias: the 102 XInput names of @objectstack/spec '
    + '(ConnectorInput, AppInput, PageInput, ActionInput, ServiceObjectInput, '
    + 'ExecutionContextInput, TaskInput, … — 52 files across api/ automation/ data/ '
    + 'identity/ integration/ kernel/ security/ system/ ui/)',
  replacement:
    'the BARE name. ADR-0122 phase 2 moved the author state onto `X`, which makes `XInput` '
    + 'a character-for-character synonym of it — the permanent synonym D3 forbids. Drop the '
    + '`Input` suffix: `ConnectorInput` -> `Connector`. Symmetrically, a consumer that held '
    + 'a PARSE RESULT under the bare name moves to `XParsed`, which phase 1 (16.x) already '
    + 'declared for every schema whose two shapes differ, so the target name has existed for '
    + 'a release. NINE `*Input` names are NOT retired and need no edit: `ExpressionInput`, '
    + '`CronExpressionInput`, `TemplateExpressionInput` and `PredicateInput` are the bare '
    + 'aliases of their own `…InputSchema`, and `FormFieldInput`, `QueryInput`, `FieldInput`, '
    + '`ObjectStackDefinitionInput` and `NavigationItemInput` are composed (recursive or '
    + '`Partial`-shaped) types no bare alias denotes.',
  reason:
    'This entry exists for the reason `data-driver-find-stream-retired` (#4484), '
    + '`storage-service-list-retired` (#5540) and `actor-user-roles-to-positions` (#6011) '
    + 'exist, and it is the same disposition: the surface is a TYPESCRIPT NAME, never stack '
    + 'metadata, so there is no source for a D2 conversion to rewrite and deliberately no '
    + 'schema tombstone — an `XInput` alias never had a carrier key, never emitted a def, '
    + 'and no `.parse()` ever saw it. Measured and verified rather than assumed: '
    + '`json-schema/`, `json-schema.manifest/` and `authorable-surface/` are BYTE-IDENTICAL '
    + 'across this change, because those generators enumerate runtime `z.ZodType` exports '
    + 'and never read a type alias. So nothing left the published metadata surface and '
    + 'RETIRED_DEFS_BY_MAJOR is deliberately untouched — an entry there would falsely claim '
    + 'the metadata contract shrank. The enforced channel is tsc: the name is gone, so every '
    + 'consumer gets TS2724/TS2305 naming the import. That is loud but MUTE about the '
    + 'replacement — a compile error says `ConnectorInput` does not exist, not that '
    + '`Connector` now means what it meant. The generated upgrade guide is the only channel '
    + 'that carries the second half, which is precisely the #6048 gap ADR-0087 registration '
    + 'exists to close. ⚠️ Deliberately NOT registered alongside it: the 1384 bare aliases '
    + 'the same change FLIPPED from `z.infer` to `z.input`. Those names all still exist and '
    + 'still resolve; what moved is which of a schema\'s two shapes they denote, and only '
    + 'where the two differ (663 of 1384 — the rest are isomorphic and the flip is a no-op '
    + 'there, pinned as such). A consumer holding an authored literal is made MORE correct '
    + 'by it, silently; one holding a parse result gets a tsc error at the first defaulted '
    + 'key it reads. Registering that as a rename would misdescribe it — no name was '
    + 'retired — and the changeset carries its own FROM -> TO for it. ADR-0122 D8/D9, '
    + '#6083 (PR #6279).',
  acceptanceCriteria:
    'No source imports a name ending `Input` from `@objectstack/spec` except the nine listed '
    + 'above: `rg "\\b\\w+Input\\b" --type ts` over consumer code resolves only to those. A '
    + 'literal annotated with a bare spec type compiles while listing ONLY the keys the '
    + 'author means — `const c: Connector = { name, label, type }` type-checks, which it did '
    + 'not in 16.x — and a value read out of `XSchema.parse()` annotated with the bare name '
    + 'no longer compiles at the first defaulted key it reads (TS18048/TS2532), the signal '
    + 'that the annotation should be `XParsed`. `pnpm check:spec-parsed-alias` reports every '
    + 'bare alias as `z.input` and refuses both a bare `z.infer` alias and a reintroduced '
    + '`XInput` synonym.',
};
