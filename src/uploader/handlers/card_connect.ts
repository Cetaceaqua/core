import * as fs from 'fs';
import * as path from 'path';
import {
  IUploadHandler,
  UploadContext,
  UploadFile,
  UploadItem,
  UploadUIConfig,
  CardExtraMeta,
} from '../types';
import {
  isSafePathSegment,
  ensureDirectoryExists,
  getPngDimensions,
  cleanXmlText,
  readJsonSafely,
  writeJsonSafely,
  getGameTitleFromModel,
} from '../utils';

export class CardConnectHandler implements IUploadHandler {
  readonly type = 'card_connect';

  readonly uiConfig: UploadUIConfig = {
    type: 'card_connect',
    label: 'Cards',
    icon: 'credit-card',
    isCard: true,
    supportsPrint: false,
    supportsDownload: true,
  };

  matches(gameModel: string, files?: UploadFile[]): boolean {
    const upper = (gameModel || '').toUpperCase();
    if (upper.startsWith('TBS') || upper.startsWith('CC')) return true;
    if (
      files &&
      files.some(f => {
        const lower = f.filename.toLowerCase();
        return (
          lower.includes('_front.') ||
          lower.includes('_holo.') ||
          lower.includes('_ir.') ||
          lower.includes('tbs_meta')
        );
      })
    ) {
      return true;
    }
    return false;
  }

