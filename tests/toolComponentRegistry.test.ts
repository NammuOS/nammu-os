import { describe, expect, test } from 'bun:test';
import { TOOL_COMPONENTS } from '../src/components/desktop/toolComponents';
import { TOOLS } from '../src/lib/toolRegistry';

describe('lazy tool component registry', () => {
  test('keeps every registered tool addressable after module splitting', () => {
    const missing = TOOLS.filter((tool) => !TOOL_COMPONENTS[tool.component]).map(
      (tool) => `${tool.id}:${tool.component}`,
    );

    expect(missing).toEqual([]);
  });
});
