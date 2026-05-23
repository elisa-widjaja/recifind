import { afterEach, describe, expect, it, vi } from 'vitest';

import { callGemini, callGeminiExtract } from './index';
import type { Env } from './index';

const svcDeps = {
  getAccessToken: async () => 'fake-token',
  getServiceAccount: async () => ({
    client_email: 'svc@example.com',
    private_key: 'fake-key',
    token_uri: 'https://oauth2.googleapis.com/token',
    project_id: 'proj-123'
  })
};

function geminiReturning(textBySequence: string[]) {
  let n = 0;
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: textBySequence[Math.min(n++, textBySequence.length - 1)] }] } }]
    })
  })) as unknown as typeof fetch;
}

describe('callGeminiExtract (retry on malformed JSON)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('retries once when the first response is malformed JSON and returns the valid retry', async () => {
    // First response reproduces the real residual: ingredients array closed with
    // a stray `"` instead of `]` — the `]`->`"` slip that still occurs under JSON mode.
    const malformed = '{ "ingredients": ["1 tsp salt"\n  ", "steps": [] }';
    const valid = '{ "ingredients": ["1 tsp salt"], "steps": ["mix"] }';
    const mockFetch = geminiReturning([malformed, valid]);

    const parsed = await callGeminiExtract({} as Env, 'prompt', { ...svcDeps, fetchImpl: mockFetch });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(parsed).toEqual({ ingredients: ['1 tsp salt'], steps: ['mix'] });
  });

  it('does not retry when the first response parses, even if arrays are empty', async () => {
    const mockFetch = geminiReturning(['{ "ingredients": [], "steps": [] }']);

    const parsed = await callGeminiExtract({} as Env, 'prompt', { ...svcDeps, fetchImpl: mockFetch });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(parsed).toEqual({ ingredients: [], steps: [] });
  });

  it('returns null when every attempt is malformed', async () => {
    const malformed = '{ "ingredients": ["x"\n  ", "steps": [] }';
    const mockFetch = geminiReturning([malformed]);

    const parsed = await callGeminiExtract({} as Env, 'prompt', { ...svcDeps, fetchImpl: mockFetch });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(parsed).toBeNull();
  });
});

describe('callGemini', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the v1beta gemini-2.5-flash endpoint and returns parsed text', async () => {
    const prompt = 'format this recipe please';
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [{ text: ' { "title": "Test" } ' }]
            }
          }
        ]
      })
    })) as unknown as typeof fetch;

    const result = await callGemini(
      {} as Env,
      prompt,
      {
        fetchImpl: mockFetch,
        getAccessToken: async () => 'fake-token',
        getServiceAccount: async () => ({
          client_email: 'svc@example.com',
          private_key: 'fake-key',
          token_uri: 'https://oauth2.googleapis.com/token',
          project_id: 'proj-123'
        })
      }
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
    );
    expect(options).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer fake-token',
        'Content-Type': 'application/json',
        'X-Goog-User-Project': 'proj-123'
      })
    });
    const parsedBody = JSON.parse((options as RequestInit).body as string);
    expect(parsedBody.contents[0].parts[0].text).toBe(prompt);
    expect(parsedBody.generationConfig).toEqual({
      temperature: 0.2,
      maxOutputTokens: 4096,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 }
    });
    expect(JSON.parse(result)).toEqual({ title: 'Test' });
  });

  it('requests structured JSON output via responseMimeType (Gemini JSON mode)', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{}' }] } }]
      })
    })) as unknown as typeof fetch;

    await callGemini(
      {} as Env,
      'extract recipe',
      {
        fetchImpl: mockFetch,
        getAccessToken: async () => 'fake-token',
        getServiceAccount: async () => ({
          client_email: 'svc@example.com',
          private_key: 'fake-key',
          token_uri: 'https://oauth2.googleapis.com/token',
          project_id: 'proj-123'
        })
      }
    );

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse((options as RequestInit).body as string);
    // JSON mode is what prevents the malformed-JSON failures (stray `]`->`"`,
    // hallucinated tokens) that silently dropped ingredients/steps on import.
    expect(parsedBody.generationConfig.responseMimeType).toBe('application/json');
  });

  it('includes a fileData part when videoUrl option is provided', async () => {
    const prompt = 'extract recipe from video';
    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: '{"ingredients":[]}' }] }
          }
        ]
      })
    })) as unknown as typeof fetch;

    await callGemini(
      {} as Env,
      prompt,
      {
        fetchImpl: mockFetch,
        getAccessToken: async () => 'fake-token',
        getServiceAccount: async () => ({
          client_email: 'svc@example.com',
          private_key: 'fake-key',
          token_uri: 'https://oauth2.googleapis.com/token',
          project_id: 'proj-123'
        }),
        videoUrl: 'https://www.youtube.com/watch?v=abc123',
      }
    );

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsedBody = JSON.parse((options as RequestInit).body as string);
    expect(parsedBody.contents[0].parts).toHaveLength(2);
    expect(parsedBody.contents[0].parts[0]).toEqual({
      fileData: { fileUri: 'https://www.youtube.com/watch?v=abc123', mimeType: 'video/*' }
    });
    expect(parsedBody.contents[0].parts[1]).toEqual({ text: prompt });
  });
});