  private parseCardMeta(dirPath: string): CardExtraMeta {
    const meta: CardExtraMeta = {};
    const xmlPath = path.join(dirPath, 'meta.xml');
    if (fs.existsSync(xmlPath)) {
      try {
        const xml = fs.readFileSync(xmlPath, 'utf-8');
        const descMatch = xml.match(/<description>([^<]*)<\/description>/);
        if (descMatch) meta.description = cleanXmlText(descMatch[1]);
        const dateMatch = xml.match(/<date_code>([\s\S]*?)<\/date_code>/);
        if (dateMatch) meta.dateCode = cleanXmlText(dateMatch[1]);
        const copyMatch = xml.match(/<copyright>([\s\S]*?)<\/copyright>/);
        if (copyMatch) meta.copyright = cleanXmlText(copyMatch[1]);
        const priceMatch = xml.match(/<price>(\d+)<\/price>/);
        if (priceMatch) meta.price = parseInt(priceMatch[1], 10);
        const createdMatch = xml.match(/<created>([^<]*)<\/created>/);
        if (createdMatch) meta.created = createdMatch[1].trim();
        const holoNameMatch = xml.match(/<selectable_holo>[\s\S]*?<name>([^<]*)<\/name>/);
        if (holoNameMatch) meta.holoName = holoNameMatch[1].trim();
        const holoPriceMatch = xml.match(/<selectable_holo>[\s\S]*?<price>(\d+)<\/price>/);
        if (holoPriceMatch) meta.holoPrice = parseInt(holoPriceMatch[1], 10);
      } catch {}
    }

    try {
      const files = fs.readdirSync(dirPath);
      for (const f of files) {
        if (f.startsWith('tbs_meta_') && f.endsWith('.json')) {
          const json = readJsonSafely<any>(path.join(dirPath, f));
          if (json) {
            meta.rawJson = { ...(meta.rawJson || {}), [f]: json };
            if (json.rarity != null) meta.rarity = json.rarity;
            if (json.body_base_id != null) meta.bodyBaseId = json.body_base_id;
            if (json.shinki_name) meta.shinkiName = json.shinki_name;
            if (json.name && !meta.shinkiName) meta.profileName = json.name;
          }
        }
      }
    } catch {}

    return meta;
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

    const querySubdir = (ctx.query?.subdir || ctx.query?.sub_dir || ctx.query?.arrange) as
      | string
      | undefined;
    const rawSubdir = querySubdir ? decodeURIComponent(querySubdir).trim() : '';
    const safeSubdir = isSafePathSegment(rawSubdir) ? rawSubdir : '';

    let baseCardId = '';
    for (const f of files) {
      const m = path
        .basename(f.filename)
        .match(/^([0-9A-Za-z_-]+)_(?:front|back|holo|ir|frontprev)\.[a-z]+$/i);
      if (m && m[1]) {
        baseCardId = m[1];
        break;
      }
    }

    const subDirName = safeSubdir || baseCardId || `upload_${Date.now()}`;
    const targetDir = path.join(userDir, subDirName);
    ensureDirectoryExists(targetDir);

    for (const file of files) {
      const safeName = path.basename(file.filename);
      const filePath = path.join(targetDir, safeName);
      fs.writeFileSync(filePath, file.data);
      savedFiles.push(`${subDirName}/${safeName}`);
    }

    const metaPath = path.join(targetDir, 'bundle.json');
    writeJsonSafely(metaPath, {
      gameModel: ctx.gameModel,
      gameTitle: getGameTitleFromModel(ctx.gameModel),
      uploadTime: new Date().toISOString(),
      timestamp: Date.now(),
      refId: ctx.refId,
      subDir: subDirName,
    });

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
      let subEntries: fs.Dirent[] = [];
      try {
        subEntries = fs.readdirSync(userPath, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of subEntries) {
        if (!entry.isDirectory()) continue;
        const subDirName = entry.name;
        const subDirPath = path.join(userPath, subDirName);

        let files: string[] = [];
        try {
          files = fs.readdirSync(subDirPath);
        } catch {
          continue;
        }

        let frontFile: string | null = null;
        let backFile: string | null = null;
        let holoFile: string | null = null;
        let irFile: string | null = null;
        let frontPrevFile: string | null = null;
        let cardId = '';

        for (const f of files) {
          const lower = f.toLowerCase();
          if (lower.includes('_front.') && !lower.includes('_frontprev.')) {
            frontFile = f;
            const m = f.match(/^([0-9A-Za-z_-]+)_front\.[a-z]+$/i);
            if (m) cardId = m[1];
          } else if (lower.includes('_back.')) {
            backFile = f;
          } else if (lower.includes('_holo.')) {
            holoFile = f;
          } else if (lower.includes('_ir.')) {
            irFile = f;
          } else if (lower.includes('_frontprev.')) {
            frontPrevFile = f;
          }
        }

        if (!frontFile && !frontPrevFile) continue;

        const bundleMeta = readJsonSafely<any>(path.join(subDirPath, 'bundle.json')) || {};
        const cardMeta = this.parseCardMeta(subDirPath);
        const rawModel = bundleMeta.gameModel || targetCodes[0] || 'TBS';
        const modelPrefix = rawModel.split(':')[0].toUpperCase();

        if (targetCodes.length > 0 && !targetCodes.some(code => modelPrefix.startsWith(code))) {
          continue;
        }

        const isPrinted = fs.existsSync(path.join(subDirPath, '.printed'));
        const displayFront = frontFile || frontPrevFile!;
        const frontPath = path.join(subDirPath, displayFront);
        const stat = fs.statSync(frontPath);
        const dimensions = getPngDimensions(frontPath) || undefined;
        const orientation: 'portrait' | 'landscape' =
          dimensions && dimensions.width >= dimensions.height ? 'landscape' : 'portrait';

        const frontUrl = `/photos/${encodeURIComponent(userRefId)}/${encodeURIComponent(
          subDirName
        )}/${encodeURIComponent(displayFront)}`;
        const previewUrl = frontPrevFile
          ? `/photos/${encodeURIComponent(userRefId)}/${encodeURIComponent(
              subDirName
            )}/${encodeURIComponent(frontPrevFile)}`
          : frontUrl;
        const backUrl = backFile
          ? `/photos/${encodeURIComponent(userRefId)}/${encodeURIComponent(
              subDirName
            )}/${encodeURIComponent(backFile)}`
          : undefined;
        const holoUrl = holoFile
          ? `/photos/${encodeURIComponent(userRefId)}/${encodeURIComponent(
              subDirName
            )}/${encodeURIComponent(holoFile)}`
          : undefined;
        const irUrl = irFile
          ? `/photos/${encodeURIComponent(userRefId)}/${encodeURIComponent(
              subDirName
            )}/${encodeURIComponent(irFile)}`
          : undefined;

        items.push({
          id: subDirName,
          fileName: displayFront,
          refId: userRefId,
          gameModel: rawModel,
          gameTitle: bundleMeta.gameTitle || getGameTitleFromModel(rawModel),
          category: 'card',
          title: cardMeta.shinkiName || cardMeta.description || cardId || displayFront,
          timestamp: bundleMeta.timestamp || stat.mtime.getTime(),
          uploadTime: bundleMeta.uploadTime || stat.mtime.toISOString(),
          fileSizeBytes: stat.size,
          url: frontUrl,
          orientation,
          dimensions,
          isCard: true,
          isPrinted,
          card: {
            cardId,
            subDir: subDirName,
            frontUrl,
            backUrl,
            holoUrl,
            irUrl,
            previewUrl,
            hasBack: !!backFile,
            hasHolo: !!holoFile,
            hasIr: !!irFile,
            hasFrontPrev: !!frontPrevFile,
            shinkiName: cardMeta.shinkiName,
            profileName: cardMeta.profileName,
            description: cardMeta.description,
            extraMeta: cardMeta,
          },
        });
      }
    }

    return items.sort((a, b) => b.timestamp - a.timestamp);
  }

  async deleteItem(baseDir: string, refId: string, itemId: string): Promise<boolean> {
    if (!isSafePathSegment(refId) || !isSafePathSegment(itemId)) return false;
    const targetDir = path.join(baseDir, refId, itemId);
    if (!fs.existsSync(targetDir)) return false;

    try {
      const stat = fs.statSync(targetDir);
      if (!stat.isDirectory()) {
        return false;
      }
      const files = fs.readdirSync(targetDir);
      for (const f of files) {
        try {
          fs.unlinkSync(path.join(targetDir, f));
        } catch {}
      }
      fs.rmdirSync(targetDir);
      return true;
    } catch {
      return false;
    }
  }

  async handleAction(baseDir: string, action: string, refId: string, itemId: string): Promise<any> {
    if (!isSafePathSegment(refId) || !isSafePathSegment(itemId)) {
      throw new Error('Invalid path parameters');
    }
    const targetDir = path.join(baseDir, refId, itemId);
    if (!fs.existsSync(targetDir)) {
      throw new Error('Card directory not found');
    }

    if (action === 'print') {
      const marker = path.join(targetDir, '.printed');
      fs.writeFileSync(marker, new Date().toISOString(), 'utf-8');
      return { isPrinted: true };
    }

    throw new Error(`Unsupported action: ${action}`);
  }
}
