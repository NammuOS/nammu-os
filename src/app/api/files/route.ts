import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';

import { db } from '@/db';
import { cloudAccounts, fileMetadata } from '@/db/schema';
import { normalizeVirtualPath } from '@/server/services/googleDriveService';

const USER_ID = 'local-default-user';

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const path = normalizeVirtualPath(searchParams.get('path') || '/');
    const isStarred = searchParams.get('starred') === '1';
    const isTrash = searchParams.get('trash') === '1';
    const isRecent = searchParams.get('recent') === '1';
    const isShared = searchParams.get('shared') === '1';
    const search = (searchParams.get('search') || '').trim().toLowerCase();

    const [list, accounts] = await Promise.all([
      db.query.fileMetadata.findMany({ where: eq(fileMetadata.userId, USER_ID) }),
      db.query.cloudAccounts.findMany({ where: eq(cloudAccounts.userId, USER_ID) }),
    ]);
    const accountMap = new Map(accounts.map((account) => [account.id, account]));

    // Shared-item metadata is not represented by the local filesystem schema yet.
    // Return an honest empty collection instead of leaking root files into Shared.
    if (isShared) return NextResponse.json({ data: [] });

    let filtered = list;
    if (isTrash) {
      filtered = filtered.filter((file) => file.isTrashed);
    } else {
      filtered = filtered.filter((file) => !file.isTrashed);
      if (isStarred) {
        filtered = filtered.filter((file) => file.isStarred);
      } else if (search) {
        filtered = filtered.filter((file) => file.fileName.toLowerCase().includes(search));
      } else if (isRecent) {
        filtered = filtered
          .filter((file) => !file.isFolder)
          .sort((a, b) => {
            const aTime = Date.parse(a.remoteModifiedTime || a.updatedAt.toISOString());
            const bTime = Date.parse(b.remoteModifiedTime || b.updatedAt.toISOString());
            return bTime - aTime;
          })
          .slice(0, 50);
      } else {
        // virtualPath is the parent directory. Exact matching prevents descendants
        // from leaking into the current folder and preserves the Drive hierarchy.
        filtered = filtered.filter((file) => normalizeVirtualPath(file.virtualPath) === path);
      }
    }

    const formatted = filtered.map((file) => {
      const account = accountMap.get(file.cloudAccountId);
      const createdAt = file.remoteCreatedTime || file.createdAt.toISOString();
      const updatedAt = file.remoteModifiedTime || file.updatedAt.toISOString();

      return {
        id: file.id,
        name: file.fileName,
        file_name: file.fileName,
        path: normalizeVirtualPath(file.virtualPath),
        virtual_path: normalizeVirtualPath(file.virtualPath),
        is_folder: Boolean(file.isFolder),
        is_starred: Boolean(file.isStarred),
        is_trashed: Boolean(file.isTrashed),
        size: Number(file.size || 0),
        mime_type: file.mimeType || 'application/octet-stream',
        cloud_account_id: file.cloudAccountId,
        remote_file_id: file.remoteFileId,
        remote_parent_id: file.remoteParentId,
        provider: account?.provider,
        email: account?.email,
        created_at: createdAt,
        updated_at: updatedAt,
      };
    });

    return NextResponse.json({ data: formatted });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to list cloud files.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
