// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34818] `withPublishAdvisories` — how the gate's advisories join a served
 * draft's `_diagnostics`: as warnings, in their user sentence, item-relative,
 * once, and only for a type whose editor shows them.
 */

import { describe, expect, it } from 'vitest';
import type { RuntimeAuthoringIssue } from '@objectstack/spec/api';
import { withPublishAdvisories } from './metadata-diagnostics.js';
// Paid during collection, not inside a case's clock: the module under test
// loads the lint package with a function-body import (check:test-source-alias).
import '@objectstack/lint';

const advisory = (over: Partial<RuntimeAuthoringIssue> = {}): RuntimeAuthoringIssue => ({
    rule: 'flow-decision-unconditional-branch',
    path: 'flows[0].nodes[1]',
    where: "flow 'f' · decision 'node_2'",
    message: 'gates on NOTHING',
    hint: 'Gate the branches.',
    severity: 'warning',
    ...over,
});

describe('[#34818] withPublishAdvisories', () => {
    it('adds each advisory as an item-relative warning in its user sentence, leaving valid as it was', () => {
        const out = withPublishAdvisories('flow', 'f', { valid: true }, [advisory({ userMessage: '条件分支没有条件。' })]);
        expect(out).toEqual({ valid: true, warnings: [{ path: 'nodes.1', message: '条件分支没有条件。' }] });
        const refused = withPublishAdvisories('flows', 'f', { valid: false, errors: [{ path: 'nodes.0', message: 'x' }] }, [advisory()]);
        expect(refused).toEqual({
            valid: false,
            errors: [{ path: 'nodes.0', message: 'x' }],
            warnings: [{ path: 'nodes.1', message: 'gates on NOTHING' }],
        });
    });

    it('keeps the developer message for a finding with no user sentence, and repeats no warning already there', () => {
        const prior = { valid: true, warnings: [{ path: 'nodes.1', message: 'gates on NOTHING' }] };
        expect(withPublishAdvisories('flow', 'f', prior, [advisory(), advisory()])).toBe(prior);
        expect(withPublishAdvisories('flow', 'f', undefined, [advisory(), advisory()])).toEqual({
            valid: true,
            warnings: [{ path: 'nodes.1', message: 'gates on NOTHING' }],
        });
    });

    it('returns the diagnostics untouched for another type, or with no advisories', () => {
        const prior = { valid: true };
        expect(withPublishAdvisories('object', 'invoice', prior, [advisory({ path: 'objects.invoice.fields.x' })])).toBe(prior);
        expect(withPublishAdvisories('flow', 'f', prior, [])).toBe(prior);
    });
});
