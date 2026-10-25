/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Unit test for the local ESLint rule that requires an explicit `type` on plain
 * <button> elements (objectui#4045). Plain JS so it needs no package tsconfig.
 */
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';
import rule from './button-has-type.js';

RuleTester.afterAll = afterAll;
RuleTester.it = it;
RuleTester.describe = describe;

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('button-has-type', rule, {
  valid: [
    // The three legal values, each declared explicitly.
    '<button type="button">Go</button>',
    '<button type="submit">Save</button>',
    '<button type="reset">Reset</button>',
    // An expression is a declaration too — the author made the choice.
    '<button type={isSubmit ? "submit" : "button"}>Go</button>',
    // Order does not matter; `type` may sit after other props.
    '<button onClick={run} className="x" type="button">Go</button>',
    // A spread PLUS an explicit type is fine — the element declares it.
    '<button type="button" {...props}>Go</button>',
    // A <Button> COMPONENT is a different contract (its implementation owns the
    // DOM attribute); only the lowercase intrinsic is this rule's business.
    '<Button onClick={run}>Go</Button>',
    '<UI.Button onClick={run}>Go</UI.Button>',
    // Other intrinsics are untouched, including ones with their own `type`.
    '<input onChange={run} />',
    '<div role="button" onClick={run} />',
    // Not a JSX element at all.
    'const button = { type: undefined };',
  ],
  invalid: [
    // The bare case — the whole population's shape.
    {
      code: '<button onClick={run}>Go</button>',
      errors: [{ messageId: 'missingType' }],
    },
    // No attributes at all.
    {
      code: '<button>Go</button>',
      errors: [{ messageId: 'missingType' }],
    },
    // Self-closing.
    {
      code: '<button className="x" />',
      errors: [{ messageId: 'missingType' }],
    },
    // A spread cannot stand in for the declaration: whether it carries `type`
    // is unknowable statically, which is the case the rule exists for. Distinct
    // messageId so the report says why the spread did not save it.
    {
      code: '<button {...props}>Go</button>',
      errors: [{ messageId: 'spreadType' }],
    },
    {
      code: '<button {...attributes} {...listeners} aria-label="Drag" />',
      errors: [{ messageId: 'spreadType' }],
    },
    // A near-miss attribute name does not count as declaring `type`.
    {
      code: '<button buttonType="submit" data-type="x">Go</button>',
      errors: [{ messageId: 'missingType' }],
    },
    // A Radix `asChild` trigger child is flagged like any other button: Radix's
    // Primitive.button supplies `type` through its Slot today, but that is an
    // upstream implementation detail, not a contract (objectui#4045, and the
    // note in packages/components/src/custom/combobox.tsx).
    {
      code: '<PopoverTrigger asChild><button onClick={run}>Filter</button></PopoverTrigger>',
      errors: [{ messageId: 'missingType' }],
    },
    // Every untyped button reports — the rule counts sites, not files.
    {
      code: '<div><button>A</button><button>B</button></div>',
      errors: [{ messageId: 'missingType' }, { messageId: 'missingType' }],
    },
  ],
});
