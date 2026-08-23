import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { cloudAccounts } from '@/db/schema';
import crypto from 'crypto';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: provider } = await params;
  const state = crypto.randomBytes(16).toString('hex');
  const origin = req.nextUrl.origin;

  let authorizationUrl = '';

  if (provider === 'google' || provider === 'google_drive') {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${origin}/api/accounts/google/callback`;
    if (!clientId) {
      return NextResponse.json(
        { error: 'Google Client ID not configured in .env' },
        { status: 400 },
      );
    }
    authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${encodeURIComponent('openid email profile https://www.googleapis.com/auth/drive')}&access_type=offline&prompt=consent&state=${state}`;
  } else if (provider === 'onedrive') {
    const clientId = process.env.ONEDRIVE_CLIENT_ID;
    const redirectUri =
      process.env.ONEDRIVE_REDIRECT_URI || `${origin}/api/accounts/onedrive/callback`;
    if (!clientId) {
      return NextResponse.json(
        { error: 'OneDrive Client ID not configured in .env' },
        { status: 400 },
      );
    }
    authorizationUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent('Files.ReadWrite.All offline_access User.Read')}&state=${state}`;
  } else if (provider === 'dropbox') {
    const clientId = process.env.DROPBOX_CLIENT_ID;
    const redirectUri =
      process.env.DROPBOX_REDIRECT_URI || `${origin}/api/accounts/dropbox/callback`;
    if (!clientId) {
      return NextResponse.json(
        { error: 'Dropbox Client ID not configured in .env' },
        { status: 400 },
      );
    }
    authorizationUrl = `https://www.dropbox.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&token_access_type=offline&state=${state}`;
  } else if (provider === 'yandex') {
    const clientId = process.env.YANDEX_CLIENT_ID;
    const redirectUri = process.env.YANDEX_REDIRECT_URI || `${origin}/api/accounts/yandex/callback`;
    if (!clientId) {
      return NextResponse.json(
        { error: 'Yandex Client ID not configured in .env' },
        { status: 400 },
      );
    }
    authorizationUrl = `https://oauth.yandex.com/authorize?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
  } else {
    return NextResponse.json({ error: `Unsupported OAuth provider: ${provider}` }, { status: 400 });
  }

  return NextResponse.json({ data: { authorizationUrl, state } });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: provider } = await params;
  const body = await req.json();
  const id = crypto.randomUUID();

  // Mega, S3, pCloud direct credentials
  const email = body.email || body.username || body.bucket || `${provider}-user`;
  const credentials = JSON.stringify(body);

  const account = {
    id,
    userId: 'local-default-user',
    email,
    provider,
    encryptedCredentials: Buffer.from(credentials).toString('base64'),
    totalSpace: Number(body.totalSpace || 20 * 1024 * 1024 * 1024), // 20GB default
    usedSpace: 0,
    status: 'active',
  };

  const { ensureDefaultUser } = await import('@/db');
  await ensureDefaultUser();

  await db.insert(cloudAccounts).values(account);

  return NextResponse.json(
    {
      data: {
        id,
        email,
        provider,
        total_space: account.totalSpace,
        used_space: 0,
        status: 'active',
      },
    },
    { status: 201 },
  );
}
