// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ScriptCapabilitiesField — the grant list of a sandboxed-JS (L2) body.
 *
 * A hook's `body` and a script action's `body` are the same spec union
 * (`HookBodySchema`), so both grant from one enum, `HookBodyCapability`. The
 * sandbox refuses every `ctx` call the body was not granted, and before this
 * control the grant was reachable from no Studio control on either surface:
 * the Hook inspector drew it first (objectstack#26726), and the action
 * inspector had none, so a script action that read or wrote data was refused
 * on every click (objectstack#29181). One control, mounted by both inspectors,
 * so the two cannot drift.
 *
 * The tokens are read from the spec enum, in its order, which is the order a
 * grant is written in. A stored token the enum does not list (a typo, the
 * retired `crypto.hash`) stays on screen, flagged, so it is never dropped
 * unseen; the save's parse names it, and unticking it removes it. Unticking the
 * last grant writes `[]`, the spec's default. Nothing is inferred from the
 * source text.
 *
 * The host draws this for a `js` body only: an expression body is strict and
 * refuses `capabilities` by name. Module-private: no barrel re-exports it.
 */

import { Label } from '@object-ui/components';
import { HookBodyCapability } from '@objectstack/spec/data';
import { t, type SupportedLocale } from '../i18n.js';
import { InspectorCheckboxField, flagUnknownValue } from './_shared.js';

/** The grantable tokens, in the spec's order. */
const CAPABILITY_TOKENS: readonly string[] = HookBodyCapability.options;

/** The `ctx` call each token unlocks, shown under its checkbox: the methods
 *  the sandbox runner gates on that token. Code, so it reads the same in every
 *  locale; a token with no entry shows none. */
const CAPABILITY_CALLS: Partial<Record<HookBodyCapability, string>> = {
  'api.read': 'ctx.api.object(…).find / findOne / count / aggregate',
  'api.write': 'ctx.api.object(…).insert / update / delete / updateMany / deleteMany / upsert',
  'api.transaction': 'ctx.api.transaction(async () => { … })',
  'crypto.uuid': 'ctx.crypto.randomUUID()',
  log: 'ctx.log.debug / info / warn / error',
};

export interface ScriptCapabilitiesFieldProps {
  /** The body's stored `capabilities`, as read off the draft. */
  value: unknown;
  /** Called with the whole next grant list. */
  onCommit: (capabilities: string[]) => void;
  /** The catalogue key of the hint under the list: the host names when the
   *  refusal happens (a hook run, an action click). */
  hintKey: string;
  locale: SupportedLocale;
  disabled?: boolean;
  testId?: string;
}

export function ScriptCapabilitiesField({
  value,
  onCommit,
  hintKey,
  locale,
  disabled,
  testId,
}: ScriptCapabilitiesFieldProps) {
  const granted: string[] = Array.isArray(value)
    ? value.filter((c): c is string => typeof c === 'string')
    : [];
  const options = [...CAPABILITY_TOKENS, ...granted.filter((c) => !CAPABILITY_TOKENS.includes(c))];
  const toggle = (cap: string, on: boolean) => {
    const next = new Set(granted);
    if (on) next.add(cap);
    else next.delete(cap);
    onCommit(options.filter((c) => next.has(c)));
  };

  return (
    <div className="space-y-1" data-testid={testId}>
      <Label className="text-xs text-muted-foreground">{t('engine.inspector.hook.capabilities', locale)}</Label>
      <div className="space-y-1 rounded-md border p-2">
        {options.map((cap) => (
          <div key={cap} className="space-y-0.5">
            <InspectorCheckboxField
              label={
                CAPABILITY_TOKENS.includes(cap)
                  ? cap
                  : flagUnknownValue(cap, t('engine.inspector.hook.capabilityUnknown', locale), locale)
              }
              value={granted.includes(cap)}
              onCommit={(on) => toggle(cap, on)}
              disabled={disabled}
            />
            {CAPABILITY_CALLS[cap as HookBodyCapability] && (
              <div className="pl-5 font-mono text-[10px] text-muted-foreground/70">
                {CAPABILITY_CALLS[cap as HookBodyCapability]}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="text-[11px] text-muted-foreground/70">{t(hintKey, locale)}</div>
    </div>
  );
}
