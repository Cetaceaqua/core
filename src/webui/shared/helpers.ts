import { Request } from 'express';
import { existsSync } from 'fs';
import path from 'path';
import { get, lowerCase, upperFirst, startCase } from 'lodash';
import { VERSION } from '../../utils/Consts';
import {
  CONFIG_MAP,
  CONFIG_DATA,
  CONFIG,
  CONFIG_OPTIONS,
  DATAFILE_MAP,
  FILE_CHECK,
} from '../../utils/ArgConfig';
import { PLUGIN_PATH, FindCardsByRefid } from '../../utils/EamuseIO';
import { ROOT_CONTAINER } from '../../eamuse/index';
import { uploadRegistry } from '../../uploader/registry';

export const ADMIN_ONLY_PAGES = [
  'startup flags',
  'unlock events',
  'update webui assets',
  'weekly score attack',
  'custom charts admin',
  'asset update',
  'automation paradise mixes',
  'more plugin settings',
];

export function isAdminOnlyPage(pageName: string): boolean {
  const normalized = pageName.toLowerCase().trim();
  return normalized === 'admin' || ADMIN_ONLY_PAGES.some(p => p.toLowerCase() === normalized);
}

export async function userOwnsProfile(req: Request, refid: string): Promise<boolean> {
  const sessionUser = (req.session as any)?.user;
  if (!sessionUser) return false;
  if (sessionUser.admin) return true;
  const cardNumber = sessionUser.cardNumber;
  if (!cardNumber) return false;
  const cards = await FindCardsByRefid(refid);
  if (!cards || !Array.isArray(cards)) return false;
  return cards.some((c: any) => c.cid === cardNumber || c.print === cardNumber);
}

export function getPluginUploadInfo(plugin: { GameCodes?: string[]; UploadType?: string }): {
  hasUploads: boolean;
  label: string;
  type: string;
  isCard: boolean;
} {
  const codes = plugin.GameCodes || [];
  if (codes.length === 0 && !plugin.UploadType) {
    return { hasUploads: false, label: 'Uploads', type: 'none', isCard: false };
  }
  const handler = uploadRegistry.getHandlerForPlugin(plugin);
  const isKnown =
    codes.some(c => {
      const upper = c.toUpperCase();
      return upper.startsWith('TBS') || upper.startsWith('CC') || upper.startsWith('KLP');
    }) || !!plugin.UploadType;

  return {
    hasUploads: isKnown,
    label: handler.uiConfig.label,
    type: handler.uiConfig.type,
    isCard: handler.uiConfig.isCard,
  };
}

export function data(req: Request, title: string, plugin: string, attr?: any) {
  const formOk = req.flash('formOk');
  const formWarn = req.flash('formWarn');
  const aside = (req.cookies && req.cookies.asidemenu) == 'true';

  let formMessage = null;
  if (formOk.length > 0) {
    formMessage = { danger: false, message: formOk.join(' ') };
  } else if (formWarn.length > 0) {
    formMessage = { danger: true, message: formWarn.join(' ') };
  }

  const sessionUser = (req.session as any)?.user;
  const onlineMode = Boolean(CONFIG.online_mode);

  return {
    title,
    aside,
    plugin,
    local: req.ip == '127.0.0.1' || req.ip == '::1',
    version: VERSION,
    onlineMode,
    user: onlineMode && sessionUser ? sessionUser.username : null,
    admin: onlineMode ? (sessionUser ? Boolean(sessionUser.admin) : false) : true,
    cardNumber: onlineMode && sessionUser ? sessionUser.cardNumber : null,
    formMessage,
    plugins: ROOT_CONTAINER.Plugins.map((p: any) => {
      const uploadInfo = getPluginUploadInfo(p);
      return {
        name: p.Name,
        id: p.Identifier,
        webOnly: p.GameCodes.length == 0,
        hasUploads: uploadInfo.hasUploads,
        uploadLabel: uploadInfo.label,
        pages: p.Pages.filter(
          (f: string) => !onlineMode || sessionUser?.admin || !isAdminOnlyPage(f)
        ).map((f: string) => ({ name: startCase(f), link: f })),
      };
    }),
    ...attr,
  };
}

export function validate(c: CONFIG_OPTIONS, current: any) {
  if (c.validator) {
    const msg = c.validator(current);
    if (typeof msg == 'string') {
      return msg.length == 0 ? 'Invalid value' : msg;
    }
  }

  if (c.range) {
    if (c.type == 'float' || c.type == 'integer') {
      if (current < c.range[0] || current > c.range[1]) {
        return `Value must be in between ${c.range[0]} and ${c.range[1]}.`;
      }
    }
  }

  if (c.options) {
    if (c.type == 'string') {
      if (c.options.indexOf(current) < 0) {
        return `Please select an option.`;
      }
    }
  }

  return null;
}

export function ConfigData(plugin: string) {
  const config: CONFIG_DATA[] = [];
  const configMap = CONFIG_MAP[plugin];
  const configData = plugin == 'core' ? CONFIG : CONFIG[plugin];

  if (!configMap || !configData) {
    return [];
  }

  if (configMap) {
    for (const [key, c] of configMap) {
      const name = get(c, 'name', upperFirst(lowerCase(key)));
      const current = get(configData, key, c.default);
      let error = validate(c, current);

      config.push({
        key,
        ...c,
        current,
        name,
        error,
      });
    }
  }
  return config;
}

export function DataFileCheck(plugin: string) {
  const files: FILE_CHECK[] = [];
  const fileMap = DATAFILE_MAP[plugin];

  if (!fileMap) {
    return [];
  }

  for (const [filepath, c] of fileMap) {
    const target = path.resolve(PLUGIN_PATH, plugin, filepath);
    const filename = path.basename(target);
    const uploaded = existsSync(target);
    const config = { ...c };
    if (!c.name) {
      config.name = filename;
    }
    files.push({ ...config, path: filepath, uploaded, filename });
  }

  return files;
}
