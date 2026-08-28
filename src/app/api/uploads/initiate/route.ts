import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';

import { db } from '@/db';
import { cloudAccounts, userSettings } from '@/db/schema';
import { isImplementedCloudProvider } from '@/server/adapters/adapterFactory';
import { normalizeVirtualPath, validateCloudFileName } from '@/server/services/googleDriveService';
import {
  selectBestAccount,
  withFreeSpace,
  type AllocationStrategy,
} from '@/server/services/spaceAllocator';
import { createUploadTicket } from '@/server/services/uploadTicketService';

const USER_ID = 'local-default-user';
const MAX_UPLOAD_SIZE = 5 * 1024 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fileName = validateCloudFileName(String(body.file_name || ''));
    const virtualPath = normalizeVirtualPath(body.virtual_path || '/');
    const size = Number(body.size);
    const mimeType = String(body.mime_type || 'application/octet-stream');
    const requestedAccountId = body.account_id ? String(body.account_id) : null;

    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_UPLOAD_SIZE) {
      return NextResponse.json(
        { error: 'The upload size is invalid or exceeds the 5 GB limit.' },
        { status: 400 },
      );
    }

    const connectedAccounts = await db.query.cloudAccounts.findMany({
      where: and(eq(cloudAccounts.userId, USER_ID), eq(cloudAccounts.status, 'active')),
    });
    const accounts = connectedAccounts.filter((account) =>
      isImplementedCloudProvider(account.provider),
    );
    if (!accounts.length) {
      return NextResponse.json(
        { error: 'Connect an active supported cloud account before uploading.' },
        { status: 409 },
      );
    }

    const candidateAccounts = requestedAccountId
      ? accounts.filter((account) => account.id === requestedAccountId)
      : accounts;
    if (!candidateAccounts.length) {
      return NextResponse.json(
        { error: 'The selected cloud account is not active or is no longer connected.' },
        { status: 409 },
      );
    }

    const savedAllocation = await db.query.userSettings.findFirst({
      where: and(eq(userSettings.userId, USER_ID), eq(userSettings.key, 'allocation_config')),
    });
    let strategy: AllocationStrategy = 'round_robin';
    let manualOrder: string[] = [];
    if (savedAllocation?.value) {
      try {
        const config = JSON.parse(savedAllocation.value);
        strategy = config.strategy || strategy;
        manualOrder = Array.isArray(config.manual_order) ? config.manual_order : [];
      } catch {}
    }

    const { selected } = selectBestAccount(
      USER_ID,
      candidateAccounts.map(withFreeSpace),
      strategy,
      size,
      manualOrder,
    );
    if (selected.freeSpace < size) {
      return NextResponse.json(
        { error: 'None of the connected cloud accounts has enough free space.' },
        { status: 507 },
      );
    }

    const uploadId = createUploadTicket({
      accountId: selected.id,
      fileName,
      mimeType,
      size,
      userId: USER_ID,
      virtualPath,
    });

    return NextResponse.json({
      uploadId,
      accountId: selected.id,
      data: { uploadId, accountId: selected.id },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start the upload.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
