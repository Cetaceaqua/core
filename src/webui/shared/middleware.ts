import { RequestHandler } from 'express';
import { CONFIG } from '../../utils/ArgConfig';
import { FindUserByUsername } from '../../utils/EamuseIO';

export const wrap =
  (fn: RequestHandler) =>
  (...args: any[]) =>
    (fn as any)(...args).catch(args[2]);

const USER_CACHE_TTL_MS = 30_000;
interface CachedUser {
  user: any;
  expiresAt: number;
}
const _userCache = new Map<string, CachedUser>();

function getCachedUser(username: string): any | null {
  const entry = _userCache.get(username);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _userCache.delete(username);
    return null;
  }
  return entry.user;
}

function setCachedUser(username: string, user: any | null): void {
  _userCache.set(username, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
}

export function invalidateUserCache(username: string): void {
  _userCache.delete(username);
}

export const authMiddleware: RequestHandler = wrap(async (req, res, next) => {
  const path = req.path.toLowerCase();
  if (
    path === '/login' ||
    path === '/signup' ||
    path.startsWith('/static') ||
    path === '/favicon.ico' ||
    path.startsWith('/photos') ||
    path === '/upload'
  ) {
    return next();
  }

  if (!req.session || !(req.session as any).user) {
    const isApiCall =
      req.xhr ||
      (req.headers.accept && req.headers.accept.includes('application/json')) ||
      req.headers['x-requested-with'] === 'XMLHttpRequest' ||
      req.method === 'POST';
    if (isApiCall) {
      return res.status(401).json({ success: false, description: 'Not authenticated' });
    }
    return res.redirect('/login');
  }

  const username = (req.session as any).user.username;
  let dbUser = getCachedUser(username);
  if (dbUser === null) {
    dbUser = await FindUserByUsername(username);
    setCachedUser(username, dbUser ?? null);
  }

  if (dbUser) {
    (req.session as any).user = {
      ...(req.session as any).user,
      ...dbUser,
      username: dbUser.username,
      cardNumber: dbUser.cardNumber,
      admin: dbUser.admin || false,
    };
  } else {
    return res.redirect('/logout');
  }

  next();
});

export const adminMiddleware: RequestHandler = wrap(async (req, res, next) => {
  if (!CONFIG.online_mode) {
    return next();
  }
  if (!(req.session as any)?.user?.admin) {
    const isApiCall =
      req.xhr ||
      (req.headers.accept && req.headers.accept.includes('application/json')) ||
      req.headers['x-requested-with'] === 'XMLHttpRequest' ||
      req.method === 'POST';
    if (isApiCall) {
      return res.status(403).json({ success: false, description: 'Admin access required' });
    }
    req.flash('formWarn', 'Access denied. Administrator privileges required.');
    return res.redirect('/');
  }
  next();
});
