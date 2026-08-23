import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { fileMetadata } from '@/db/schema';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const folderName = body.folder_name || body.name || 'New Folder';
    const parentPath = body.virtual_path || body.path || '/';
    const cleanParent = parentPath.endsWith('/') ? parentPath : `${parentPath}/`;
    const virtualPath = `${cleanParent}${folderName}/`;
    const id = crypto.randomUUID();

    const record = {
      id,
      userId: 'local-default-user',
      virtualPath,
      fileName: folderName,
      isFolder: true,
      isStarred: false,
      isTrashed: false,
      size: 0,
      mimeType: 'application/x-directory',
      cloudAccountId: 'local-folder',
      remoteFileId: id,
    };

    await db.insert(fileMetadata).values(record);

    return NextResponse.json(
      {
        data: {
          id,
          name: folderName,
          path: virtualPath,
          is_folder: true,
          is_starred: false,
          is_trashed: false,
          size: 0,
          cloud_account_id: 'local-folder',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
