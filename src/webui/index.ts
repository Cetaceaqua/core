import { Router } from 'express';
import session from 'express-session';
import cookies from 'cookie-parser';
import createMemoryStore from 'memorystore';
import flash from 'connect-flash';
import { urlencoded } from 'body-parser';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

import { SAVE_PATH } from '../utils/EamuseIO';
import { CONFIG } from '../utils/ArgConfig';
import { authRouter } from './routes/auth';
import { userRouter } from './routes/user';
import { cabinetsRouter } from './routes/cabinets';
import { settingsRouter } from './routes/settings';
import { pluginRouter } from './routes/plugin';
import { authMiddleware } from './shared/middleware';
import { data } from './shared/helpers';
import { fun } from './fun';
import { ajax as emit } from './emit';

const memorystore = createMemoryStore(session);
export const webui = Router();

function getSessionSecret(): string {
  const secretPath = path.join(SAVE_PATH, '.session_secret');
  try {
    if (existsSync(secretPath)) {
      const stored = readFileSync(secretPath, 'utf8').trim();
      if (stored.length >= 32) return stored;
    }
  } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    mkdirSync(SAVE_PATH, { recursive: true });
    writeFileSync(secretPath, secret, 'utf8');
  } catch {}
  return secret;
}

webui.use(
  session({
    cookie: { maxAge: 86400000, sameSite: 'lax', httpOnly: true, secure: 'auto' },
    proxy: true,
    secret: process.env.SESSION_SECRET || getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    store: new memorystore({ checkPeriod: 86400000 }),
  })
);
webui.use(cookies());
webui.use((req, res, next) => {
  res.locals.config = CONFIG;
  next();
});

webui.use(flash());
webui.use(urlencoded({ extended: true, limit: '50mb' }));

const generalLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 1000,
  message: 'Too many requests, please try again later.',
});
webui.use(generalLimit);

let onlineModeAtBoot: boolean | null = null;
const onlineOnly = (handler: any) => (req: any, res: any, next: any) => {
  if (onlineModeAtBoot === null) {
    onlineModeAtBoot = Boolean(CONFIG.online_mode);
  }
  return onlineModeAtBoot ? handler(req, res, next) : next();
};

// Public Auth Routes
webui.use(onlineOnly(authRouter));

// Protected Routes
webui.use(onlineOnly(authMiddleware));

webui.use(onlineOnly(userRouter));
webui.use(onlineOnly(cabinetsRouter));

webui.use(pluginRouter);
webui.use(settingsRouter);

webui.use('/fun', fun);
webui.use('/', emit);

// 404
webui.use(async (req, res) => {
  return res.status(404).render('404', data(req, '404 - Are you lost?', 'core'));
});

// 500
webui.use((err: any, req: any, res: any, next: any) => {
  if (!res.headersSent) {
    res
      .status(500)
      .render(
        '500',
        data(req, '500 - Internal Server Error', 'core', { err: err?.message || err })
      );
  }
});
