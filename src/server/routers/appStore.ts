import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { OFFICIAL_NAMMU_REGISTRY } from '@/platform/store/storeRegistry';

const apps = OFFICIAL_NAMMU_REGISTRY.apps;
const legacyCompatibleApps = apps.map((app) => ({
  manifestVersion: '1',
  id: app.id,
  name: app.name,
  tagline: app.tagline,
  icon: app.icon,
  category: app.category.toLowerCase(),
  version: app.release.version,
  description: app.description,
  website: app.repository,
  developer: app.developer,
  repo: app.repository,
  support: app.repository,
  gallery: app.screenshots,
  releaseNotes: app.release.releaseNotes,
  permissions: app.permissions,
  installSize: app.release.size,
  appStoreId: OFFICIAL_NAMMU_REGISTRY.id,
}));

export const appStoreRouter = router({
  registry: publicProcedure.query(() => [
    {
      meta: { id: OFFICIAL_NAMMU_REGISTRY.id, name: OFFICIAL_NAMMU_REGISTRY.name },
      apps: legacyCompatibleApps,
    },
  ]),

  storefront: publicProcedure.query(() => ({
    sections: [
      {
        id: 'official-applications',
        type: 'app-list' as const,
        title: 'Applications',
        layout: 'grid' as const,
        appIds: apps.map((app) => app.id),
      },
    ],
    categories: [{ id: 'productivity', featuredAppIds: apps.map((app) => app.id) }],
    apps: apps.map((app) => ({
      id: app.id,
      version: app.release.version,
      createdAt: app.release.publishedAt,
      updatedAt: app.release.publishedAt,
    })),
  })),

  appReleases: publicProcedure
    .input(z.object({ appId: z.string().min(1).max(160) }))
    .query(({ input }) => {
      const app = apps.find((candidate) => candidate.id === input.appId);
      return app
        ? [
            {
              version: app.release.version,
              date: app.release.publishedAt,
              notes: app.release.releaseNotes,
            },
          ]
        : [];
    }),

  app: publicProcedure
    .input(z.object({ appId: z.string().min(1).max(160) }))
    .query(({ input }) => legacyCompatibleApps.find((app) => app.id === input.appId) ?? null),

  search: publicProcedure
    .input(
      z.object({ query: z.string().max(200), limit: z.number().int().min(1).max(50).optional() }),
    )
    .query(({ input }) => {
      const query = input.query.toLowerCase().trim();
      if (!query) return legacyCompatibleApps.slice(0, input.limit ?? 20);
      return legacyCompatibleApps
        .filter((app) =>
          [app.name, app.tagline, app.description, app.category, app.developer].some((value) =>
            value.toLowerCase().includes(query),
          ),
        )
        .slice(0, input.limit ?? 20);
    }),

  categories: publicProcedure.query(() =>
    Array.from(new Set(apps.map((app) => app.category))).map((id) => ({
      id: id.toLowerCase(),
      count: apps.filter((app) => app.category === id).length,
    })),
  ),
});
