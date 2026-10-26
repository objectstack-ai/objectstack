/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SchemaRenderer } from '@object-ui/react';
import {
  renderComponent,
  validateComponentRegistration,
  getAllDisplayIssues,
} from './test-utils';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../renderers';
import type {
  ButtonSchema,
  InputSchema,
  LabelSchema,
  RadioGroupSchema,
  SelectSchema,
  SliderSchema,
  TextSchema,
} from '@object-ui/types';

/**
 * Types a literal below as the node it is rather than as the `BaseSchema`
 * `renderComponent` accepts, children included (objectui#11347): since
 * objectui#8347 removed `BaseSchema`'s index signature, a literal checked
 * against `BaseSchema` or `SchemaNode` may author only `BaseSchema`'s own keys.
 * The literals that deliberately author a retired or undeclared key stay
 * untyped, on purpose.
 */
const buttonNode = (schema: ButtonSchema): ButtonSchema => schema;
const inputNode = (schema: InputSchema): InputSchema => schema;
const labelNode = (schema: LabelSchema): LabelSchema => schema;
const radioGroupNode = (schema: RadioGroupSchema): RadioGroupSchema => schema;
const selectNode = (schema: SelectSchema): SelectSchema => schema;
const sliderNode = (schema: SliderSchema): SliderSchema => schema;
const textNode = (schema: TextSchema): TextSchema => schema;

/**
 * Comprehensive tests for form renderer components
 * These tests automatically detect display and accessibility issues
 */
