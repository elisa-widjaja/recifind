import { describe, expect, it, vi } from 'vitest';
import { logCookEvent } from './index';

describe('logCookEvent', () => {
  it('inserts a cook_event row', async () => {
    const runMock = vi.fn().mockResolvedValue({ success: true });
    const mockDb = {
      prepare: vi.fn().mockReturnValue({ bind: vi.fn().mockReturnThis(), run: runMock })
    } as unknown as D1Database;

    await logCookEvent(mockDb, 'user-1', 'recipe-1');
    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO cook_events')
    );
    expect(runMock).toHaveBeenCalledOnce();
  });
});
