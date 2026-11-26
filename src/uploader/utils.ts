import * as fs from 'fs';
import * as path from 'path';

export function isSafePathSegment(segment: string): boolean {
  if (!segment || typeof segment !== 'string') return false;
  if (segment === '.' || segment === '..') return false;
  if (segment.includes('/') || segment.includes('\\')) return false;
  return /^[a-zA-Z0-9_\-.~]+$/.test(segment);
}

export function ensureDirectoryExists(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function getPngDimensions(filePath: string): { width: number; height: number } | null {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(24);
    fs.readSync(fd, buf, 0, 24, 0);
    fs.closeSync(fd);
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return { width, height };
    }
  } catch {}
  return null;
}

export function cleanXmlText(s?: string): string {
  if (!s) return '';
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#169;/g, '©')
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\{0\}/g, '')
    .trim();
}

export function readJsonSafely<T>(filePath: string): T | null {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(data) as T;
    }
  } catch {}
  return null;
}

export function writeJsonSafely(filePath: string, data: any): void {
  try {
    ensureDirectoryExists(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch {}
}

const GAME_TITLES: Record<string, string> = {
  KLP: 'Love Plus Arcade Colorful Clip',
  TBS: 'Busou Shinki Armored Princess Battle Conductor',
  CC: 'Card Connect',
};

export function getGameTitleFromModel(model?: string): string {
  if (!model || model === 'UNKNOWN') return 'Unknown';
  const prefix = (model.split(':')[0] || model.substring(0, 3)).toUpperCase();
  return GAME_TITLES[prefix] || model;
}
