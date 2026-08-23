import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { cloudAccounts } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';
import { google } from 'googleapis';
import { syncGoogleDrive } from '@/server/services/googleDriveService';

function renderOAuthHtml(provider: string, status: string, message = '') {
  const oauthResult = JSON.stringify({
    type: 'cloud_oauth_complete',
    provider,
    status,
    message,
  }).replaceAll('<', '\\u003c');

  return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<title>${status === 'success' ? 'Account Connected' : 'Connection Failed'} - Nammu OS Cloud</title>
	<style>
		body {
			background: #06090e;
			color: #e3edf7;
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
			display: flex;
			align-items: center;
			justify-content: center;
			height: 100vh;
			margin: 0;
			text-align: center;
		}
		.card {
			background: #090e17;
			border: 1px solid rgba(255,255,255,0.08);
			padding: 24px 32px;
			border-radius: 12px;
			max-width: 360px;
			box-shadow: 0 16px 40px rgba(0,0,0,0.8);
		}
		.title { font-size: 15px; font-weight: 600; margin-bottom: 8px; color: ${status === 'success' ? '#2ee6a6' : '#ef4444'}; }
		.desc { font-size: 11px; color: #8da2b5; line-height: 1.5; }
	</style>
</head>
<body>
	<div class="card">
		<div class="title">${status === 'success' ? '✓ Account Connected' : '✕ Connection Error'}</div>
		<div class="desc">${status === 'success' ? `Successfully linked ${provider}. Returning to Nammu OS...` : message}</div>
	</div>
	<script>
		try {
			const result = ${oauthResult};
			if (window.opener) {
				window.opener.postMessage(result, '*');
			}
			if ('BroadcastChannel' in window) {
				const channel = new BroadcastChannel('nammu-cloud-oauth');
				channel.postMessage(result);
				channel.close();
			}
			setTimeout(() => window.close(), 1000);
		} catch (e) {}
	</script>
</body>
</html>`;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: provider } = await params;
  const searchParams = req.nextUrl.searchParams;
  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const origin = req.nextUrl.origin;

  if (error) {
    return new NextResponse(renderOAuthHtml(provider, 'error', error), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  if (!code) {
    return new NextResponse(renderOAuthHtml(provider, 'error', 'No authorization code received'), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  try {
    let email = `${provider}-user@nammu.os`;
    let tokens: any = { code };
    let totalSpace = 15 * 1024 * 1024 * 1024; // 15 GB default
    let usedSpace = 0;

    if (provider === 'google' || provider === 'google_drive') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${origin}/api/accounts/google/callback`;

      if (clientId && clientSecret) {
        const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
        const { tokens: exchangedTokens } = await oauth2Client.getToken(code);
        tokens = exchangedTokens;
        oauth2Client.setCredentials(exchangedTokens);

        const drive = google.drive({ version: 'v3', auth: oauth2Client });
        try {
          const aboutRes = await drive.about.get({
            fields: 'user(displayName,emailAddress),storageQuota(limit,usage)',
          });

          if (aboutRes.data.user?.emailAddress) {
            email = aboutRes.data.user.emailAddress;
          }
          if (aboutRes.data.storageQuota?.limit) {
            totalSpace = Number(aboutRes.data.storageQuota.limit);
          }
          if (aboutRes.data.storageQuota?.usage) {
            usedSpace = Number(aboutRes.data.storageQuota.usage);
          }
        } catch (aboutErr) {
          console.warn('Drive about.get failed, trying userinfo endpoint', aboutErr);
          try {
            const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
            const userInfo = await oauth2.userinfo.get();
            if (userInfo.data.email) email = userInfo.data.email;
          } catch {}
        }
      }
    }

    const normProvider = provider === 'google' ? 'google_drive' : provider;
    const userId = 'local-default-user';

    const { ensureDefaultUser } = await import('@/db');
    await ensureDefaultUser();

    // Check if account already exists
    const existing = await db.query.cloudAccounts.findFirst({
      where: and(
        eq(cloudAccounts.userId, userId),
        eq(cloudAccounts.provider, normProvider),
        eq(cloudAccounts.email, email),
      ),
    });

    const encryptedCredentials = Buffer.from(JSON.stringify(tokens)).toString('base64');
    const accountId = existing ? existing.id : crypto.randomUUID();

    if (existing) {
      await db
        .update(cloudAccounts)
        .set({
          encryptedCredentials,
          totalSpace,
          usedSpace,
          status: 'active',
          updatedAt: new Date(),
        })
        .where(eq(cloudAccounts.id, existing.id));
    } else {
      await db.insert(cloudAccounts).values({
        id: accountId,
        userId,
        email,
        provider: normProvider,
        encryptedCredentials,
        totalSpace,
        usedSpace,
        status: 'active',
      });
    }

    // Automatically synchronize Google Drive files into Nammu OS file metadata
    if (normProvider === 'google_drive') {
      try {
        await syncGoogleDrive(accountId);
      } catch (syncErr) {
        console.error('Initial Google Drive sync error:', syncErr);
      }
    }

    return new NextResponse(renderOAuthHtml(provider, 'success'), {
      headers: { 'Content-Type': 'text/html' },
    });
  } catch (err: any) {
    return new NextResponse(
      renderOAuthHtml(provider, 'error', err?.message || 'OAuth token exchange failed'),
      {
        headers: { 'Content-Type': 'text/html' },
      },
    );
  }
}
