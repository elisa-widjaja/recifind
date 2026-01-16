import { describe, expect, it } from 'vitest';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Env } from './index';
import { buildGeminiPrompt, callGemini, fetchRawRecipeText, parseGeminiRecipeJson } from './index';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnv({
  path: path.resolve(__dirname, '../.dev.vars'),
  override: false
});

const SOURCE_URL = 'https://www.instagram.com/reel/DDY3ZOnyf_9/?igsh=NTc4MTIwNjQ2YQ%3D%3D';

describe('Gemini integration', () => {
  it(
    'retrieves IG reel content via the proxy and receives JSON text from Gemini',
    async () => {
      const geminiKey = process.env.GEMINI_SERVICE_ACCOUNT_B64;
      if (!geminiKey) {
        throw new Error('GEMINI_SERVICE_ACCOUNT_B64 must be set via .dev.vars to run integration test');
      }

      const rawText = await fetchRawRecipeText(SOURCE_URL);
      expect(rawText).toBeTruthy();
      if (!rawText) {
        throw new Error('Failed to download proxied recipe text');
      }

      const recipe = {
        id: 'integration-test',
        userId: 'test-user',
        title: '',
        sourceUrl: SOURCE_URL,
        imageUrl: '',
        mealTypes: [],
        ingredients: [],
        steps: [],
        durationMinutes: null,
        notes: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const prompt = buildGeminiPrompt(recipe as any, rawText);
      const response = await callGemini({ GEMINI_SERVICE_ACCOUNT_B64: geminiKey } as Env, prompt);
      const parsed = parseGeminiRecipeJson(response);

      expect(response).toContain('"title"');
      expect(response.toLowerCase()).toContain('prosciutto');
      expect(parsed).toBeTruthy();
      expect(parsed?.ingredients?.length ?? 0).toBeGreaterThan(0);
      expect(parsed?.ingredients.join(' ').toLowerCase()).toContain('prosciutto');
    },
    30000
  );
});
