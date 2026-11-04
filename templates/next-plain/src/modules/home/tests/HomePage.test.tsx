import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HomePage } from '../index';

describe('HomePage', () => {
  it('shows Welcome', () => {
    render(<HomePage />);
    expect(screen.getByText('Welcome')).toBeInTheDocument();
  });
});
