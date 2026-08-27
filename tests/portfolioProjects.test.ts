import { describe, expect, test } from 'bun:test';
import {
  filterPortfolioProjects,
  PORTFOLIO_PROJECTS,
  PROJECT_CATEGORIES,
} from '../src/lib/portfolioProjects';

describe('Projects portfolio collection', () => {
  test('contains the four supplied projects with unique identifiers and URLs', () => {
    expect(PORTFOLIO_PROJECTS).toHaveLength(4);
    expect(new Set(PORTFOLIO_PROJECTS.map((project) => project.id)).size).toBe(4);
    expect(PORTFOLIO_PROJECTS.map((project) => project.url)).toEqual([
      'https://navtube.vercel.app/',
      'https://hoobankk.vercel.app/',
      'https://nammu-os.vercel.app/',
      'https://timeless-pages.vercel.app/',
    ]);
  });

  test('uses a concise product category model with room for future mobile work', () => {
    expect(PROJECT_CATEGORIES).toEqual(['All', 'Web', 'Desktop', 'Mobile']);
    expect(filterPortfolioProjects(PORTFOLIO_PROJECTS, '', 'Web')).toHaveLength(3);
    expect(filterPortfolioProjects(PORTFOLIO_PROJECTS, '', 'Desktop')).toHaveLength(1);
    expect(filterPortfolioProjects(PORTFOLIO_PROJECTS, '', 'Mobile')).toHaveLength(0);
  });

  test('searches titles, descriptions, domains, and technologies', () => {
    expect(filterPortfolioProjects(PORTFOLIO_PROJECTS, 'youtube', 'All')[0]?.id).toBe('navtube');
    expect(filterPortfolioProjects(PORTFOLIO_PROJECTS, 'tailwind', 'All')[0]?.id).toBe('hoobank');
    expect(filterPortfolioProjects(PORTFOLIO_PROJECTS, 'bookstore', 'All')[0]?.id).toBe(
      'timeless-pages',
    );
  });
});
