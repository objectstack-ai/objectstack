/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Example: Simple Login Form
 * 
 * This example demonstrates how to use @object-ui/types to define
 * a complete login form with validation.
 */

import type { FormSchema } from '../src/index';

export const loginFormSchema: FormSchema = {
  type: 'form',
  className: 'max-w-md mx-auto p-6',
  
  fields: [
    {
      name: 'email',
      type: 'input',
      inputType: 'email',
      label: 'Email Address',
      placeholder: 'you@example.com',
      required: true,
      validation: {
        required: 'Email is required',
        pattern: {
          value: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i,
          message: 'Invalid email address'
        }
      }
    },
    {
      name: 'password',
      type: 'input',
      inputType: 'password',
      label: 'Password',
      placeholder: '••••••••',
      required: true,
      validation: {
        required: 'Password is required',
        minLength: {
          value: 8,
          message: 'Password must be at least 8 characters'
        }
      }
    },
    {
      name: 'remember',
      type: 'checkbox',
      label: 'Remember me'
    }
  ],
  
  submitLabel: 'Sign In',
  showCancel: false,
  
  onSubmit: async (data) => {
    console.log('Login attempt:', data);
    // Handle authentication
  }
};
