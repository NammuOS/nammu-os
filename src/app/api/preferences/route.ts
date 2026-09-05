import { NextRequest, NextResponse } from 'next/server';
import {
  LOCAL_SETTINGS_USER_ID,
  postgresSettingsRepository,
} from '@/server/repositories/settingsRepository';
import {
  isSettingsPayloadError,
  normalizePreferences,
} from '@/server/services/settingsPayloads.mjs';

export async function GET() {
  try {
    const value = await postgresSettingsRepository.get(LOCAL_SETTINGS_USER_ID, 'user_preferences');

    if (value) {
      return NextResponse.json(JSON.parse(value));
    }
    return NextResponse.json({ pinned_tools: [], settings: {} });
  } catch {
    return NextResponse.json({ error: 'Preferences could not be loaded.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = normalizePreferences(await req.json());
    await postgresSettingsRepository.upsert(
      LOCAL_SETTINGS_USER_ID,
      'user_preferences',
      JSON.stringify(body),
    );

    return NextResponse.json(body, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: isSettingsPayloadError(error) ? error.message : 'Preferences could not be saved.',
      },
      { status: isSettingsPayloadError(error) ? 400 : 500 },
    );
  }
}
