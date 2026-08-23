'use server';

import { db } from '@/db';
import { notes, calendarEvents, projects, userSettings } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

export async function saveUserSettingsAction(userId: string, key: string, value: string) {
  const existing = await db.query.userSettings.findFirst({
    where: and(eq(userSettings.userId, userId), eq(userSettings.key, key)),
  });

  if (existing) {
    await db
      .update(userSettings)
      .set({ value, updatedAt: new Date() })
      .where(eq(userSettings.id, existing.id));
  } else {
    await db.insert(userSettings).values({
      id: crypto.randomUUID(),
      userId,
      key,
      value,
    });
  }

  return { success: true };
}

export async function createNoteAction(
  userId: string,
  title: string,
  content = '',
  folder = 'Notes',
) {
  const id = crypto.randomUUID();
  await db.insert(notes).values({
    id,
    userId,
    title,
    content,
    folder,
    tags: '[]',
  });
  return { success: true, id };
}

export async function createProjectAction(
  userId: string,
  title: string,
  space = 'General',
  priority = 'medium',
) {
  const id = crypto.randomUUID();
  await db.insert(projects).values({
    id,
    userId,
    title,
    space,
    priority,
    status: 'active',
    tags: '[]',
    tasks: '[]',
  });
  return { success: true, id };
}
