import { describe, expect, it } from 'vitest';
import { buildNudgeEmailHtml } from './index';

describe('buildNudgeEmailHtml', () => {
  it('points the primary CTA at the Discover tab', () => {
    const html = buildNudgeEmailHtml('Sam', [], null);
    expect(html).toContain('href="https://recifriend.com/?view=discover"');
    // It must not still point at the bare /recipes tab.
    expect(html).not.toContain('href="https://recifriend.com/recipes"');
  });
});
