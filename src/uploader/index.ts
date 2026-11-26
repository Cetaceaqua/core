import { Router, Request, Response, raw } from 'express';
import * as path from 'path';
import { extractTar } from '../utils/tar';
import { uploadRegistry } from './registry';
import { UploadContext, UploadFile } from './types';
import { ensureDirectoryExists } from './utils';
import { SAVE_PATH } from '../utils/EamuseIO';

export const uploaderRouter = Router();

function getPhotosDir(): string {
  return path.join(SAVE_PATH, 'photos');
}

interface MultipartPart {
  headers: Record<string, string>;
  name?: string;
  filename?: string;
  contentType?: string;
  data: Buffer;
}

function parseMultipartBody(body: Buffer, contentTypeHeader?: string): MultipartPart[] | null {
  let boundary: Buffer | null = null;
  if (contentTypeHeader) {
    const m = contentTypeHeader.match(/boundary=([^;]+)/i);
    if (m && m[1]) {
      let bStr = m[1].trim();
      if (bStr.startsWith('"') && bStr.endsWith('"')) {
        bStr = bStr.slice(1, -1);
      }
      boundary = Buffer.from(`--${bStr}`);
    }
  }

  if (!boundary) {
    const bIdx = body.indexOf(Buffer.from('--'));
    if (bIdx !== -1 && bIdx < 128) {
      const crlf = body.indexOf(Buffer.from('\r\n'), bIdx);
      if (crlf !== -1) {
        boundary = body.subarray(bIdx, crlf);
      }
    }
  }

  if (!boundary || boundary.length === 0) return null;

  const parts: MultipartPart[] = [];
  let offset = body.indexOf(boundary);
  if (offset === -1) return null;

  while (offset < body.length) {
    const nextIdx = body.indexOf(boundary, offset + boundary.length);
    if (nextIdx === -1) break;

    let partChunk = body.subarray(offset + boundary.length, nextIdx);
    if (partChunk.length >= 2 && partChunk[0] === 0x0d && partChunk[1] === 0x0a) {
      partChunk = partChunk.subarray(2);
    }
    if (
      partChunk.length >= 2 &&
      partChunk[partChunk.length - 2] === 0x0d &&
      partChunk[partChunk.length - 1] === 0x0a
    ) {
      partChunk = partChunk.subarray(0, partChunk.length - 2);
    }

    const headerEnd = partChunk.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headerStr = partChunk.subarray(0, headerEnd).toString('utf-8');
      const partData = partChunk.subarray(headerEnd + 4);

      const headers: Record<string, string> = {};
      for (const line of headerStr.split(/\r?\n/)) {
        const colon = line.indexOf(':');
        if (colon !== -1) {
          headers[line.substring(0, colon).trim().toLowerCase()] = line.substring(colon + 1).trim();
        }
      }

      const disp = headers['content-disposition'] || '';
      const nameMatch = disp.match(/name="([^"]+)"/i);
      const fileMatch = disp.match(/filename="([^"]+)"/i);

      parts.push({
        headers,
        name: nameMatch ? nameMatch[1] : undefined,
        filename: fileMatch ? path.basename(fileMatch[1]) : undefined,
        contentType: headers['content-type'],
        data: partData,
      });
    }

    offset = nextIdx;
    if (
      body.subarray(offset + boundary.length, offset + boundary.length + 2).toString('ascii') ===
      '--'
    ) {
      break;
    }
  }

  return parts.length > 0 ? parts : null;
}

