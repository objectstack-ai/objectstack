// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The flow's TEXT-slot renderer, and the variable map every node executor
 * reads.
 *
 * A text slot — a notify `title` / `message` / `actionUrl`, an http `url` and
 * each `headers` value, a screen `title` / `description`, a refusing `end`
 * node's `message` (#22110, ADR-0032 D3; #19939) — renders ADR-0032 §3's
 * `{{ }}` holes through the formula template engine, via
 * {@link renderTextSlot} below. A single-brace `{…}` token there is refused
 * before a run starts (`@objectstack/spec/automation`'s
 * `flow-text-slot-template.ts`).
 *
 * Nothing in a flow reads the single-brace `{…}` template dialect any more.
 * The 17.x interpolator that lived here — `interpolate`, `interpolateString`,
 * `resolveToken` and its function table — is deleted (#19939, ADR-0032
 * Sequencing 6: "delete the single-brace resolver"): every position that read
 * it is a VALUE slot (a CEL value envelope, or a literal handed on as written,
 * `value-slot-map.ts`), a TEXT slot (`{{ }}` holes), or a literal read as
 * written, and the doors refuse a `{…}` token at each with its replacement.
 * The spec's `flow-template-token.ts` keeps the judges' frozen reading of the
 * retired grammar, so a refusal can still name each token's replacement.
 */

import { templateEngine } from '@objectstack/formula';
import { markGuardRefusal } from '../guard-refusal.js';

export type VariableMap = Map<string, unknown>;

/**
 * A text slot's `{{ }}` template that does not compile (#22110) — a hole
 * holding logic or an unknown formatter (`{{ a + b }}`, `{{ x | bogus }}`), or
 * unbalanced delimiters. The doors (`registerFlow`, `objectstack validate`)
 * compile every text slot first, so this is met only by a flow that reached the
 * executor without them. A guard refusal (#3863): the metadata is wrong,
 * re-running the flow unchanged can never succeed, and a `fault` edge must not
 * swallow it into a notification sent with its holes unfilled. The same error
 * carries a `{{ amount | currency }}` hole with no argument met by a run whose
 * organization has no default currency ({@link renderTextSlot}): nothing is
 * sent until the organization sets one or the hole names its code.
 */
export class FlowTextTemplateError extends Error {
    /** The template text as authored. */
    readonly source: string;

    constructor(source: string, message: string) {
        super(message);
        this.name = 'FlowTextTemplateError';
        this.source = source;
        markGuardRefusal(this);
    }
}

/**
 * The flow's variables as the scope a text slot's `{{ }}` holes read — each
 * variable a root (`{{ record.name }}`, `{{ summary }}`, `{{ $error.message }}`),
 * and a node output stored under a flat dotted key (`n1.result`) reachable as
 * the path it spells (`{{ n1.result }}`).
 *
 * The nesting follows the 17.x interpolator's precedence: a declared variable
 * wins over a flat key sharing its head (`{a.b}` walked `a`'s value and never
 * read a flat `a.b`), so such a key is not merged into the variable. And it builds
 * fresh containers only — a variable's own object is never written into.
 */
export function textTemplateScope(variables: VariableMap): Record<string, unknown> {
    const scope: Record<string, unknown> = {};
    const fresh = new WeakSet<object>();
    const dotted: Array<[string, unknown]> = [];
    for (const [key, value] of variables) {
        if (key.includes('.')) dotted.push([key, value]);
        else scope[key] = value;
    }
    for (const [key, value] of dotted) {
        const segments = key.split('.');
        let cursor: Record<string, unknown> | undefined = scope;
        for (let i = 0; i < segments.length - 1 && cursor; i++) {
            const next: unknown = cursor[segments[i]!];
            if (next === undefined) {
                const container: Record<string, unknown> = {};
                fresh.add(container);
                cursor[segments[i]!] = container;
                cursor = container;
            } else {
                cursor = typeof next === 'object' && next !== null && fresh.has(next)
                    ? (next as Record<string, unknown>)
                    : undefined;
            }
        }
        if (cursor) cursor[segments[segments.length - 1]!] = value;
    }
    return scope;
}

/**
 * Render a flow TEXT slot — a notify `title` / `message`, a screen `title` /
 * `description`, a refusing `end` node's `message` — through the formula
 * template engine (#22110, ADR-0032 D3): `{{ path }}` and
 * `{{ path | formatter[:arg] }}` holes over {@link textTemplateScope}, every
 * other character literal. ONE renderer for every text slot — ⛔ never a second
 * template engine: the refusing `end` node's message "goes through the same
 * interpolation a screen `description` gets" (#15788), and so does a
 * notification.
 *
 * Value→string is the engine's, defined per value (ADR-0032 §3): `null` /
 * absent renders nothing, an object or array renders as JSON, a `Date` as its
 * ISO text, and a formatter makes the rest explicit (`{{ amount | currency }}`,
 * `{{ due | date:iso }}`). The formatters render in the engine's default
 * `en-US`: a flow variable named `locale` is a value like any other, never the
 * formatters' locale (#26232 — the engine reads that from its own reserved
 * channel, not from a root).
 *
 * `currency` is the run's tenant default currency
 * (`AutomationContext.currency`, seeded at run setup from the
 * organization's `localization.currency` setting), the code a
 * `{{ amount | currency }}` hole with no argument formats in. It rides the
 * engine's reserved `currency` channel, so a flow variable named `currency` is
 * a value like any other. Without one such a hole does not render: the throw
 * below names the hole, and nothing goes out with the amount in a guessed
 * currency.
 *
 * Absent in, absent out: a slot the author left unset — or one that renders
 * no text at all — returns `undefined`, so a screen falls back to its node
 * label and a notification with no title fails its own guard.
 *
 * A template that does not compile throws {@link FlowTextTemplateError}, a
 * guard refusal. A single-brace `{token}` is NOT read here: it is refused by
 * every door before a run starts (`flow-text-slot-template.ts`), and reaching
 * this renderer it is literal text.
 */
export function renderTextSlot(value: unknown, variables: VariableMap, currency?: string): string | undefined {
    if (value == null) return undefined;
    const source = String(value);
    const result = templateEngine.evaluate(
        { dialect: 'template', source },
        { extra: textTemplateScope(variables), ...(currency ? { currency } : {}) },
    );
    if (!result.ok) {
        throw new FlowTextTemplateError(source, `flow text template \`${source}\`: ${result.error.message}`);
    }
    const text = String(result.value);
    return text === '' ? undefined : text;
}
