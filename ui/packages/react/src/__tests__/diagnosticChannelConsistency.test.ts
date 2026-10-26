/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7849 — the two dev diagnostics that talk to an author about WHERE to
 * write an expression must not contradict each other.
 *
 * ## The defect this pins
 *
 * Both messages can fire on the SAME node. `propsBagDiagnostic` told the author
 * to move the key under `properties`; `unevaluatedExpression` enumerated "the
 * channels that do evaluate and read back today" and left `properties` OUT of
 * that list, naming only `content` and host-side resolution. So the runtime
 * answered one question two ways, and the half that was wrong was the
 * enumeration: `properties` demonstrably evaluates, hoists and reads back.
 *
 * ## Why this is a DERIVED assertion and not two hard-coded strings
 *
 * Pinning both sentences literally would pin today's wording, and the next
 * rewrite of either message would be free to reintroduce the contradiction as
 * long as it also updated its own pin. So the channel the `props` diagnostic
 * RECOMMENDS is parsed back out of the message it actually emits, and the
 * enumeration is parsed out of the other; the assertion is that the first
 * appears in the second. Reword either message and this test still asks the
 * question that matters — it only goes red when they disagree.
 *
 * Both extractions are asserted to have MATCHED before they are compared. A
 * regex that silently misses is the failure mode this shape would otherwise
 * introduce: `null` vs `null` would compare equal and the pin would pass
 * without reading a single word either developer wrote.
 */

import { describe, it, expect } from 'vitest';
import {
  formatDroppedPropsBagMessage,
  DROPPED_PROPS_BAG_PREFIX,
} from '../utils/propsBagDiagnostic';
import {
  collectUnevaluatedExpressions,
  formatUnevaluatedExpressionMessage,
  UNEVALUATED_EXPRESSION_PREFIX,
} from '../utils/unevaluatedExpression';

/**
 * One node, authored the way that trips BOTH diagnostics: an expression written
 * into the `props` envelope on a `schema`-reading renderer.
 */
const NODE_TYPE = 'badge';
const NODE_ID = 'status_badge';
const AUTHORED_KEY = 'label';
const AUTHORED_VALUE = '${data.status}';

/** The message `propsBagDiagnostic` really emits for that node. */
const propsBagMessage = (): string =>
  formatDroppedPropsBagMessage(NODE_TYPE, NODE_ID, [AUTHORED_KEY]);

/** The message `unevaluatedExpression` really emits for that node. */
const unevaluatedMessage = (): string => {
  const findings = collectUnevaluatedExpressions(
    undefined,
    undefined,
    { [AUTHORED_KEY]: AUTHORED_VALUE },
  );
  expect(findings.length).toBeGreaterThan(0);
  return formatUnevaluatedExpressionMessage(NODE_TYPE, NODE_ID, findings);
};

/**
 * The channel the `props` diagnostic tells the author to write under, read out
 * of its own sentence ("Write it/them under `X` instead").
 */
const recommendedChannel = (message: string): string | null => {
  const m = /Write (?:it|them) under `([^`]+)` instead/.exec(message);
  return m ? m[1] : null;
};

/**
 * The enumeration sentence of the unevaluated-expression diagnostic — from
 * "Channels that do evaluate and read back today:" to the end of the message.
 */
const channelEnumeration = (message: string): string | null => {
  const m = /Channels that do evaluate and read back today:([\s\S]+)$/.exec(message);
  return m ? m[1] : null;
};

describe('objectui#7849 — the two authoring diagnostics agree on the channels', () => {
  it('both messages are the ones the author actually reads', () => {
    expect(propsBagMessage()).toContain(DROPPED_PROPS_BAG_PREFIX);
    expect(unevaluatedMessage()).toContain(UNEVALUATED_EXPRESSION_PREFIX);
  });

  it('the props diagnostic still recommends a channel, in a sentence this test can read', () => {
    expect(recommendedChannel(propsBagMessage())).not.toBeNull();
  });

  it('the unevaluated diagnostic still enumerates the working channels', () => {
    expect(channelEnumeration(unevaluatedMessage())).not.toBeNull();
  });

  it('the channel the props diagnostic RECOMMENDS is listed by the unevaluated diagnostic as one that works', () => {
    const recommended = recommendedChannel(propsBagMessage());
    const enumeration = channelEnumeration(unevaluatedMessage());

    // Guarded above, and re-guarded here: a missed match must not compare equal.
    expect(recommended).not.toBeNull();
    expect(enumeration).not.toBeNull();

    expect(
      enumeration as string,
      'objectui#7849: `propsBagDiagnostic` tells the author to write the key under ' +
        '`' + recommended + '`, but `unevaluatedExpression`\'s list of channels that ' +
        'evaluate and read back does not mention it. One node can trip both messages; ' +
        'they must not answer the same question two ways.',
    ).toContain(recommended as string);
  });

  it('`content` — the channel that was already listed — stays listed', () => {
    expect(channelEnumeration(unevaluatedMessage()) as string).toContain('content');
  });
});
