import { Router } from 'express';
import path from 'path';
import { readFileSync, existsSync, readdirSync, rmdirSync } from 'fs';
import { sizeof } from 'sizeof';
import { groupBy, startCase } from 'lodash';
import {
  PLUGIN_PATH,
  SAVE_PATH,
  APIFind,
  PurgeProfile,
  FindProfile,
  APIRemove,
  FindCard,
} from '../../utils/EamuseIO';
import { ROOT_CONTAINER } from '../../eamuse/index';
import { wrap, adminMiddleware } from '../shared/middleware';
import { CONFIG } from '../../utils/ArgConfig';
import {
  data,
  ConfigData,
  DataFileCheck,
  userOwnsProfile,
  ADMIN_ONLY_PAGES,
} from '../shared/helpers';
import { uploadRegistry } from '../../uploader/registry';
import { Converter } from 'showdown';

export const pluginRouter = Router();

const markdown = new Converter({
  headerLevelStart: 3,
  strikethrough: true,
  tables: true,
  tasklists: true,
});

// Plugin Overview
pluginRouter.get(
  '/plugin/:plugin',
  wrap(async (req, res, next) => {
    const plugin = ROOT_CONTAINER.getPluginByID(req.params['plugin']);
    if (!plugin) return next();

    const readmePath = path.join(PLUGIN_PATH, plugin.Identifier, 'README.md');
    let readme = null;
    try {
      if (existsSync(readmePath)) {
        readme = markdown.makeHtml(readFileSync(readmePath, { encoding: 'utf-8' }));
      }
    } catch {
      readme = null;
    }

    res.render(
      'plugin',
      data(req, plugin.Name, plugin.Identifier, {
        readme,
        config: ConfigData(plugin.Identifier),
        datafile: DataFileCheck(plugin.Identifier),
        contributors: plugin.Contributors,
        gameCodes: plugin.GameCodes,
        subtitle: 'Overview',
        subidentifier: 'overview',
      })
    );
  })
);

// Plugin Profiles (Admin only)
pluginRouter.get(
  '/plugin/:plugin/profiles',
  adminMiddleware,
  wrap(async (req, res, next) => {
    const plugin = ROOT_CONTAINER.getPluginByID(req.params['plugin']);
    if (!plugin) return next();

    const profiles = groupBy(
      await APIFind({ identifier: plugin.Identifier, core: true }, null, {}),
      '__refid'
    );

    const profileData: any[] = [];
    for (const refid in profiles) {
      let name = undefined;
      for (const doc of profiles[refid]) {
        if (doc.__refid == null) {
          PurgeProfile(doc.__refid);
          break;
        }
        if (typeof doc.name === 'string') {
          name = doc.name;
          break;
        }
      }

      profileData.push({
        refid,
        name,
        dataSize: sizeof(profiles[refid], true),
        coreProfile: await FindProfile(refid),
        isOwner: await userOwnsProfile(req, refid),
      });
    }

    res.render(
      'plugin_profiles',
      data(req, plugin.Name, plugin.Identifier, {
        subtitle: 'Profiles',
        subidentifier: 'profiles',
        hasCustomPage: plugin.FirstProfilePage != null,
        profiles: profileData,
        isAdmin: true,
      })
    );
  })
);

// Plugin Profile Page (Owner or Admin)
pluginRouter.get(
  '/plugin/:plugin/profile',
  wrap(async (req, res, next) => {
    const plugin = ROOT_CONTAINER.getPluginByID(req.params['plugin']);
    const refid = req.query['refid'];
    if (!plugin || !refid) return next();

    const isAdmin = !CONFIG.online_mode || !!(req.session as any)?.user?.admin;
    const isOwner = !CONFIG.online_mode || (await userOwnsProfile(req, refid.toString()));

    if (!isAdmin && !isOwner) {
      req.flash('formWarn', 'Access denied.');
      return res.redirect(`/plugin/${plugin.Identifier}`);
    }

    const pageName = req.query['page'];
    const page = pageName ? `profile_${pageName}` : plugin.FirstProfilePage;
    if (!page) return next();

    const isOwnerOnlyPage = (p: string) =>
      ['profile_tachi', 'profile_nabla', 'profile_migrate'].includes(p) ||
      p.includes('settings') ||
      p.includes('setting') ||
      p.includes('migrate');

    if (isOwnerOnlyPage(page) && !isAdmin && !isOwner) {
      return res.redirect(`/plugin/${req.params['plugin']}/profile?refid=${refid}`);
    }

    const content = await plugin.render(page, { query: req.query }, refid.toString());
    if (content == null) return next();

    const tabs = plugin.ProfilePages.filter(p => !isOwnerOnlyPage(p) || isAdmin || isOwner).map(
      p => ({
        name: startCase(p.substr(8).replace(/^\d+_/, '')),
        link: p.substr(8),
      })
    );

    res.render(
      'custom_profile',
      data(req, plugin.Name, plugin.Identifier, {
        content,
        tabs,
        subtitle: 'Profiles',
        subidentifier: 'profiles',
        subsubtitle: startCase(page.substr(8).replace(/^\d+_/, '')),
        subsubidentifier: page.substr(8),
        refid: refid.toString(),
        isAdmin,
        isOwner,
      })
    );
  })
);

