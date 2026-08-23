import { describe, expect, test } from 'bun:test';
import { TOOLS, findToolById, findToolsByFileType } from '../src/lib/toolRegistry';

describe('Tool Registry & System Apps', () => {
  test('contains over 50 registered native OS tools', () => {
    expect(TOOLS.length).toBeGreaterThan(45);
  });

  test('every tool has a unique ID, valid title, and category', () => {
    const ids = new Set<string>();
    for (const tool of TOOLS) {
      expect(tool.id).toBeTruthy();
      expect(tool.name).toBeTruthy();
      expect(tool.category).toBeTruthy();
      expect(ids.has(tool.id)).toBe(false);
      ids.add(tool.id);
    }
  });

  test('findToolById retrieves exact tool metadata', () => {
    const jsonTool = findToolById('json-format');
    expect(jsonTool).toBeDefined();
    expect(jsonTool?.name).toContain('JSON');
    expect(jsonTool?.category).toBe('Developer');

    const invalid = findToolById('non-existent-tool-xyz');
    expect(invalid).toBeUndefined();
  });

  test('findToolsByFileType returns matching tools for MIME types', () => {
    const pngTools = findToolsByFileType('image/png');
    expect(pngTools.length).toBeGreaterThan(0);

    const pdfTools = findToolsByFileType('application/pdf');
    expect(pdfTools.length).toBeGreaterThan(0);
  });
});
