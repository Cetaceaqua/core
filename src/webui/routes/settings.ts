import { Router, urlencoded, json } from 'express';
import { isEmpty } from 'lodash';
import { CONFIG, CONFIG_MAP, SaveConfig, ARGS } from '../../utils/ArgConfig';
import {
  PluginStats,
  PurgePlugin,
  APIFindOne,
  APIFind,
  APIInsert,
  APIRemove,
  APIUpdate,
  APIUpsert,
  APICount,
  GetProfileCount,
  GetProfiles,
  Count,
  FindProfile,
  FindCardsByRefid,
  FindCard,
  CreateCard,
  DeleteCard,
  UpdateProfile,
  PurgeProfile,
  ReadAssets,
} from '../../utils/EamuseIO';
import { card2nfc, cardType, nfc2card } from '../../utils/CardCipher';
import { ROOT_CONTAINER } from '../../eamuse/index';
import { wrap, adminMiddleware } from '../shared/middleware';
import { data, ConfigData, validate } from '../shared/helpers';
import { Converter } from 'showdown';
import { Logger } from '../../utils/Logger';

export const settingsRouter = Router();

const markdown = new Converter({
  headerLevelStart: 3,
  strikethrough: true,
  tables: true,
  tasklists: true,
});

settingsRouter.get('/favicon.ico', (_req, res) => {
  res.redirect('/static/favicon.ico');
});

settingsRouter.get(
  '/',
  wrap(async (req, res) => {
    if (CONFIG.online_mode && !(req.session as any)?.user?.admin) {
      return res.redirect('/about');
    }

    const memory = `${(process.memoryUsage().rss / 1048576).toFixed(2)}MB`;
    const config = ConfigData('core');
    const changelog = markdown.makeHtml(ReadAssets('changelog.md'));
    const profiles = await GetProfileCount();
    res.render('index', data(req, 'Dashboard', 'core', { memory, config, changelog, profiles }));
  })
);

settingsRouter.get(
  '/about',
  wrap(async (req, res) => {
    const contributors = new Map<string, { name: string; link?: string }>();
    for (const plugin of ROOT_CONTAINER.Plugins) {
      for (const c of plugin.Contributors) {
        contributors.set(c.name, c);
      }
    }
    res.render(
      'about',
      data(req, 'About', 'core', { contributors: Array.from(contributors.values()) })
    );
  })
);

// Data Management
settingsRouter.get(
  '/data',
  adminMiddleware,
  wrap(async (req, res) => {
    const pluginStats = await PluginStats();
    const installed = ROOT_CONTAINER.Plugins.map(p => p.Identifier);
    res.render(
      'data',
      data(req, 'Data Management', 'core', { pluginStats, installed, dev: ARGS.dev })
    );
  })
);

settingsRouter.get(
  '/data/:plugin',
  adminMiddleware,
  wrap(async (req, res, next) => {
    if (!ARGS.dev) {
      return next();
    }
    const pluginID = req.params['plugin'];
    res.render('data_plugin', data(req, 'Data Management', 'core', { subtitle: pluginID }));
  })
);

settingsRouter.post(
  '/data/db',
  adminMiddleware,
  json({ limit: '50mb' }),
  wrap(async (req, res, next) => {
    if (!ARGS.dev) {
      return next();
    }
    const command = req.body.command;
    const args = req.body.args;
    const plugin = req.body.plugin;

    try {
      switch (command) {
        case 'FindOne':
          res.json(await (APIFindOne as any)({ identifier: plugin, core: false }, ...args));
          break;
        case 'Find':
          res.json(await (APIFind as any)({ identifier: plugin, core: false }, ...args));
          break;
        case 'Insert':
          res.json(await (APIInsert as any)({ identifier: plugin, core: false }, ...args));
          break;
        case 'Remove':
          res.json(await (APIRemove as any)({ identifier: plugin, core: false }, ...args));
          break;
        case 'Update':
          res.json(await (APIUpdate as any)({ identifier: plugin, core: false }, ...args));
          break;
        case 'Upsert':
          res.json(await (APIUpsert as any)({ identifier: plugin, core: false }, ...args));
          break;
        case 'Count':
          res.json(await (APICount as any)({ identifier: plugin, core: false }, ...args));
          break;
      }
    } catch (err: any) {
      res.json({ error: err.toString() });
    }
  })
);

settingsRouter.delete(
  '/data/:plugin',
  adminMiddleware,
  wrap(async (req, res) => {
    const pluginID = req.params['plugin'];
    if (pluginID && pluginID.length > 0) await PurgePlugin(pluginID);

    const plugin = ROOT_CONTAINER.getPluginByID(pluginID);
    if (plugin) {
      try {
        plugin.Register();
      } catch (err) {
        Logger.error(err, { plugin: pluginID });
      }
    }
    res.sendStatus(200);
  })
);

