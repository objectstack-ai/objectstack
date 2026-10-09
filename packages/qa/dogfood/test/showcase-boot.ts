// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22301] The ONE owner of the showcase's test root: every dogfood boot of the
// showcase goes through `bootShowcase`.
//
// `bootStack` composes what `objectstack serve` composes from a configuration
// (ruling A on #22301): the providers the showcase's `requires` names and the
// plugins in its own `plugins` array. With `requires: ['automation']` and its
// connector plugins mounted, the automation service materializes the
// showcase's declarative connectors at start, and `showcase_status_openapi`
// reads its spec from a PACKAGE-RELATIVE file. `serve` anchors that read at the
// directory holding `objectstack.config.ts`; the handle anchors it at
// `BootOptions.hostRoot`. This suite runs every file in a temporary working
// directory (#21914), so a boot that inherited the working directory as its
// root refuses the connector — measured: 102 files at `c9a2c6123`, every one
// `ENOENT` on `./src/system/connectors/status-openapi.json`.
//
// So the root is named HERE, once, and never at a call site: a change to how
// the showcase is anchored in tests edits this file and nothing else.
// ⛔ Do not pass `hostRoot` to `bootStack` for the showcase anywhere else, and
// ⛔ do not `chdir` into the showcase to make a boot find its files — a file
// that runs from the showcase's directory writes `.objectstack/data` there,
// which is the cross-file state #21914 removed.
//
// A file that boots a DERIVED showcase configuration (the showcase spread with
// an `onEnable`, a fresh module instance of it) hands that configuration in as
// the second argument; it is the same app, anchored at the same root.
import { fileURLToPath } from 'node:url';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type BootOptions, type VerifyStack } from '@objectstack/verify';

/** `examples/app-showcase` — the directory holding the showcase's `objectstack.config.ts`. */
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));

/**
 * Boot the showcase (or a configuration derived from it) anchored at the
 * showcase's own directory. Every other option is the caller's; `hostRoot` is
 * this helper's, and a caller's own is overridden.
 */
export function bootShowcase(opts: BootOptions = {}, config: unknown = showcaseStack): Promise<VerifyStack> {
  return bootStack(config, { ...opts, hostRoot: SHOWCASE_DIR });
}
