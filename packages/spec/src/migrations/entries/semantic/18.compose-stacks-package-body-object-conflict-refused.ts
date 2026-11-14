// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

// #32516. An accept-set narrowing of composeStacks under objectConflict
// 'override' / 'merge': an object name that sits in a package body of the
// composed artifact and is declared again by another input is refused. No D2
// conversion: which package keeps the name, and whether the other extends it
// instead, is the author's call.
export const entry: SemanticMigration = {
  id: 'compose-stacks-package-body-object-conflict-refused',
  surface:
    'composeStacks(stacks, { objectConflict: \'override\' | \'merge\' }) — one object name declared by two inputs '
    + 'when at least one declaration sits in a package body of the composed artifact: (1) an input carrying '
    + 'packages[] (a nested artifact) whose package body declares the name while its own top-level objects carry '
    + 'it too, beside another input declaring it, under any manifest option; (2) under manifest: \'preserve\', two '
    + 'inputs with a manifest that both declare the name; (3) under manifest: \'preserve\', an input with a '
    + 'manifest beside a manifest-less input that declares the name',
  replacement:
    'Rename one of the two objects (and every reference that meant it), or contribute to the other package\'s '
    + 'object through objectExtensions instead of declaring it again. Where the packages need not stay separate, '
    + 'compose them as flat inputs (each a stack of its own, no packages[]) under the default manifest with '
    + 'objectConflict \'override\' or \'merge\', which still reconcile the two into one object. Under '
    + 'manifest: \'preserve\' each package keeps its own body, so there only renaming or objectExtensions applies.',
  reason:
    'composeStacks reconciles same-name objects only at the top level of its inputs; a package body is carried '
    + 'as it is (a nested artifact\'s bodies untouched, and under manifest: \'preserve\' each input with a manifest '
    + 'is assembled into a body of its own objects), and at boot a body\'s declaration stands over the artifact\'s '
    + 'top-level one. So these compositions composed and then, measured through a real boot, either refused at '
    + 'boot with DUPLICATE_ARTIFACT_OBJECT_NAME (422, two bodies declaring the name) or booted the body\'s copy and '
    + 'silently dropped the other declaration — the override\'s replacement, the merged fields, or a manifest-less '
    + 'input\'s object. Installing the same packages one by one refuses the second package\'s claim on the name. '
    + 'composeStacks now refuses each such pair at compose time with STACK_COMPOSE_OBJECT_CONFLICT (422), naming '
    + 'the object and every declaring site, under every objectConflict strategy, since no strategy can replace or '
    + 'fold a declaration inside a body. objectConflict \'error\' refused these shapes before and still does, with '
    + 'the same issue; a composition with no package body is judged as before. Not convertible: which package '
    + 'keeps the object name is a fact only the author holds.',
  acceptanceCriteria:
    'os build (or the config that calls composeStacks) composes without a STACK_COMPOSE_OBJECT_CONFLICT whose '
    + 'issues name a packages[K].objects[\'NAME\'] site or a manifest: \'preserve\' composition. Then boot the '
    + 'artifact and confirm the object carries the fields and actions you meant: before this release the boot '
    + 'kept the body\'s copy, so the object you observed may have been a different declaration than the one you '
    + 'keep.',
};