// Profiles Management (Admin only)
settingsRouter.get(
  '/profiles',
  adminMiddleware,
  wrap(async (req, res) => {
    const profiles = (await GetProfiles()) || [];
    for (const profile of profiles) {
      profile.cards = await Count({ __s: 'card', __refid: profile.__refid });
    }
    res.render('profiles', data(req, 'Profiles', 'core', { profiles }));
  })
);

settingsRouter.delete(
  '/profile/:refid',
  adminMiddleware,
  wrap(async (req, res) => {
    const refid = req.params['refid'];
    if (await PurgeProfile(refid)) {
      return res.sendStatus(200);
    } else {
      return res.sendStatus(404);
    }
  })
);

settingsRouter.get(
  '/profile/:refid',
  adminMiddleware,
  wrap(async (req, res, next) => {
    const refid = req.params['refid'];
    const profile = await FindProfile(refid);
    if (!profile) return next();

    profile.cards = await FindCardsByRefid(refid);
    res.render(
      'profiles_profile',
      data(req, 'Profiles', 'core', { profile, subtitle: profile.name })
    );
  })
);

settingsRouter.post(
  '/profile/:refid/card',
  adminMiddleware,
  json({ limit: '50mb' }),
  wrap(async (req, res) => {
    const refid = req.params['refid'];
    const card = req.body.cid;

    try {
      const cid = card;
      const print = nfc2card(cid);
      if (!(await FindCard(cid))) {
        await CreateCard(cid, refid, print);
      }
    } catch {}

    try {
      const print = String(card || '')
        .toUpperCase()
        .trim()
        .replace(/[\s\-]/g, '')
        .replace(/O/g, '0')
        .replace(/I/g, '1');
      const cid = card2nfc(print);
      if (cardType(cid) >= 0 && !(await FindCard(cid))) {
        await CreateCard(cid, refid, print);
      }
    } catch {}

    res.sendStatus(200);
  })
);

settingsRouter.post(
  '/profile/:refid',
  adminMiddleware,
  urlencoded({ extended: true, limit: '50mb' }),
  wrap(async (req, res) => {
    const refid = req.params['refid'];
    const update: any = {};
    if (req.body.pin) update.pin = req.body.pin;
    if (req.body.name) update.name = req.body.name;

    await UpdateProfile(refid, update);
    req.flash('formOk', 'Updated');
    res.redirect(req.originalUrl);
  })
);

settingsRouter.delete(
  '/card/:cid',
  adminMiddleware,
  wrap(async (req, res) => {
    const cid = req.params['cid'];
    if (await DeleteCard(cid)) {
      return res.sendStatus(200);
    } else {
      return res.sendStatus(404);
    }
  })
);

// General setting update
settingsRouter.post(
  ['/', '/plugin/:plugin'],
  adminMiddleware,
  urlencoded({ extended: true, limit: '50mb' }),
  wrap(async (req, res, next) => {
    if (!req.is('application/x-www-form-urlencoded')) return next();
    if (isEmpty(req.body)) return res.sendStatus(400);

    let plugin: string = null;
    if (req.path === '/') {
      plugin = 'core';
    } else if (req.path.startsWith('/plugin/')) {
      plugin = req.params['plugin'];
    }

    if (plugin == null) return res.status(400).send('Invalid settings path');

    const configMap = CONFIG_MAP[plugin];
    const configData = plugin === 'core' ? CONFIG : CONFIG[plugin];

    if (!configMap || !configData) return res.status(404).send('Configuration map not found');

    let needRestart = false;
    for (const [key, config] of configMap) {
      const current = configData[key];
      if (config.type === 'boolean') configData[key] = !!req.body[key];
      if (config.type === 'float') {
        configData[key] = parseFloat(req.body[key]);
        if (isNaN(configData[key])) configData[key] = config.default;
      }
      if (config.type === 'integer') {
        configData[key] = parseInt(req.body[key]);
        if (isNaN(configData[key])) configData[key] = config.default;
      }
      if (config.type === 'string') configData[key] = req.body[key];

      if (current !== configData[key]) {
        if (!validate(config, configData[key]) && config.needRestart) {
          needRestart = true;
        }
      }
    }

    if (needRestart) {
      req.flash('formWarn', 'Some settings require a restart to be applied.');
    } else {
      req.flash('formOk', 'Updated');
    }

    SaveConfig();
    res.redirect(req.originalUrl);
  })
);
