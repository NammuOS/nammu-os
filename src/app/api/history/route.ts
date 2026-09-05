import { NextRequest, NextResponse } from 'next/server';
import {
  LOCAL_SETTINGS_USER_ID,
  postgresSettingsRepository,
} from '@/server/repositories/settingsRepository';
import {
  isSettingsPayloadError,
  normalizeHistoryEntry,
} from '@/server/services/settingsPayloads.mjs';

export async function GET() {
  try {
    const value = await postgresSettingsRepository.get(LOCAL_SETTINGS_USER_ID, 'tool_history');

    if (value) {
      return NextResponse.json(JSON.parse(value));
    }
    return NextResponse.json([]);
  } catch {
    return NextResponse.json({ error: 'History could not be loaded.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = normalizeHistoryEntry(await req.json());
    const created = await postgresSettingsRepository.prependHistory(
      LOCAL_SETTINGS_USER_ID,
      'tool_history',
      body,
      50,
    );
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: isSettingsPayloadError(error) ? error.message : 'History could not be saved.' },
      { status: isSettingsPayloadError(error) ? 400 : 500 },
    );
  }
}
