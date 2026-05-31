// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

const colors = {
  primary: '#7C3AED',
  secondary: '#6C757D',
  accent: '#06B6D4',
  background: '#FFFFFF',
  surface: '#F8F9FA',
  text: '#1F2937',
  textSecondary: '#6B7280',
  border: '#E5E7EB',
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',
};

export const ShowcaseLightTheme = {
  name: 'showcase_light',
  label: 'Showcase Light',
  description: 'Default showcase theme — violet accent, light mode.',
  mode: 'light' as const,
  colors,
};

export const ShowcaseDarkTheme = {
  name: 'showcase_dark',
  label: 'Showcase Dark',
  description: 'Showcase theme — dark mode.',
  mode: 'dark' as const,
  colors: { ...colors, background: '#0B0F19', surface: '#111827', text: '#F9FAFB', textSecondary: '#9CA3AF', border: '#1F2937' },
};

export const allThemes = [ShowcaseLightTheme, ShowcaseDarkTheme];
