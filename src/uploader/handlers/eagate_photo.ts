import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { IUploadHandler, UploadContext, UploadFile, UploadItem, UploadUIConfig } from '../types';
import {
  isSafePathSegment,
  ensureDirectoryExists,
  getPngDimensions,
  readJsonSafely,
  writeJsonSafely,
  getGameTitleFromModel,
} from '../utils';

export class EAGatePhotoHandler implements IUploadHandler {
  readonly type = 'eagate_photo';

  readonly uiConfig: UploadUIConfig = {
    type: 'eagate_photo',
    label: 'Photos',
    icon: 'image',
    isCard: false,
    supportsPrint: false,
    supportsDownload: true,
  };

  matches(gameModel: string, files?: UploadFile[]): boolean {
    const upper = (gameModel || '').toUpperCase();
    if (upper.startsWith('KLP')) return true;
    if (
      files &&
      files.some(f => {
        const lower = f.filename.toLowerCase();
        return lower.includes('photo_') || lower.includes('accesskey.dat');
      })
    ) {
      return true;
    }
    return false;
  }

  async saveUpload(
    ctx: UploadContext,
    files: UploadFile[]
  ): Promise<{ count: number; savedFiles: string[] }> {
    if (!isSafePathSegment(ctx.refId)) {
      throw new Error(`Invalid refId: ${ctx.refId}`);
    }

    const savedFiles: string[] = [];
    const userDir = path.join(ctx.baseDir, ctx.refId);
    ensureDirectoryExists(userDir);

    let accessKey: string | undefined;
    for (const f of files) {
      if (path.basename(f.filename).toLowerCase() === 'accesskey.dat') {
        accessKey = f.data.toString('utf-8').trim();
        break;
      }
    }

    for (const file of files) {
      const safeName = path.basename(file.filename);
      const filePath = path.join(userDir, safeName);
      fs.writeFileSync(filePath, file.data);
      savedFiles.push(safeName);

      const lower = safeName.toLowerCase();
      if (
        (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')) &&
        !lower.endsWith('.json')
      ) {
        const hash = crypto.createHash('sha256').update(file.data).digest('hex');
        const jsonPath = path.join(userDir, `${safeName}.json`);
        writeJsonSafely(jsonPath, {
          gameModel: ctx.gameModel,
          gameTitle: getGameTitleFromModel(ctx.gameModel),
          uploadTime: new Date().toISOString(),
          timestamp: Date.now(),
          fileSizeBytes: file.data.length,
          sha256: hash,
          refId: ctx.refId,
          accessKey,
        });
      }
    }

    return { count: savedFiles.length, savedFiles };
  }

  async listItems(baseDir: string, gameCodes: string[], refId?: string): Promise<UploadItem[]> {
    const items: UploadItem[] = [];
    if (!fs.existsSync(baseDir)) return items;

    const userDirs = fs.readdirSync(baseDir, { withFileTypes: true });
    const targetCodes = gameCodes.map(c => c.toUpperCase());

    for (const u of userDirs) {
      if (!u.isDirectory()) continue;
      const userRefId = u.name;
      if (refId && userRefId.toUpperCase() !== refId.toUpperCase()) continue;

      const userPath = path.join(baseDir, userRefId);
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(userPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const lower = entry.name.toLowerCase();
        if (
          (!lower.endsWith('.jpg') && !lower.endsWith('.jpeg') && !lower.endsWith('.png')) ||
          lower.endsWith('.json') ||
          lower.includes('_holo') ||
          lower.includes('_ir') ||
          lower.includes('_front') ||
          lower.includes('_back')
        ) {
          continue;
        }

        const imgPath = path.join(userPath, entry.name);
        const stat = fs.statSync(imgPath);
        const jsonPath = path.join(userPath, `${entry.name}.json`);
        const meta = readJsonSafely<any>(jsonPath) || {};

        const rawModel = meta.gameModel || targetCodes[0] || 'KLP';
        const modelPrefix = rawModel.split(':')[0].toUpperCase();

        if (targetCodes.length > 0 && !targetCodes.some(code => modelPrefix.startsWith(code))) {
          continue;
        }

        const dimensions = getPngDimensions(imgPath) || undefined;
        const orientation: 'portrait' | 'landscape' =
          dimensions && dimensions.width >= dimensions.height ? 'landscape' : 'portrait';

        const url = `/photos/${encodeURIComponent(userRefId)}/${encodeURIComponent(entry.name)}`;

        items.push({
          id: entry.name,
          fileName: entry.name,
          refId: userRefId,
          gameModel: rawModel,
          gameTitle: meta.gameTitle || getGameTitleFromModel(rawModel),
          category: 'photo',
          title: entry.name,
          timestamp: meta.timestamp || stat.mtime.getTime(),
          uploadTime: meta.uploadTime || stat.mtime.toISOString(),
          fileSizeBytes: meta.fileSizeBytes || stat.size,
          sha256: meta.sha256,
          url,
          orientation,
          dimensions,
          isCard: false,
          isPrinted: true,
          photo: {
            accessKey: meta.accessKey,
          },
        });
      }
    }

    return items.sort((a, b) => b.timestamp - a.timestamp);
  }

  async deleteItem(baseDir: string, refId: string, itemId: string): Promise<boolean> {
    if (!isSafePathSegment(refId) || !isSafePathSegment(itemId)) return false;
    const targetFile = path.join(baseDir, refId, itemId);
    const jsonFile = path.join(baseDir, refId, `${itemId}.json`);

    let deleted = false;
    try {
      if (fs.existsSync(targetFile)) {
        fs.unlinkSync(targetFile);
        deleted = true;
      }
      if (fs.existsSync(jsonFile)) {
        fs.unlinkSync(jsonFile);
      }
    } catch {
      deleted = false;
    }
    return deleted;
  }
}
