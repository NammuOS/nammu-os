import { router, publicProcedure, protectedProcedure } from '../trpc';
import { z } from 'zod';

const NAMMU_APP_STORE_REPO = 'https://apps.umbrel.com/api/v3/umbrelos/app-store';

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 10000): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function fetchAppRegistry(): Promise<{ meta: { id: string; name: string }; apps: any[] }[]> {
  try {
    const response = await fetchWithTimeout(`${NAMMU_APP_STORE_REPO}/index.json`);
    if (!response.ok) throw new Error(`Failed to fetch registry: ${response.status}`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Failed to fetch app registry:', error);
    return [];
  }
}

async function fetchStorefront(): Promise<any> {
  try {
    const response = await fetchWithTimeout(`${NAMMU_APP_STORE_REPO}/storefront.json`);
    if (!response.ok) throw new Error(`Failed to fetch storefront: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch storefront:', error);
    return null;
  }
}

async function fetchAppReleases(appId: string): Promise<any[]> {
  try {
    const response = await fetchWithTimeout(`${NAMMU_APP_STORE_REPO}/apps/${appId}/releases.json`);
    if (!response.ok) throw new Error(`Failed to fetch releases: ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch releases for ${appId}:`, error);
    return [];
  }
}

export const appStoreRouter = router({
  registry: publicProcedure.query(async () => {
    const registries = await fetchAppRegistry();
    return registries;
  }),

  storefront: publicProcedure.query(async () => {
    const storefront = await fetchStorefront();
    return storefront;
  }),

  appReleases: publicProcedure
    .input(z.object({ appId: z.string() }))
    .query(async ({ input }) => {
      const releases = await fetchAppReleases(input.appId);
      return releases;
    }),

  app: publicProcedure
    .input(z.object({ appId: z.string() }))
    .query(async ({ input }) => {
      const registries = await fetchAppRegistry();
      for (const registry of registries) {
        const app = registry.apps.find((a: any) => a.id === input.appId);
        if (app) return app;
      }
      return null;
    }),

  search: publicProcedure
    .input(z.object({ query: z.string(), limit: z.number().optional() }))
    .query(async ({ input }) => {
      const registries = await fetchAppRegistry();
      const allApps = registries.flatMap((r) => r.apps);
      const query = input.query.toLowerCase().trim();
      if (!query) return allApps.slice(0, input.limit || 20);

      const results = allApps
        .filter((app: any) =>
          app.name.toLowerCase().includes(query) ||
          app.tagline.toLowerCase().includes(query) ||
          app.description.toLowerCase().includes(query) ||
          app.category.toLowerCase().includes(query) ||
          app.developer?.toString().toLowerCase().includes(query),
        )
        .sort((a: any, b: any) => {
          const aName = a.name.toLowerCase().startsWith(query) ? 0 : 1;
          const bName = b.name.toLowerCase().startsWith(query) ? 0 : 1;
          return aName - bName;
        });

      return results.slice(0, input.limit || 20);
    }),

  categories: publicProcedure.query(async () => {
    const registries = await fetchAppRegistry();
    const allApps = registries.flatMap((r) => r.apps);
    const categoryCounts: Record<string, number> = {};

    for (const app of allApps) {
      categoryCounts[app.category] = (categoryCounts[app.category] || 0) + 1;
    }

    return Object.entries(categoryCounts)
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count);
  }),
});