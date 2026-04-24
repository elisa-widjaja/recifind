import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockRead = vi.fn();
const mockClear = vi.fn();
let isNative = true;

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => isNative,
  },
  registerPlugin: () => ({
    readPendingShare: (...a) => mockRead(...a),
    clearPendingShare: (...a) => mockClear(...a),
  }),
}));

let readPendingShare, clearPendingShare;

beforeEach(async () => {
  vi.resetModules();
  mockRead.mockReset();
  mockClear.mockReset();
  isNative = true;
  ({ readPendingShare, clearPendingShare } = await import('./pendingShare.js'));
});

afterEach(() => {
  vi.resetModules();
});

describe('pendingShare — web platform', () => {
  it('readPendingShare returns null without calling the plugin', async () => {
    isNative = false;
    vi.resetModules();
    ({ readPendingShare } = await import('./pendingShare.js'));
    await expect(readPendingShare()).resolves.toBeNull();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('clearPendingShare no-ops without calling the plugin', async () => {
    isNative = false;
    vi.resetModules();
    ({ clearPendingShare } = await import('./pendingShare.js'));
    await clearPendingShare();
    expect(mockClear).not.toHaveBeenCalled();
  });
});

describe('pendingShare — native platform', () => {
  it('returns the plugin payload on success', async () => {
    mockRead.mockResolvedValueOnce({ url: 'https://x', title: 'T', createdAt: 123 });
    await expect(readPendingShare()).resolves.toEqual({
      url: 'https://x', title: 'T', createdAt: 123,
    });
  });

  it('returns null when the plugin rejects (no-pending-share)', async () => {
    mockRead.mockRejectedValueOnce(new Error('no-pending-share'));
    await expect(readPendingShare()).resolves.toBeNull();
  });

  it('returns null when the plugin rejects for any other reason', async () => {
    mockRead.mockRejectedValueOnce(new Error('boom'));
    await expect(readPendingShare()).resolves.toBeNull();
  });

  it('clearPendingShare swallows plugin errors', async () => {
    mockClear.mockRejectedValueOnce(new Error('boom'));
    await expect(clearPendingShare()).resolves.toBeUndefined();
  });
});
