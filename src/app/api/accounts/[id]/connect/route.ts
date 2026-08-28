import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { cloudAccounts } from '@/db/schema';
import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { syncCloudAccount } from '@/server/services/cloudSyncService';
import { createOAuthState } from '@/server/services/oauthStateService';
import { encryptJson } from '@/server/services/cryptoUtils';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: provider } = await params;
  const state = createOAuthState(provider, 'local-default-user');
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

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: provider } = await params;
  const body = await req.json();
  if (!['mega', 's3', 'pcloud'].includes(provider)) {
    return NextResponse.json(
      { error: `Unsupported direct provider: ${provider}` },
      { status: 400 },
    );
  }

  const userId = 'local-default-user';
  const email = String(body.email || body.username || body.bucket || '').trim();
  if (!email) return NextResponse.json({ error: 'Account identity is required.' }, { status: 400 });
  const credentials = provider === 'pcloud' ? { ...body, username: email } : body;
  const encryptedCredentials = encryptJson(credentials);
  const { ensureDefaultUser } = await import('@/db');
  await ensureDefaultUser();

  const existing = await db.query.cloudAccounts.findFirst({
    where: and(
      eq(cloudAccounts.userId, userId),
      eq(cloudAccounts.provider, provider),
      eq(cloudAccounts.email, email),
    ),
  });
  const id = existing?.id || crypto.randomUUID();

  try {
    if (existing) {
      await db
        .update(cloudAccounts)
        .set({ encryptedCredentials, status: 'active', updatedAt: new Date() })
        .where(eq(cloudAccounts.id, existing.id));
    } else {
      await db.insert(cloudAccounts).values({
        id,
        userId,
        email,
        provider,
        encryptedCredentials,
        totalSpace: Number(body.totalSpace || 0),
        usedSpace: 0,
        status: 'active',
      });
    }

    await syncCloudAccount(id);
    const account = await db.query.cloudAccounts.findFirst({ where: eq(cloudAccounts.id, id) });
    return NextResponse.json(
      {
        data: {
          id,
          email: account?.email || email,
          provider,
          total_space: account?.totalSpace || 0,
          used_space: account?.usedSpace || 0,
          status: account?.status || 'active',
        },
      },
      { status: existing ? 200 : 201 },
    );
  } catch (error) {
    if (existing) {
      await db
        .update(cloudAccounts)
        .set({
          encryptedCredentials: existing.encryptedCredentials,
          totalSpace: existing.totalSpace,
          usedSpace: existing.usedSpace,
          status: existing.status,
          updatedAt: new Date(),
        })
        .where(eq(cloudAccounts.id, existing.id));
    } else {
      await db.delete(cloudAccounts).where(eq(cloudAccounts.id, id));
    }
    const message = error instanceof Error ? error.message : `Unable to connect ${provider}.`;
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
