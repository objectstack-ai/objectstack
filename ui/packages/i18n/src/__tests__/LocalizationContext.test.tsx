import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { LocalizationProvider, useLocalization } from '../LocalizationContext';

function Probe() {
  const { currency, locale } = useLocalization();
  return <span>{`${currency ?? '∅'}|${locale ?? '∅'}`}</span>;
}

describe('LocalizationContext', () => {
  it('exposes the tenant currency + locale through the provider', () => {
    render(
      <LocalizationProvider value={{ currency: 'CNY', locale: 'zh-CN' }}>
        <Probe />
      </LocalizationProvider>,
    );
    expect(screen.getByText('CNY|zh-CN')).toBeInTheDocument();
  });

  it('degrades to empty (no tenant default) when used outside a provider', () => {
    render(<Probe />);
    expect(screen.getByText('∅|∅')).toBeInTheDocument();
  });
});