describe('Form Renderers - Display Issue Detection', () => {
  describe('Button Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('button');
      expect(validation.isRegistered).toBe(true);
      expect(validation.hasConfig).toBe(true);
      expect(validation.hasDefaultProps).toBe(true);
    });

    it('should render button with label', () => {
      const { container } = renderComponent({
        type: 'button',
        label: 'Click Me',
      });

      const button = screen.getByRole('button', { name: /click me/i });
      expect(button).toBeInTheDocument();
      
      const issues = getAllDisplayIssues(container);
      const a11yIssues = issues.filter(i => i.includes('missing accessible label'));
      expect(a11yIssues).toHaveLength(0);
    });

    it('should support different variants', () => {
      const variants: NonNullable<ButtonSchema['variant']>[] = ['default', 'secondary', 'destructive', 'outline', 'ghost', 'link'];
      
      variants.forEach(variant => {
        const { container } = renderComponent(buttonNode({
          type: 'button',
          label: 'Test',
          variant,
        }));

        const button = container.querySelector('button');
        expect(button).toBeTruthy();
      });
    });

    it('should support different sizes', () => {
      const sizes: NonNullable<ButtonSchema['size']>[] = ['default', 'sm', 'lg', 'icon'];
      
      sizes.forEach(size => {
        const { container } = renderComponent(buttonNode({
          type: 'button',
          label: 'Test',
          size,
        }));

        const button = container.querySelector('button');
        expect(button).toBeTruthy();
      });
    });

    it('should render children when no label provided', () => {
      const { container } = renderComponent(buttonNode({
        type: 'button',
        children: [textNode({ type: 'text', content: 'Child Content' })],
      }));

      expect(container.textContent).toContain('Child Content');
    });
  });

  describe('Input Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('input');
      expect(validation.isRegistered).toBe(true);
      expect(validation.hasDefaultProps).toBe(true);
    });

    it('should render input with label', () => {
      const { container } = renderComponent({
        type: 'input',
        label: 'Username',
        name: 'username',
        id: 'username-input',
      });

      const input = container.querySelector('input');
      const label = container.querySelector('label');
      
      expect(input).toBeTruthy();
      expect(label).toBeTruthy();
      expect(label?.textContent).toContain('Username');
    });

    it('should show required indicator when required', () => {
      const { container } = renderComponent(inputNode({
        type: 'input',
        label: 'Required Field',
        name: 'required',
        required: true,
      }));

      const label = container.querySelector('label');
      // The label should have a required indicator (*)
      expect(label?.className).toContain('text-destructive');
    });

    it('should support different input types', () => {
      const types: NonNullable<InputSchema['inputType']>[] = ['text', 'email', 'password', 'number', 'tel', 'url', 'date'];
      
      types.forEach(inputType => {
        const { container } = renderComponent(inputNode({
          type: 'input',
          label: 'Test',
          inputType,
        }));

        const input = container.querySelector('input');
        expect(input?.getAttribute('type')).toBe(inputType);
      });
    });

    it('should display description when provided', () => {
      const { container } = renderComponent({
        type: 'input',
        label: 'Field',
        description: 'This is a helpful description',
      });

      expect(container.textContent).toContain('This is a helpful description');
    });

    it('should display error message when provided', () => {
      const { container } = renderComponent(inputNode({
        type: 'input',
        label: 'Field',
        error: 'This field has an error',
      }));

      expect(container.textContent).toContain('This field has an error');
      const error = container.querySelector('.text-destructive');
      expect(error).toBeTruthy();
    });

    // Through the REAL renderer, not `renderComponent`. An authored `disabled`
    // is `boolean | string` and is EVALUATED by `SchemaRenderer`, which strips
    // the raw key and forwards the verdict as a `disabled` prop; the widget
    // consumes that prop and no longer re-reads `schema.disabled` beside it
    // (objectui#7238). `renderComponent` mounts the registration with no host in
    // front of it, so it can only ever assert the raw read this card removed —
    // the predicate half of the same key is pinned in
    // `disabled-verdict-one-carrier.test.tsx`.
    it('should handle disabled state', () => {
      const { container } = render(
        <SchemaRenderer schema={{ type: 'input', label: 'Field', disabled: true } as never} />,
      );

      const input = container.querySelector('input');
      expect(input?.hasAttribute('disabled')).toBe(true);
    });

    it('should handle readonly state', () => {
      const { container } = renderComponent(inputNode({
        type: 'input',
        label: 'Field',
        readOnly: true,
      }));

      const input = container.querySelector('input');
      expect(input?.hasAttribute('readonly')).toBe(true);
    });
  });

  describe('Email Input Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('email');
      expect(validation.isRegistered).toBe(true);
    });

    it('should render email input with correct type', () => {
      const { container } = renderComponent({
        type: 'email',
        label: 'Email',
      });

      const input = container.querySelector('input[type="email"]');
      expect(input).toBeTruthy();
    });
  });

  describe('Password Input Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('password');
      expect(validation.isRegistered).toBe(true);
    });

    it('should render password input with correct type', () => {
      const { container } = renderComponent({
        type: 'password',
        label: 'Password',
      });

      const input = container.querySelector('input[type="password"]');
      expect(input).toBeTruthy();
    });
  });

  describe('Textarea Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('textarea');
      expect(validation.isRegistered).toBe(true);
    });

    it('should render textarea with label', () => {
      const { container } = renderComponent({
        type: 'textarea',
        label: 'Comments',
        name: 'comments',
      });

      const textarea = container.querySelector('textarea');
      const label = container.querySelector('label');
      
      expect(textarea).toBeTruthy();
      expect(label).toBeTruthy();
    });

    it('should support placeholder', () => {
      const { container } = renderComponent({
        type: 'textarea',
        label: 'Comments',
        placeholder: 'Enter your comments here',
      });

      const textarea = container.querySelector('textarea');
      expect(textarea?.getAttribute('placeholder')).toBe('Enter your comments here');
    });
  });

  describe('Select Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('select');
      expect(validation.isRegistered).toBe(true);
    });

    it('should render select with options', () => {
      const { container } = renderComponent(selectNode({
        type: 'select',
        label: 'Choose option',
        options: [
          { value: '1', label: 'Option 1' },
          { value: '2', label: 'Option 2' },
        ],
      }));

      // Select component should be present
      expect(container.querySelector('[role="combobox"]') || container.querySelector('select')).toBeTruthy();
    });
  });

  describe('Checkbox Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('checkbox');
      expect(validation.isRegistered).toBe(true);
    });

    it('should render checkbox with label', () => {
      const { container } = renderComponent({
        type: 'checkbox',
        label: 'Accept terms',
        name: 'terms',
      });

      const checkbox = container.querySelector('input[type="checkbox"], button[role="checkbox"]');
      expect(checkbox).toBeTruthy();
    });
  });

  describe('Switch Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('switch');
      expect(validation.isRegistered).toBe(true);
    });

    it('should render switch component', () => {
      const { container } = renderComponent({
        type: 'switch',
        label: 'Enable feature',
      });

      const switchEl = container.querySelector('[role="switch"], button');
      expect(switchEl).toBeTruthy();
    });
  });

  describe('Radio Group Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('radio-group');
      expect(validation.isRegistered).toBe(true);
    });

    it('should render radio group with options', () => {
      const { container } = renderComponent(radioGroupNode({
        type: 'radio-group',
        label: 'Choose one',
        options: [
          { value: 'a', label: 'Option A' },
          { value: 'b', label: 'Option B' },
        ],
      }));

      const radioGroup = container.querySelector('[role="radiogroup"]');
      expect(radioGroup).toBeTruthy();
    });
  });

  describe('Slider Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('slider');
      expect(validation.isRegistered).toBe(true);
    });

    it('should render slider component', () => {
      const { container } = renderComponent(sliderNode({
        type: 'slider',
        label: 'Volume',
        min: 0,
        max: 100,
      }));

      const slider = container.querySelector('[role="slider"], input[type="range"]');
      expect(slider).toBeTruthy();
    });
  });

  describe('Label Renderer', () => {
    it('should be properly registered', () => {
      const validation = validateComponentRegistration('label');
      expect(validation.isRegistered).toBe(true);
    });

    it('should render label element', () => {
      const { container } = renderComponent(labelNode({
        type: 'label',
        text: 'Form Label',
      }));

      const label = container.querySelector('label');
      expect(label).toBeTruthy();
      expect(label?.textContent).toContain('Form Label');
    });

    it('no longer reads the retired `content` spelling (objectui#6152)', () => {
      // `content` was the renderer's third read, after `text` and `label`. Both faces of
      // `@object-ui/types` retire it, so a node carrying only `content` renders no text.
      const { container } = renderComponent({
        type: 'label',
        // @ts-expect-error — retired on `label` (objectui#6152), and `BaseSchema` declares no `content` and no index signature (objectui#8347)
        content: 'Retired Spelling',
      });

      const label = container.querySelector('label');
      expect(label).toBeTruthy();
      expect(label?.textContent ?? '').not.toContain('Retired Spelling');
    });
  });

  describe('Field locators (ADR-0054 C4)', () => {
    it('emits a metadata-derived field:{object}.{field} locator on each field', () => {
      renderComponent({
        type: 'form',
        objectName: 'account',
        fields: [
          { name: 'industry', label: 'Industry', type: 'input' },
          { name: 'annual_revenue', label: 'Annual Revenue', type: 'input' },
        ],
      } as any);

      const industry = screen.getByTestId('field:account.industry');
      expect(industry).toBeInTheDocument();
      expect(industry.getAttribute('data-field')).toBe('industry');
      expect(screen.getByTestId('field:account.annual_revenue')).toBeInTheDocument();
    });

    it('omits the object prefix when the form has no objectName', () => {
      renderComponent({
        type: 'form',
        fields: [{ name: 'email', label: 'Email', type: 'input' }],
      } as any);

      expect(screen.getByTestId('field:email')).toBeInTheDocument();
    });
  });

  describe('Form field readonly vs disabled (regression)', () => {
    it('a field marked `readonly` renders read-only, not disabled', () => {
      renderComponent({
        type: 'form',
        fields: [{ name: 'notes', label: 'Notes', type: 'input', readonly: true }],
      } as any);

      const input = screen.getByTestId('field:notes').querySelector('input');
      expect(input?.hasAttribute('readonly')).toBe(true);
      expect(input?.hasAttribute('disabled')).toBe(false);
    });

    it('a field marked `disabled` still renders disabled, not merely read-only', () => {
      renderComponent({
        type: 'form',
        fields: [{ name: 'notes', label: 'Notes', type: 'input', disabled: true }],
      } as any);

      const input = screen.getByTestId('field:notes').querySelector('input');
      expect(input?.hasAttribute('disabled')).toBe(true);
      expect(input?.hasAttribute('readonly')).toBe(false);
    });
  });
});
