import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { MOCK_SNOWPACK } from './data/mock';

describe('dashboard shell (mock data)', () => {
  it('renders the title, water-year banner, and both source stamps', () => {
    render(<App data={MOCK_SNOWPACK} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Utah Snowpack' })).toBeInTheDocument();
    expect(screen.getByTestId('water-year')).toHaveTextContent('Water year 2027');
    expect(screen.getByText(/10:10am Sun 25 October 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Sunday, October 25, 2026/)).toBeInTheDocument();
  });

  it('renders the legend with all seven KSL bands plus no-data', () => {
    render(<App data={MOCK_SNOWPACK} />);
    const legend = screen.getByRole('list', { name: /legend/i });
    const labels = legend.querySelectorAll('li').length;
    expect(labels).toBe(8);
    for (const label of [
      '< 50%',
      '50-69%',
      '70-89%',
      '90-109%',
      '110-129%',
      '130-149%',
      '> 150%',
      'no data',
    ]) {
      expect(legend).toHaveTextContent(label);
    }
  });

  it('renders every basin with its band and SWE percent (em dash when missing)', () => {
    render(<App data={MOCK_SNOWPACK} />);
    const items = screen.getAllByRole('button', {
      name: /RAFT RIVER|BEAR RIVER|WEBER\/OGDEN|PROVO|GREEN RIVER|DUCHESNE|SEVIER|BEAVER/,
    });
    expect(items).toHaveLength(8);
    expect(screen.getByRole('button', { name: /RAFT RIVER/ })).toHaveTextContent('180%');
    expect(screen.getByRole('button', { name: /BEAVER/ })).toHaveTextContent('—');
    expect(screen.getByRole('button', { name: /BEAR RIVER/ })).toHaveTextContent('1/2 sites');
  });

  it('defaults to the first basin in the detail panel', () => {
    render(<App data={MOCK_SNOWPACK} />);
    const panel = screen.getByRole('complementary', { name: /basin detail/i });
    expect(panel).toHaveTextContent('RAFT RIVER');
    expect(panel).toHaveTextContent('180%');
  });

  it('selects a basin on click and shows its sites with flags', async () => {
    const user = userEvent.setup();
    render(<App data={MOCK_SNOWPACK} />);
    const bear = screen.getByRole('button', { name: /BEAR RIVER/ });
    await user.click(bear);
    expect(bear).toHaveAttribute('aria-pressed', 'true');
    const panel = screen.getByRole('complementary', { name: /basin detail/i });
    expect(panel).toHaveTextContent('BEAR RIVER');
    expect(panel).toHaveTextContent('54%');
    // CORTEZ 2 N has swe-missing: its SWE cell is flagged with a tooltip.
    expect(panel).toHaveTextContent('CORTEZ 2 N');
    expect(panel.querySelector('.site-table__flag')?.getAttribute('title')).toMatch(/SWE missing/);
  });

  it('walks the basin list in order with the keyboard', async () => {
    const user = userEvent.setup();
    render(<App data={MOCK_SNOWPACK} />);
    const first = screen.getByRole('button', { name: /RAFT RIVER/ });
    first.focus();
    await user.tab();
    expect(screen.getByRole('button', { name: /BEAR RIVER/ })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /WEBER\/OGDEN/ })).toHaveFocus();
  });

  it('surfaces pipeline warnings in the footer', () => {
    render(<App data={MOCK_SNOWPACK} />);
    expect(screen.getByText(/1 data warning/)).toBeInTheDocument();
  });
});

describe('dashboard shell (fetched data)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the loading state, then renders the fetched data', async () => {
    let resolveJson: (v: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        new Promise((resolve) => {
          resolveJson = resolve;
        }).then(() => Promise.resolve({ ok: true, json: async () => MOCK_SNOWPACK })),
      ),
    );
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading data');
    resolveJson({});
    await waitFor(() => expect(screen.getByTestId('water-year')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /BEAVER/ })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/snowpack.json');
  });

  it('shows an error state when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('HTTP 500'))),
    );
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Could not load snowpack data'),
    );
  });

  it('shows an error state when injected data is null', () => {
    render(<App data={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load snowpack data');
  });
});
