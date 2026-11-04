import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installMatchMedia, restoreMatchMedia } from '../matchMedia';
import { renderWithProviders } from '../renderWithProviders';

beforeEach(() => {
  installMatchMedia();
});
afterEach(restoreMatchMedia);

describe('renderWithProviders', () => {
  it('renders inside AppProviders with a fresh QueryClient without retries', () => {
    let seen: QueryClient | undefined;
    function Probe() {
      seen = useQueryClient();
      return <p>inside</p>;
    }
    const { queryClient, getByText } = renderWithProviders(<Probe />);
    expect(getByText('inside')).toBeInTheDocument();
    expect(seen).toBe(queryClient);
    expect(queryClient.getDefaultOptions().queries?.retry).toBe(false);
  });
});