uploaderRouter.post(
  '/upload',
  raw({ type: '*/*', limit: '100mb' }),
  async (req: Request, res: Response) => {
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      return res.status(400).send('Empty Body');
    }

    const queryRef = (req.query.refid ||
      req.query.ref_id ||
      req.headers['x-eamuse-player-id'] ||
      req.headers['x-eamuse-user-id']) as string | undefined;
    const queryGame = (req.query.game || req.query.model || req.headers['x-eamuse-game-model']) as
      | string
      | undefined;
    const gameModel = queryGame ? String(queryGame).trim() : 'UNKNOWN';
    const refId = queryRef ? String(queryRef).trim() : 'UNKNOWN';

    const photosDir = getPhotosDir();
    ensureDirectoryExists(photosDir);

    const uploadFiles: UploadFile[] = [];
    const contentType = (req.headers['content-type'] as string) || '';
    const multipartParts = parseMultipartBody(body, contentType);

    if (multipartParts && multipartParts.length > 0) {
      for (const part of multipartParts) {
        const fileName =
          part.filename || (part.name ? `${part.name}.dat` : `part_${Date.now()}.dat`);
        uploadFiles.push({
          filename: fileName,
          data: part.data,
          contentType: part.contentType,
        });
      }
    } else {
      const extracted = extractTar(body);
      if (extracted && extracted.length > 0) {
        for (const f of extracted) {
          uploadFiles.push({
            filename: f.name,
            data: f.data,
          });
        }
      } else {
        const isPng =
          body.length >= 8 &&
          body[0] === 0x89 &&
          body[1] === 0x50 &&
          body[2] === 0x4e &&
          body[3] === 0x47;
        const imgExt = isPng ? '.png' : '.jpg';
        uploadFiles.push({
          filename: `photo_${Date.now()}${imgExt}`,
          data: body,
        });
      }
    }

    const handler = uploadRegistry.getHandlerForGame(gameModel, uploadFiles);
    const ctx: UploadContext = {
      baseDir: photosDir,
      refId,
      gameModel,
      headers: req.headers,
      query: req.query,
    };

    try {
      await handler.saveUpload(ctx, uploadFiles);
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Content-Length': '2',
        'X-Eamuse-Uploader-Status': '200',
      });
      res.end('OK');
    } catch (err: any) {
      res.status(500).send(err?.message || 'Upload error');
    }
  }
);

uploaderRouter.get('/api/photos', async (req: Request, res: Response) => {
  const photosDir = getPhotosDir();
  const { refid, game } = req.query;

  try {
    let items = [];
    if (typeof game === 'string' && game.trim()) {
      const handler = uploadRegistry.getHandlerForGame(game);
      items = await handler.listItems(
        photosDir,
        [game],
        typeof refid === 'string' ? refid : undefined
      );
    } else {
      const allHandlers = uploadRegistry.getAllHandlers();
      for (const h of allHandlers) {
        const subItems = await h.listItems(
          photosDir,
          [],
          typeof refid === 'string' ? refid : undefined
        );
        items.push(...subItems);
      }
      items.sort((a, b) => b.timestamp - a.timestamp);
    }

    res.json({
      success: true,
      count: items.length,
      photos: items,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err?.message });
  }
});

uploaderRouter.delete('/api/photos/:refid/:filename', async (req: Request, res: Response) => {
  const { refid, filename } = req.params;
  const photosDir = getPhotosDir();

  for (const handler of uploadRegistry.getAllHandlers()) {
    const deleted = await handler.deleteItem(photosDir, refid, filename);
    if (deleted) {
      return res.json({ success: true, message: `Deleted ${filename}` });
    }
  }

  res.status(404).json({ success: false, message: 'Photo not found' });
});

uploaderRouter.delete('/api/photos/subdir/:refid/:subdir', async (req: Request, res: Response) => {
  const { refid, subdir } = req.params;
  const photosDir = getPhotosDir();

  const handler = uploadRegistry.get('card_connect');
  if (handler) {
    const deleted = await handler.deleteItem(photosDir, refid, subdir);
    if (deleted) {
      return res.json({ success: true, message: `Deleted subdir ${subdir}` });
    }
  }

  res.status(404).json({ success: false, message: 'Subdir not found' });
});

uploaderRouter.post(
  '/api/photos/subdir/:refid/:subdir/print',
  async (req: Request, res: Response) => {
    const { refid, subdir } = req.params;
    const photosDir = getPhotosDir();

    const handler = uploadRegistry.get('card_connect');
    if (handler && handler.handleAction) {
      try {
        const result = await handler.handleAction(photosDir, 'print', refid, subdir, req.body);
        return res.json({ success: true, ...result });
      } catch (err: any) {
        return res.status(500).json({ success: false, message: err?.message });
      }
    }

    res.status(404).json({ success: false, message: 'Handler or action not supported' });
  }
);
