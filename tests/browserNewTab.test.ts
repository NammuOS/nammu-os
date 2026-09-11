import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NEW_TAB_MAX_BOARDS,
  NEW_TAB_MAX_LINKS,
  NEW_TAB_MAX_WORKSPACES,
  createDefaultNewTabState,
  createNewTabLink,
  moveItem,
  normalizeNewTabUrl,
  sanitizeNewTabState,
  searchNewTabContent,
} from '../src/components/browser/new-tab/newTabModel';
import { sanitizeBookmarks } from '../src/components/browser/services/browserEngine';
import type {
  Bookmark,
  HistoryEntry,
  QuickDial,
} from '../src/components/browser/services/browserEngine';

const dials: QuickDial[] = Array.from({ length: 6 }, (_, index) => ({
  id: `dial-${index}`,
  title: `Dial ${index}`,
  url: `https://dial-${index}.example`,
  icon: '',
  color: '#fff',
  desc: `Reference ${index}`,
}));

describe('Nammu Browser new tab workspace', () => {
  test('keeps dialog backdrops inside the active page surface', () => {
    const browserSource = readFileSync(
      join(process.cwd(), 'src/components/browser/BrowserApp.tsx'),
      'utf8',
    );
    const newTabStyles = readFileSync(
      join(process.cwd(), 'src/components/browser/new-tab/NammuNewTab.module.css'),
      'utf8',
    );

    expect(browserSource).toContain(
      'style={{ top: browserContentTop, right: browserContentRight }}',
    );
    expect(newTabStyles).toContain('transform: translateZ(0)');
  });

  test('creates a useful local workspace from the existing speed dials', () => {
    const state = createDefaultNewTabState(dials);
    const retiredDonorBrand = ['lumi', 'list'].join('');
    expect(state.workspaces).toHaveLength(9);
    expect(state.workspaces.flatMap((workspace) => workspace.boards)).toHaveLength(32);
    expect(
      state.workspaces.flatMap((workspace) => workspace.boards.flatMap((board) => board.links)),
    ).toHaveLength(148);
    expect(createDefaultNewTabState(dials)).toEqual(state);
    expect(state.wallpaper).toBe('ambient');
    expect(state.showClock).toBe(true);
    expect(state.showDate).toBe(true);
    expect(JSON.stringify(state).toLowerCase()).not.toContain(retiredDonorBrand);
  });

  test('accepts only HTTP(S) destinations and normalizes hostnames', () => {
    expect(normalizeNewTabUrl('example.com')).toBe('https://example.com/');
    expect(normalizeNewTabUrl('http://example.com/path')).toBe('http://example.com/path');
    expect(normalizeNewTabUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeNewTabUrl('file:///C:/secret.txt')).toBeNull();
    expect(normalizeNewTabUrl('data:text/html,hello')).toBeNull();
    expect(normalizeNewTabUrl('https://example.com/\u0000bad')).toBeNull();
    expect(createNewTabLink('Unsafe', 'javascript:alert(1)')).toBeNull();
  });

  test('validates bookmark imports and rejects executable or malformed destinations', () => {
    expect(
      sanitizeBookmarks([
        { id: 'safe', title: 'Safe', url: 'https://example.com/path', group: 'Reference' },
        { id: 'script', title: 'Unsafe', url: 'javascript:alert(1)' },
        { id: 'file', title: 'Local', url: 'file:///C:/private.txt' },
        { title: 'Malformed', url: 'not a url' },
      ]),
    ).toEqual([
      {
        id: 'safe',
        title: 'Safe',
        url: 'https://example.com/path',
        favicon: undefined,
        group: 'Reference',
      },
    ]);
  });

  test('sanitizes untrusted persisted state and falls back deterministically', () => {
    const fallback = createDefaultNewTabState(dials);
    expect(sanitizeNewTabState(null, fallback)).toBe(fallback);
    expect(sanitizeNewTabState({ workspaces: [] }, fallback)).toBe(fallback);

    const oversized = {
      version: 999,
      activeWorkspaceId: 'missing',
      density: 'unexpected',
      workspaces: Array.from({ length: NEW_TAB_MAX_WORKSPACES + 5 }, (_, workspaceIndex) => ({
        id: `workspace-${workspaceIndex}`,
        name: `Workspace ${workspaceIndex}`,
        boards: Array.from({ length: NEW_TAB_MAX_BOARDS + 5 }, (_, boardIndex) => ({
          id: `board-${boardIndex}`,
          title: `Board ${boardIndex}`,
          links: Array.from({ length: NEW_TAB_MAX_LINKS + 5 }, (_, linkIndex) => ({
            id: `link-${linkIndex}`,
            title: `Link ${linkIndex}`,
            url: `https://example.com/${workspaceIndex}/${boardIndex}/${linkIndex}`,
          })),
        })),
      })),
    };
    const sanitized = sanitizeNewTabState(oversized, fallback);
    expect(sanitized.workspaces.length).toBeLessThanOrEqual(NEW_TAB_MAX_WORKSPACES);
    expect(
      sanitized.workspaces.flatMap((workspace) => workspace.boards).length,
    ).toBeLessThanOrEqual(NEW_TAB_MAX_BOARDS);
    expect(
      sanitized.workspaces.flatMap((workspace) => workspace.boards.flatMap((board) => board.links))
        .length,
    ).toBeLessThanOrEqual(NEW_TAB_MAX_LINKS);
    expect(sanitized.activeWorkspaceId).toBe(sanitized.workspaces[0].id);
    expect(sanitized.density).toBe('comfortable');
    expect(sanitizeNewTabState({ ...fallback, density: 'compact' }, fallback).density).toBe(
      'comfortable',
    );
    expect(sanitizeNewTabState({ ...fallback, showDate: false }, fallback).showDate).toBe(true);
  });

  test('upgrades the original starter layout without replacing customized workspaces', () => {
    const fallback = createDefaultNewTabState(dials);
    const legacyStarter = {
      version: 1,
      activeWorkspaceId: 'workspace-home',
      density: 'comfortable',
      workspaces: [
        {
          id: 'workspace-home',
          name: 'Home',
          boards: [
            { id: 'board-essentials', title: 'Essentials', links: [] },
            { id: 'board-reference', title: 'Reference', links: [] },
          ],
        },
      ],
    };
    expect(sanitizeNewTabState(legacyStarter, fallback)).toBe(fallback);

    const previousStarter = {
      version: 2,
      activeWorkspaceId: 'workspace-focus',
      density: 'comfortable',
      workspaces: ['focus', 'studio', 'intelligence', 'operations'].map(
        (workspaceId, workspaceIndex) => ({
          id: `workspace-${workspaceId}`,
          name: workspaceId,
          boards: Array.from({ length: 3 }, (_, boardIndex) => ({
            id: `board-${workspaceIndex}-${boardIndex}`,
            title: 'Board',
            links: Array.from({ length: 4 }, (_, linkIndex) => ({
              id: `link-seed-${workspaceIndex}-${boardIndex}-${linkIndex}`,
              title: 'Link',
              url: `https://example.com/${workspaceIndex}/${boardIndex}/${linkIndex}`,
              note: '',
              createdAt: 0,
            })),
          })),
        }),
      ),
    };
    expect(sanitizeNewTabState(previousStarter, fallback)).toBe(fallback);

    const customized = {
      ...legacyStarter,
      workspaces: [
        {
          id: 'workspace-client-work',
          name: 'Client work',
          boards: [{ id: 'board-project', title: 'Project', links: [] }],
        },
      ],
    };
    const preserved = sanitizeNewTabState(customized, fallback);
    expect(preserved.workspaces[0].name).toBe('Client work');
    expect(preserved.version).toBe(4);
  });

  test('reorders without mutating the original collection', () => {
    const source = ['one', 'two', 'three'];
    expect(moveItem(source, 0, 2)).toEqual(['two', 'three', 'one']);
    expect(source).toEqual(['one', 'two', 'three']);
    expect(moveItem(source, -1, 2)).toBe(source);
  });

  test('searches workspace links, bookmarks, and recent history without URL duplicates', () => {
    const state = createDefaultNewTabState(dials);
    const bookmarks: Bookmark[] = [
      { id: 'bookmark-1', title: 'Nammu Docs', url: 'https://docs.nammu.test' },
      { id: 'bookmark-2', title: 'Duplicate dial', url: dials[0].url },
    ];
    const history: HistoryEntry[] = [
      {
        id: 'history-1',
        title: 'Nammu changelog',
        url: 'https://changes.nammu.test',
        timestamp: Date.now(),
      },
    ];
    const results = searchNewTabContent(state, bookmarks, history, 'nammu');
    expect(results.map((result) => result.source)).toEqual(['bookmark', 'history']);
    expect(new Set(results.map((result) => result.url)).size).toBe(results.length);
    expect(searchNewTabContent(state, bookmarks, history, '')).toEqual([]);
  });

  test('is integrated as the shared Browser home without donor branding or the legacy speed dial', () => {
    const root = process.cwd();
    const browser = readFileSync(join(root, 'src/components/browser/BrowserApp.tsx'), 'utf8');
    const component = readFileSync(
      join(root, 'src/components/browser/new-tab/NammuNewTab.tsx'),
      'utf8',
    );
    const stylesheet = readFileSync(
      join(root, 'src/components/browser/new-tab/NammuNewTab.module.css'),
      'utf8',
    );
    const model = readFileSync(join(root, 'src/components/browser/new-tab/newTabModel.ts'), 'utf8');
    const globalStyles = readFileSync(join(root, 'src/app/globals.css'), 'utf8');
    const browserMenu = readFileSync(join(root, 'src/components/browser/BrowserMenu.tsx'), 'utf8');
    const proxyManager = readFileSync(
      join(root, 'src/components/browser/ProxyManagerPanel.tsx'),
      'utf8',
    );
    const retiredDonorBrand = ['lumi', 'list'].join('');

    expect(browser).toContain('<NammuNewTab');
    expect(browser).toContain('SEARCH_ENGINE_INFO');
    expect(browser).toContain('browser-omnibox-input');
    expect(globalStyles).toContain('input.browser-omnibox-input.browser-omnibox-input');
    expect(globalStyles).toContain('input.new-tab-workspace-input.new-tab-workspace-input');
    expect(browser).not.toContain('Speed Dial Shortcuts');
    expect(component).toContain('Search the web, bookmarks, history, or your workspace');
    expect(component).not.toContain('Where do you want to go?');
    expect(component).not.toContain('<kbd>Ctrl K</kbd>');
    expect(component).not.toContain('event.ctrlKey');
    expect(component).toContain('<SiteFavicon');
    expect(component).toContain('Collapse board');
    expect(component).toContain('Restore defaults');
    expect(component).toContain('placeholder="New workspace"');
    expect(component).toContain('aria-label="Workspaces"');
    expect(component).toContain('Bookmarks</span>');
    expect(component).toContain('Recent</span>');
    expect(component).toContain('Export configuration');
    expect(component).toContain('Import configuration');
    expect(component).toContain("view === 'bookmarks'");
    expect(component).not.toContain('<span>Find</span>');
    expect(component).toContain('Back to workspace');
    expect(component).toContain('className={styles.titleAddBoard}');
    expect(component).toContain('aria-label="Add board"');
    expect(component).not.toContain('<span>Board</span>');
    expect(component).toContain("view === 'workspace' && workspace.id === state.activeWorkspaceId");
    expect(component).toContain("weekday: 'long'");
    expect(component).not.toContain('Toggle workspace density');
    expect(component).not.toContain('Show date');
    expect(component).toContain('draggable');
    expect(stylesheet).toContain('--nt-search-tint');
    expect(stylesheet).toContain('var(--nt-search-tint)');
    expect(stylesheet).toContain('container-type: inline-size');
    expect(stylesheet).toContain('@container (max-width: 1040px)');
    expect(stylesheet).toContain('@container (max-width: 760px)');
    expect(stylesheet).toContain('@container (max-width: 480px)');
    expect(`${component}\n${model}`.toLowerCase()).not.toContain(retiredDonorBrand);
    expect(browser).toContain('title="Developer Tools"');
    expect(browser).toContain('title="History"');
    expect(browser).toContain('browser-panel-search-input');
    expect(browser).toContain('<span>Edit Bookmark</span>');
    expect(browser).toContain('void importBookmarks()');
    expect(browser).toContain('void exportBookmarks()');
    expect(browser).toContain('Delete all bookmarks?');
    expect(browser).toContain('setBookmarkDeleteAllPending(true)');
    expect(browser).toContain('browser-tab-strip flex shrink-0 basis-6 items-stretch gap-0');
    expect(browser).toContain('browser-omnibox-shell');
    expect(browser).toContain('browser-bookmarks-bar');
    expect(browser).toContain('style={{ height: 24, minHeight: 24, maxHeight: 24 }}');
    expect(browser).toContain(
      'ml-1 grid h-6 w-6 shrink-0 self-center place-items-center border border-white/6 text-[#8fa5b8]',
    );
    expect(component).toContain('nammu-glass-dialog');
    expect(component).toContain('nammu-new-tab-menu');
    expect(browser).not.toContain('Browsing History');
    expect(browserMenu).toContain('Proxy Manager');
    expect(browserMenu).not.toContain('Public Proxy Manager');
    expect(browserMenu).not.toContain('Close browser menu');
    expect(proxyManager).toContain('Proxy Manager');
    expect(proxyManager).not.toContain('Public Proxy Manager');
  });
});
