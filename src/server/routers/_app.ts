import { router } from '../trpc';
import { authRouter } from './auth';
import { accountsRouter } from './accounts';
import { filesRouter } from './files';
import { notesRouter } from './notes';
import { calendarRouter } from './calendar';
import { projectsRouter } from './projects';
import { settingsRouter } from './settings';
import { browserRouter } from './browser';
import { systemRouter } from './system';
import { appStoreRouter } from './appStore';

export const appRouter = router({
  auth: authRouter,
  accounts: accountsRouter,
  files: filesRouter,
  notes: notesRouter,
  calendar: calendarRouter,
  projects: projectsRouter,
  settings: settingsRouter,
  browser: browserRouter,
  system: systemRouter,
  appStore: appStoreRouter,
});

export type AppRouter = typeof appRouter;
