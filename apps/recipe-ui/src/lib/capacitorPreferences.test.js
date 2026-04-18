import { describe, expect, it, vi, beforeEach } from 'vitest';
import { capacitorStorage } from './capacitorPreferences';

vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
  },
}));

import { Preferences } from '@capacitor/preferences';

describe('capacitorStorage adapter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getItem unwraps .value', async () => {
    Preferences.get.mockResolvedValue({ value: 'hello' });
    const v = await capacitorStorage.getItem('k');
    expect(v).toBe('hello');
    expect(Preferences.get).toHaveBeenCalledWith({ key: 'k' });
  });

  it('getItem returns null when key absent', async () => {
    Preferences.get.mockResolvedValue({ value: null });
    const v = await capacitorStorage.getItem('k');
    expect(v).toBeNull();
  });

  it('setItem passes key + value', async () => {
    await capacitorStorage.setItem('k', 'v');
    expect(Preferences.set).toHaveBeenCalledWith({ key: 'k', value: 'v' });
  });

  it('removeItem calls Preferences.remove', async () => {
    await capacitorStorage.removeItem('k');
    expect(Preferences.remove).toHaveBeenCalledWith({ key: 'k' });
  });
});
