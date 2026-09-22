// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * THE PIN: no refusal this package raises opens with a bracketed lowercase tag.
 *
 * Every refusal `ObjectStackProtocolImplementation` and `SysMetadataRepository`
 * raised used to open with a `[lower_snake]` tag that was the restatement of the
 * `code` the very same throw declared — `[no_draft]` in front of `NO_DRAFT`,
 * `[item_locked]` in front of `ITEM_LOCKED`, and so on for the whole family.
 *
 * They were not invisible. `withoutDeclaredCodePrefix`
 * (`packages/rest/src/error-response.ts`) strips a leading restatement only when
 * the message opens with the producer's declared code followed by a colon
 * (`INVALID_REQUEST: …`). The bracketed lowercase spelling matches neither the
 * casing nor the separator, so it was never stripped and reached the caller in
 * `error.message` — the repo's own de-duplication mechanism existed and did not
 * fire here.
 *
 * The maintainer ruling of 2026-08-29 on the `/data` door shipping `FORBIDDEN:`
 * in front of a localized refusal is ONE envelope semantics: `error` is HUMAN
 * LANGUAGE, `code` is the MACHINE TOKEN, and a prefix is removed *because* the
 * same fact already rides the `code` axis. Each of these tags met that condition
 * by construction, so all of them are gone.
 *
 * ## Why this pin is written as an ABSENCE, over SOURCE
 *
 * Nothing else notices the tag coming back. The per-refusal pins elsewhere in
 * this package assert the prose a given door answers, so one re-introduced tag
 * reds exactly one of them and a newly-written refusal reds none — and a new
 * refusal copied from a neighbouring producer is precisely how the idiom spread
 * in the first place. Reading the source covers every throw site in both files,
 * including ones no test can provoke.
 *
 * ⚠️ A scan that matches nothing passes for free, so the family floor below is
 * part of the pin: the scanner must still be finding refusals to have an opinion
 * about. Without it, moving every `throw` out of these files would green this
 * file rather than red it.
 *
 * ⛔ Two bracketed vocabularies in this package are NOT this family and are
 * deliberately untouched, because neither restates a declared `code`:
 * `path [zod code]` locators inside `metadataIssueHeadline`'s issue list, and
 * the `[rule]` locators the author-time gate composes. They name WHICH finding,
 * which is a fact the envelope carries nowhere else.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStackProtocolImplementation } from './protocol.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The two producers the ruling was applied to. */
const PRODUCERS = ['protocol.ts', 'sys-metadata-repository.ts'] as const;

/**
 * A string literal whose FIRST characters are a bracketed lowercase tag —
 * the shape `withoutDeclaredCodePrefix` cannot strip.
 */
const TAGGED_OPENER = /(`|')\[[a-z][a-z0-9_]*\]/;

function scan(file: string): { openers: string[]; refusals: number } {
  const lines = readFileSync(join(HERE, file), 'utf8').split('\n');
  const openers: string[] = [];
  let refusals = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    refusals += line.split('new Error(').length - 1;
    // Prose ABOUT a refusal is not a refusal: comments may name a code freely.
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
    const m = TAGGED_OPENER.exec(line);
    // The bracket must open the literal, not merely appear inside it.
    if (!m || line[m.index + 1] !== '[') continue;
    openers.push(`${file}:${i + 1}  ${trimmed.slice(0, 100)}`);
  }
  return { openers, refusals };
}

describe('refusal messages open with prose, never with a bracketed restatement of their own code', () => {
  it.each(PRODUCERS)('%s raises no message opening with a bracketed lowercase tag', (file) => {
    const { openers, refusals } = scan(file);

    // THE FLOOR — the scan has to still be looking at refusals for its silence
    // to mean anything. A `new Error(` count, not a total of matched openers:
    // the quantity this pin is about is zero, so it can never be its own floor.
    expect(
      refusals,
      `${file} no longer constructs errors here — this pin is scanning the wrong file`,
    ).toBeGreaterThanOrEqual(5);

    expect(
      openers,
      `these refusals open with a tag restating their own declared code:\n${openers.join('\n')}`,
    ).toEqual([]);
  });

  it('the whole family is covered — both producers together still raise the refusals this pin is about', () => {
    const total = PRODUCERS.reduce((n, f) => n + scan(f).refusals, 0);
    expect(total).toBeGreaterThanOrEqual(30);
  });
});

describe('the refusal a caller actually receives', () => {
  /** The envelope guards below refuse before any engine call, so none is needed. */
  function protocol() {
    return new ObjectStackProtocolImplementation({
      registry: { getObject: () => undefined },
      findOne: vi.fn(async () => null),
    } as any);
  }

  async function refusalFrom(run: () => Promise<unknown>): Promise<any> {
    try {
      await run();
    } catch (e) {
      return e;
    }
    throw new Error('expected a refusal, got a resolved call');
  }

  it('carries the token on `code` and opens with the sentence — `INVALID_REQUEST`', async () => {
    const err = await refusalFrom(() => (protocol() as any).saveMetaItem({ type: 'view', name: 'task_list' }));

    // The machine axis is unchanged: this change moved nothing off it.
    expect(err.code).toBe('INVALID_REQUEST');
    expect(err.status).toBe(400);

    // …and the human axis opens with the human sentence. Asserted as an absence
    // AND as the prose that opens instead, so the pin cannot go green by the
    // message becoming empty or generic.
    expect(err.message.startsWith('['), `message opens with a tag: ${err.message.slice(0, 48)}`).toBe(false);
    expect(err.message).not.toContain('[invalid_request]');
    expect(err.message).toContain("saveMetaItem requires an 'item' body for 'view/task_list'");
  });

  it('carries the token on `code` and opens with the sentence — the rollback envelope guard', async () => {
    const err = await refusalFrom(
      () => (protocol() as any).rollbackMetaItem({ type: 'view', name: 'task_list', toVersion: 0 }),
    );

    expect(err.code).toBe('INVALID_REQUEST');
    expect(err.status).toBe(400);
    expect(err.message.startsWith('['), `message opens with a tag: ${err.message.slice(0, 48)}`).toBe(false);
    expect(err.message).toContain("rollbackMetaItem requires a positive integer 'toVersion'");
  });
});
