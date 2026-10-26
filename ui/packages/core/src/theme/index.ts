/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export {
  hexToHSL,
  toCSSColor,
  generateColorVars,
  generateTypographyVars,
  generateBorderRadiusVars,
  generateShadowVars,
  // `generateAnimationVars` / `generateZIndexVars` removed with the
  // `theme.animation` / `theme.zIndex` tombstones in @objectstack/spec
  // 17.0.0-rc.3 (objectstack#5021) — see ThemeEngine's RETIRED THEME BLOCKS
  // note. `theme.customVars` is the declared door for a `--duration-*` or
  // `--z-*` now.
  generateThemeVars,
  mergeThemes,
  resolveThemeInheritance,
  resolveMode,
  contrastRatio,
  meetsContrastLevel,
} from './ThemeEngine.js';
