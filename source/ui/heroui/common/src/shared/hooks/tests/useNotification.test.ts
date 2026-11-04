import { toast } from '@heroui/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotification } from '../useNotification';

vi.mock('@heroui/react', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    danger: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

describe('useNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns exactly success, error, warning and info', () => {
    expect(Object.keys(useNotification()).sort()).toEqual([
      'error',
      'info',
      'success',
      'warning',
    ]);
  });

  it('returns the same object on every call', () => {
    expect(useNotification()).toBe(useNotification());
  });

  it.each([
    ['success', 'success'],
    ['error', 'danger'],
    ['warning', 'warning'],
    ['info', 'info'],
  ] as const)('maps %s to toast.%s', (method, variant) => {
    useNotification()[method]('hello');
    expect(toast[variant]).toHaveBeenCalledTimes(1);
    expect(toast[variant]).toHaveBeenCalledWith('hello', expect.anything());
    for (const other of ['success', 'danger', 'warning', 'info'] as const) {
      if (other !== variant) expect(toast[other]).not.toHaveBeenCalled();
    }
  });
});
