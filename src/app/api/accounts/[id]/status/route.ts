import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: provider } = await params;
  const isConfigured = Boolean(
    provider === 'google' || provider === 'google_drive'
      ? process.env.GOOGLE_CLIENT_ID
      : provider === 'onedrive'
        ? process.env.ONEDRIVE_CLIENT_ID
        : provider === 'dropbox'
          ? process.env.DROPBOX_CLIENT_ID
          : provider === 'yandex'
            ? process.env.YANDEX_CLIENT_ID
            : true,
  );

  return NextResponse.json({
    data: {
      provider,
      configured: isConfigured,
      status: isConfigured ? 'ready' : 'missing_credentials',
    },
  });
}
