import { describe, expect, it, vi } from 'vitest';
import { handleOembedAuthor } from './index';

// Minimal D1 mock: routes by SQL verb. `stored` is the creator returned by the
// read-first SELECT (null = no stored creator). Records UPDATE binds.
function mockDb(stored: string | null) {
  const updateRun = vi.fn().mockResolvedValue({ success: true });
  const calls: { selects: unknown[][]; updates: unknown[][] } = { selects: [], updates: [] };
  const prepare = vi.fn().mockImplementation((sql: string) => ({
    bind: (...args: unknown[]) => {
      if (/^\s*SELECT/i.test(sql)) {
        calls.selects.push(args);
        return { first: vi.fn().mockResolvedValue(stored !== null ? { creator: stored } : null) };
      }
      calls.updates.push(args);
      return { run: updateRun };
    },
  }));
  return { db: { prepare } as unknown as D1Database, prepare, calls, updateRun };
}

const TIKTOK_URL = 'https://www.tiktok.com/@kalejunkie/video/7300000000000000000';

function reqUrl(sourceUrl: string) {
  return new URL(`https://api.recifriend.com/public/oembed-author?url=${encodeURIComponent(sourceUrl)}`);
}

function fetchImplReturningAuthor(author: string) {
  return vi.fn().mockResolvedValue(new Response(
    JSON.stringify({ author_name: author }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )) as unknown as typeof fetch;
}

describe('handleOembedAuthor creator persistence', () => {
  it('returns the stored creator from D1 without a live fetch', async () => {
    const { db } = mockDb('Kalejunkie');
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const res = await handleOembedAuthor(reqUrl(TIKTOK_URL), db, { fetchImpl });
    expect(await res.json()).toEqual({ author: 'Kalejunkie' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('persists a live-resolved author to rows with that source_url', async () => {
    const { db, calls } = mockDb(null);
    const fetchImpl = fetchImplReturningAuthor('Kalejunkie');
    const res = await handleOembedAuthor(reqUrl(TIKTOK_URL), db, { fetchImpl });
    expect(await res.json()).toEqual({ author: 'Kalejunkie' });
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0]).toEqual(['Kalejunkie', TIKTOK_URL]);
  });

  it('does not write when the live fetch resolves nothing', async () => {
    const { db, calls } = mockDb(null);
    const fetchImpl = vi.fn().mockResolvedValue(new Response('nope', { status: 403 })) as unknown as typeof fetch;
    const res = await handleOembedAuthor(reqUrl(TIKTOK_URL), db, { fetchImpl });
    expect(await res.json()).toEqual({ author: null });
    expect(calls.updates).toHaveLength(0);
  });

  it('still serves the live author when the D1 write fails', async () => {
    const prepare = vi.fn().mockImplementation((sql: string) => ({
      bind: () => (/^\s*SELECT/i.test(sql)
        ? { first: vi.fn().mockResolvedValue(null) }
        : { run: vi.fn().mockRejectedValue(new Error('d1 down')) }),
    }));
    const db = { prepare } as unknown as D1Database;
    const fetchImpl = fetchImplReturningAuthor('Kalejunkie');
    const res = await handleOembedAuthor(reqUrl(TIKTOK_URL), db, { fetchImpl });
    expect(await res.json()).toEqual({ author: 'Kalejunkie' });
  });

  it('still resolves live when the D1 read fails', async () => {
    const prepare = vi.fn().mockImplementation((sql: string) => ({
      bind: () => (/^\s*SELECT/i.test(sql)
        ? { first: vi.fn().mockRejectedValue(new Error('d1 down')) }
        : { run: vi.fn().mockResolvedValue({ success: true }) }),
    }));
    const db = { prepare } as unknown as D1Database;
    const fetchImpl = fetchImplReturningAuthor('Kalejunkie');
    const res = await handleOembedAuthor(reqUrl(TIKTOK_URL), db, { fetchImpl });
    expect(await res.json()).toEqual({ author: 'Kalejunkie' });
  });
});