// Plugin Uploads Gallery (Cards / Photos)
pluginRouter.get(
  '/plugin/:plugin/uploads',
  wrap(async (req, res, next) => {
    const plugin = ROOT_CONTAINER.getPluginByID(req.params['plugin']);
    if (!plugin) return next();

    const handler = uploadRegistry.getHandlerForPlugin(plugin);
    const photosDir = path.join(SAVE_PATH, 'photos');
    const isAdmin = !CONFIG.online_mode || !!(req.session as any)?.user?.admin;
    const userCardNumber = (req.session as any)?.user?.cardNumber;

    let userRefId: string | null = null;
    if (userCardNumber) {
      const card = await FindCard(userCardNumber);
      if (card && card.__refid) {
        userRefId = card.__refid;
      }
    }

    let photos: any[] = [];
    let distinctRefids: string[] = [];
    let selectedRefid: string | null = null;

    if (isAdmin) {
      const allPhotos = await handler.listItems(photosDir, plugin.GameCodes);
      distinctRefids = Array.from(new Set(allPhotos.map(p => p.refId))).filter(Boolean);
      if (req.query.refid && typeof req.query.refid === 'string') {
        selectedRefid = req.query.refid;
        photos = allPhotos.filter(p => p.refId.toUpperCase() === selectedRefid!.toUpperCase());
      } else {
        photos = allPhotos;
      }
    } else {
      if (userRefId) {
        photos = await handler.listItems(photosDir, plugin.GameCodes, userRefId);
      } else {
        photos = [];
      }
    }

    res.render(
      'plugin_uploads',
      data(req, plugin.Name, plugin.Identifier, {
        subtitle: handler.uiConfig.label,
        subidentifier: 'uploads',
        photos,
        uiConfig: handler.uiConfig,
        uploadLabel: handler.uiConfig.label,
        isAdmin,
        userRefId,
        selectedRefid,
        distinctRefids,
      })
    );
  })
);

// Delete profile
pluginRouter.delete(
  '/plugin/:plugin/profile/:refid',
  adminMiddleware,
  wrap(async (req, res) => {
    const plugin = ROOT_CONTAINER.getPluginByID(req.params['plugin']);
    if (!plugin) return res.sendStatus(404);

    const refid = req.params['refid'];
    if (!refid || refid.length === 0) return res.sendStatus(400);

    const removed = await APIRemove({ identifier: plugin.Identifier, core: true }, refid, {});

    const handler = uploadRegistry.getHandlerForPlugin(plugin);
    const photosDir = path.join(SAVE_PATH, 'photos');
    const items = await handler.listItems(photosDir, plugin.GameCodes, refid);
    for (const item of items) {
      await handler.deleteItem(photosDir, refid, item.card?.subDir || item.fileName);
    }
    const userPhotosDir = path.join(photosDir, refid);
    try {
      if (existsSync(userPhotosDir) && readdirSync(userPhotosDir).length === 0) {
        rmdirSync(userPhotosDir);
      }
    } catch {}

    if (removed || items.length > 0) {
      return res.sendStatus(200);
    } else {
      return res.sendStatus(404);
    }
  })
);

// Plugin Statics
pluginRouter.get(
  '/plugin/:plugin/static/*',
  wrap(async (req, res, next) => {
    const dataPath = req.params[0];
    if (dataPath.startsWith('.')) return next();

    const plugin = ROOT_CONTAINER.getPluginByID(req.params['plugin']);
    if (!plugin) return next();

    const file = path.join(PLUGIN_PATH, plugin.Identifier, 'webui', dataPath);
    res.sendFile(file, {}, err => {
      if (err && !res.headersSent) {
        next();
      }
    });
  })
);

// Plugin Custom Pages
pluginRouter.get(
  '/plugin/:plugin/:page',
  wrap(async (req, res, next) => {
    const plugin = ROOT_CONTAINER.getPluginByID(req.params['plugin']);
    const pageName = req.params['page'];
    if (!plugin) return next();

    const isAdmin = !CONFIG.online_mode || !!(req.session as any)?.user?.admin;
    const normalizedPage = pageName.toLowerCase().trim();
    if (ADMIN_ONLY_PAGES.some(p => p.toLowerCase() === normalizedPage) && !isAdmin) {
      return res.redirect('/');
    }

    // Auto-resolve RefID for game profiles
    if (
      pageName.toLowerCase() === 'my-profile' ||
      (pageName.toLowerCase() === 'profile' && !req.query['refid'])
    ) {
      const cardNumber = (req.session as any)?.user?.cardNumber;
      if (cardNumber) {
        const card = await FindCard(cardNumber);
        if (card && card.__refid) {
          let effectiveRefid: string = card.__refid;
          const EA3_UNITY_CODES = new Set(['XIF', 'VFG']);
          if (
            plugin.GameCodes.some((c: string) => EA3_UNITY_CODES.has(c)) &&
            !/^[0-9]{16}$/.test(effectiveRefid)
          ) {
            let h = BigInt(5381);
            const upper = effectiveRefid.toUpperCase();
            for (let i = 0; i < upper.length; i++) {
              h =
                ((h << BigInt(5)) + h + BigInt(upper.charCodeAt(i))) & BigInt('0xFFFFFFFFFFFFFFFF');
            }
            effectiveRefid = (h % BigInt('10000000000000000')).toString().padStart(16, '0');
          }
          return res.redirect(`/plugin/${plugin.Identifier}/profile?refid=${effectiveRefid}`);
        }
      }
      req.flash('formWarn', 'Please link a card to your account first.');
      return res.redirect('/account');
    }

    const content = await plugin.render(pageName, { query: req.query });
    if (content == null) return next();

    res.render(
      'custom',
      data(req, plugin.Name, plugin.Identifier, {
        content,
        subtitle: startCase(pageName),
        subidentifier: pageName,
      })
    );
  })
);
