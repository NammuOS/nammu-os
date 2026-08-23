import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { fileMetadata, cloudAccounts } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const path = searchParams.get('path') || '/';
    const isStarred = searchParams.get('starred') === '1';
    const isTrash = searchParams.get('trash') === '1';
    const isRecent = searchParams.get('recent') === '1';
    const search = searchParams.get('search') || '';

    const list = await db.query.fileMetadata.findMany({
      where: eq(fileMetadata.userId, 'local-default-user'),
    });

    const accounts = await db.query.cloudAccounts.findMany({
      where: eq(cloudAccounts.userId, 'local-default-user'),
    });
    const accountMap = new Map(accounts.map((a) => [a.id, a]));

    let filtered = list;

    if (isTrash) {
      filtered = filtered.filter((f) => f.isTrashed);
    } else {
      filtered = filtered.filter((f) => !f.isTrashed);

      if (isStarred) {
        filtered = filtered.filter((f) => f.isStarred);
      } else if (search.trim()) {
        const s = search.toLowerCase();
        filtered = filtered.filter((f) => (f.fileName || '').toLowerCase().includes(s));
      } else if (!isRecent) {
        filtered = filtered.filter((f) => (f.virtualPath || '').startsWith(path));
      }
    }

    const formatted = filtered.map((f) => {
      const acc = accountMap.get(f.cloudAccountId);
      const fileName = f.fileName || 'Untitled';
      const virtualPath = f.virtualPath || `/${fileName}`;

      return {
        id: f.id,
        name: fileName,
        file_name: fileName,
        path: virtualPath,
        virtual_path: virtualPath,
        is_folder: Boolean(f.isFolder),
        is_starred: Boolean(f.isStarred),
        is_trashed: Boolean(f.isTrashed),
        size: Number(f.size || 0),
        mime_type: f.mimeType || 'application/octet-stream',
        cloud_account_id: f.cloudAccountId,
        remote_file_id: f.remoteFileId,
        provider: acc?.provider,
        email: acc?.email,
        created_at: f.createdAt ? new Date(f.createdAt).toISOString() : new Date().toISOString(),
        updated_at: f.updatedAt ? new Date(f.updatedAt).toISOString() : new Date().toISOString(),
      };
    });

    return NextResponse.json({ data: formatted });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
