import { NextRequest, NextResponse } from 'next/server';
import {
  LOCAL_SETTINGS_USER_ID,
  postgresSettingsRepository,
} from '@/server/repositories/settingsRepository';
import {
  isSettingsPayloadError,
  normalizeSettingMutation,
} from '@/server/services/settingsPayloads.mjs';

export async function GET() {
  try {
    const list = await postgresSettingsRepository.list(LOCAL_SETTINGS_USER_ID);

    const map: Record<string, string> = {};
    for (const item of list) {
      map[item.key] = item.value;
    }

    return NextResponse.json({ data: map });
  } catch {
    return NextResponse.json({ error: 'Settings could not be loaded.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { key, value } = normalizeSettingMutation(await req.json());
    await postgresSettingsRepository.upsert(LOCAL_SETTINGS_USER_ID, key, value);

    return NextResponse.json({ success: true, key, value });
  } catch (error) {
    return NextResponse.json(
      { error: isSettingsPayloadError(error) ? error.message : 'The setting could not be saved.' },
      { status: isSettingsPayloadError(error) ? 400 : 500 },
    );
  }
}
