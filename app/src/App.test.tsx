import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('dashboard shell', () => {
  it('renders the Utah Snowpack title', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Utah Snowpack' })).toBeInTheDocument();
  });

  it('shows the loading-data state', () => {
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading data');
  });
});
