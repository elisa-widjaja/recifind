import { afterEach, describe, expect, it, vi } from 'vitest';

import { callGemini } from './index';
import type { Env } from './index';

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
      thinkingConfig: { thinkingBudget: 0 }
    });
    expect(JSON.parse(result)).toEqual({ title: 'Test' });
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
