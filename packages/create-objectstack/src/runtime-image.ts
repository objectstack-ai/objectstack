// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.
//
// Pins the scaffolded Dockerfile's runtime image tag. Kept out of index.ts
// because that module calls `program.parse()` on import — anything a test needs
// must be importable without running the CLI (same reason as pkg-utils.ts and
// rewrite-identity.ts).
//
// WHY THE TAG IS RESOLVED AFTER INSTALL, NOT FROM THE TEMPLATE
// ------------------------------------------------------------
// The template shipped `FROM ghcr.io/objectstack-ai/objectstack:latest` under a
// comment telling the reader to "pin the tag to the @objectstack/cli version in
// your package.json" — an instruction the scaffold itself did not follow, baked
// into every app made with `npx create-objectstack` (#9017). `docker/README.md`
// scopes `latest` to quick starts and documents `X.Y.Z` as the production pin,
// so a production app template landing on `latest` contradicted both its own
// comment and the published tag guidance.
//
// The tag is read from the INSTALLED cli — `node_modules/@objectstack/cli`'s
// own version — and not from the generated `package.json`, because that file
// carries a caret RANGE (`^17.0.0`, written by syncObjectStackDeps). The two
// are not interchangeable:
//
//   - npm resolves `^17.0.0` to the newest 17.x, so the artifact is built by
//     (say) 17.0.5 while the range's floor is 17.0.0. Pinning the floor would
//     ship a runtime image OLDER than the CLI that built the artifact — the
//     exact promise the comment makes, broken in a new way.
//   - The rolling `:17` tag does match the range's float window, but it is a
//     rolling tag, which is what `docker/README.md` tells production not to use.
//
// The resolved version is the only value that makes the sentence true, and it
// is the same rule the repo already applies for the same reason in
// `.github/workflows/scaffold-e2e.yml` ("Pin the runtime's CLI to the SAME
// version the generated project actually resolved to — NOT a hardcoded
// `latest`"): during an RC window a fixed tag skews protocol majors and `os
// start` refuses to boot the artifact.
//
// WHY A FAILED PIN WARNS INSTEAD OF THROWING
// ------------------------------------------
// `rewrite-identity.ts` throws when its rewrite silently does nothing, because
// there the generated project cannot build at all. Here the project is complete
// and correct either way — only the tag is less precise — so aborting a
// finished scaffold would be disproportionate. The real guard against a silent
// no-op is `runtime-image.test.ts`, which asserts on SCAFFOLDED OUTPUT: the
// emitted Dockerfile's `FROM` tag against the emitted `package.json`'s range.
// A template edit that moves the anchor turns that test red in CI.

import fs from 'node:fs';
import path from 'node:path';

/** The runtime `FROM` line, with its tag captured. Docker tag charset. */
const RUNTIME_FROM_RE =
  /^FROM ghcr\.io\/objectstack-ai\/objectstack:([A-Za-z0-9_][A-Za-z0-9_.+-]*)[ \t]*$/;

/** A version we are willing to write into a Dockerfile tag. */
const PINNABLE_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** A comment line carrying prose (`# text`) — a bare `#` ends the paragraph. */
const PROSE_COMMENT_RE = /^#[ \t]+\S/;

export type PinResult =
  | { pinned: true; tag: string }
  | { pinned: false; reason: string };

/**
 * The version of `@objectstack/cli` actually installed into a scaffolded
 * project, i.e. the CLI that will build its artifact. Undefined when nothing is
 * installed (`--skip-install`, or an install that failed), which is the one
 * case where there is genuinely no version to pin to.
 */
export function readResolvedCliVersion(targetDir: string): string | undefined {
  const pkgPath = path.join(
    targetDir,
    'node_modules',
    '@objectstack',
    'cli',
    'package.json',
  );
  try {
    const version = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version;
    return typeof version === 'string' && PINNABLE_VERSION_RE.test(version)
      ? version
      : undefined;
  } catch {
    // not installed, or unreadable → no opinion
    return undefined;
  }
}

/** The comment paragraph that replaces the "pin this yourself" instruction. */
function pinnedComment(version: string): string[] {
  return [
    '# Pinned at scaffold time to the @objectstack/cli version this project',
    '# resolved, so the runtime runs the same CLI that built your artifact.',
    '# Move both together when you upgrade — see docker/README.md tag table.',
    `FROM ghcr.io/objectstack-ai/objectstack:${version}`,
  ];
}

/**
 * Rewrite the scaffolded Dockerfile's runtime tag to `version`, and replace the
 * comment paragraph above it so it stops instructing a step the scaffolder has
 * now performed. Both halves move together: leaving the imperative in place
 * would relocate #9017's contradiction rather than remove it.
 *
 * The comment paragraph is found by walking up from the `FROM` line over
 * contiguous prose comments — anchored on the line being rewritten, so there is
 * only one assumption about the template's shape, not two.
 */
export function pinRuntimeImage(targetDir: string, version: string): PinResult {
  if (!PINNABLE_VERSION_RE.test(version)) {
    return { pinned: false, reason: `'${version}' is not a pinnable version` };
  }

  const dockerfile = path.join(targetDir, 'Dockerfile');
  let text: string;
  try {
    text = fs.readFileSync(dockerfile, 'utf8');
  } catch {
    // A template legitimately need not ship a Dockerfile.
    return { pinned: false, reason: 'no Dockerfile in the scaffolded project' };
  }

  const lines = text.split('\n');
  const fromIdx = lines.findIndex((line) => RUNTIME_FROM_RE.test(line));
  if (fromIdx === -1) {
    return {
      pinned: false,
      reason: 'no `FROM ghcr.io/objectstack-ai/objectstack:<tag>` line found',
    };
  }

  let start = fromIdx;
  while (start > 0 && PROSE_COMMENT_RE.test(lines[start - 1])) start--;

  lines.splice(start, fromIdx - start + 1, ...pinnedComment(version));
  const pinnedText = lines.join('\n');

  // Verify against the rewritten text rather than trusting the splice: a pin
  // that quietly did nothing is indistinguishable from one that was not needed,
  // and that ambiguity is what shipped #4902 in the namespace rewrite.
  const check = pinnedText
    .split('\n')
    .map((line) => RUNTIME_FROM_RE.exec(line))
    .find((match) => match !== null);
  if (!check || check[1] !== version) {
    return { pinned: false, reason: 'rewrite did not produce the pinned tag' };
  }

  fs.writeFileSync(dockerfile, pinnedText);
  return { pinned: true, tag: version };
}
