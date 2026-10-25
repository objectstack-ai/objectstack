/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { ComponentRegistry } from '@object-ui/core';
import type { InputOTPSchema } from '@object-ui/types';
import { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot } from '../../ui';
import { toFormControlDomProps } from '../../lib/form-control-dom-props';

ComponentRegistry.register('input-otp', 
  ({ schema, className, onChange, value, ...props }: { schema: InputOTPSchema; className?: string; [key: string]: any }) => {
    // `style` forwarded by name; the rest through the form-control
    // declaration (objectui#5632).
    const { style, ...otpProps } = props;
    // The slot count is the DECLARED `length` (`InputOTPSchema.length`,
    // `@default 6`), the spelling every catalog entry and the docs page author.
    // This used to read an undeclared `maxLength` and ignore `length`, so the
    // published 4- and 8-digit examples drew six slots (objectui#11347). One
    // spelling, no alias.
    const length = schema.length || 6;
    // `separator` (`InputOTPSchema.separator`, objectui#11365) splits the slots
    // into two groups at the midpoint and draws the primitive's separator
    // between them, the shadcn "with separator" layout. An odd `length` puts
    // the extra slot in the first group; a single slot has nothing to separate.
    // Absent or `false`, `split === length` and the markup is the one group
    // it always was.
    const split = schema.separator === true && length > 1 ? Math.ceil(length / 2) : length;
    const slotsFrom = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, k) => <InputOTPSlot key={from + k} index={from + k} />);

    const handleChange = (val: string) => {
      if (onChange) {
        onChange(val);
      }
    };

    return (
      <InputOTP 
        maxLength={length} 
        className={className} 
        value={value ?? schema.value}
        onChange={handleChange}
        {...toFormControlDomProps(otpProps)}
        style={style}
      >
        <InputOTPGroup>{slotsFrom(0, split)}</InputOTPGroup>
        {split < length && (
          <>
            <InputOTPSeparator />
            <InputOTPGroup>{slotsFrom(split, length)}</InputOTPGroup>
          </>
        )}
      </InputOTP>
    );
  },
  {
    namespace: 'ui',
    label: 'Input OTP',
    inputs: [
      { name: 'length', type: 'number' },
      { name: 'separator', type: 'boolean' },
      { name: 'className', type: 'string' }
    ],
    defaultProps: {
      length: 6
    }
  }
);
