import { RequestHandler } from 'express';
import { findKey, get, has, isArray } from 'lodash';

import {
  isKBin,
  kdecode,
  xmlToData,
  detectXMLEncoding,
  KBinEncoding,
  kgetEncoding,
} from '../utils/KBinJSON';
import { KonmaiEncrypt } from '../utils/KonmaiEncrypt';
import LzKN from '../utils/LzKN';
import { Logger } from '../utils/Logger';
import { EamuseSend } from '../eamuse/EamuseSend';
import { dataToXML } from '../utils/KBinJSON';
import { EamuseRootRouter } from '../eamuse/EamuseRootRouter';
import { GetCabinetByPCBID, UpdateCabinetLastSeen } from '../utils/EamuseIO';
import { CONFIG } from '../utils/ArgConfig';

export interface EABody {
  data: object;
  buffer: Buffer;
  module: string;
  method: string;
  encrypted: boolean;
  compress: boolean;
  kencoded: boolean;
  encoding: KBinEncoding;
  model: string;
  pcbid?: string;
}

export interface EamuseInfo {
  gameCode: string;
  module: string;
  method: string;
  model: string;
  ip?: string;
  pcbid?: string;
  host?: string;
  protocol?: string;
  proxy?: boolean;
}

function forwardedHeader(req: any, name: string) {
  const value = req.headers?.[name];
  if (typeof value !== 'string') {
    return '';
  }
  return value.split(',')[0].trim();
}

function stripPort(host: string) {
  if (!host) {
    return host;
  }

  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end >= 0 ? host.slice(1, end) : host;
  }

  const colonIndex = host.lastIndexOf(':');
  return colonIndex > 0 ? host.slice(0, colonIndex) : host;
}

export const EamuseMiddleware: RequestHandler = async (req, res, next) => {
  res.set('X-Powered-By', 'Asphyxia');

  const agent = req.headers['user-agent'] || '';
  const url = req.originalUrl || req.url || '';

  if (
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    agent.indexOf('Mozilla') >= 0 ||
    url.startsWith('/api/') ||
    url.startsWith('/upload') ||
    url.startsWith('/photos') ||
    url.startsWith('/login') ||
    url.startsWith('/signup') ||
    url.startsWith('/logout') ||
    url.startsWith('/account') ||
    url.startsWith('/cards') ||
    url.startsWith('/cabinets') ||
    url.startsWith('/users') ||
    url.startsWith('/about') ||
    url.startsWith('/data') ||
    url.startsWith('/plugin/') ||
    url.startsWith('/static/') ||
    (url === '/' &&
      (req.method === 'GET' ||
        req.method === 'HEAD' ||
        agent.indexOf('Mozilla') >= 0 ||
        Boolean(req.headers.accept && String(req.headers.accept).includes('text/html'))))
  ) {
    (req as any).skip = true;
    return next();
  }

  const eamuseInfo = req.headers['x-eamuse-info'];

  let compress = req.headers['x-compress'];

  if (!compress) {
    compress = 'none';
  }

  const chunks: Buffer[] = [];

  req.on('data', chunk => {
    chunks.push(Buffer.from(chunk));
  });

  req.on('end', () => {
    // Logger.debug(req.url);
    const data = Buffer.concat(chunks);
    if (!data) {
      Logger.warn(`message by ${agent} is empty`);
      res.sendStatus(404);
      return;
    }

    let body = data;
    let encrypted = false;

    if (eamuseInfo) {
      encrypted = true;
      const key = new KonmaiEncrypt(eamuseInfo.toString());
      const decrypted = key.encrypt(body);
      body = decrypted;
    }

    if (body && compress === 'lz77') {
      body = LzKN.inflate(body);
    }

    if (!body) {
      Logger.error(`Failed to decompress message by ${agent}`);
      res.sendStatus(404);
      return;
    }

    let xml = null;
    let kencoded = false;

    let encoding: KBinEncoding = 'utf8';

    try {
      if (!isKBin(body)) {
        encoding = detectXMLEncoding(body);
        xml = xmlToData(body, encoding);
      } else {
        encoding = kgetEncoding(body);
        xml = kdecode(body);
        kencoded = true;
      }
    } catch (err) {
      Logger.error(`Failed to parse message by ${agent}`);
    }

    if (xml == null) {
      res.sendStatus(404);
      return;
    }

    const eaModule = findKey(
      get(xml, 'call'),
      x => has(x, '@attr.method') || has(x, '0.@attr.method')
    );

    if (!eaModule) {
      res.sendStatus(404);
      return;
    }

    let moduleObj: any[] = get(xml, `call.${eaModule}`, null);
    if (!isArray(moduleObj)) moduleObj = [moduleObj];

    const eaMethods: string[] = moduleObj.map(x => get(x, `@attr.method`));
    const eaMethod = eaMethods.join('.');
    const model = get(xml, 'call.@attr.model');
    const pcbid = get(xml, 'call.@attr.srcid') || get(xml, 'call.@attr.pcbid');

    if (!(process as any).pkg) {
      Logger.debug(`${eaModule}.${eaMethod}\n${dataToXML(xml, false)}`);
    }

    req.body = {
      data: xml,
      buffer: data,
      module: eaModule as string,
      method: eaMethod as string,
      compress: compress == 'lz77',
      encrypted,
      encoding,
      kencoded,
      model,
      pcbid,
    } as EABody;
    next();
  });
};

function gameIp(ip: string | undefined): string | undefined {
  if (!ip || !ip.includes(':')) return ip;
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return mapped ? mapped[1] : '127.0.0.1';
}

export const EamuseRoute = (router: EamuseRootRouter): RequestHandler => {
  const lastSeenWriteAt = new Map<string, number>();
  const CABINET_LAST_SEEN_INTERVAL_MS = 60 * 1000;

  const route: RequestHandler = async (req, res, next) => {
    if ((req as any).skip) {
      next();
      return;
    }

    const body = req.body as EABody;

    const gameCode = body.model.split(':')[0];

    if (CONFIG.online_mode && CONFIG.require_pcbid_auth && !body.pcbid) {
      Logger.warn(
        `Rejected connection without PCBID (Game: ${gameCode}, ${body.module}.${body.method})`
      );
      res.sendStatus(403);
      return;
    }

    if (body.pcbid) {
      const cabinet = await GetCabinetByPCBID(body.pcbid);
      if (CONFIG.online_mode && CONFIG.require_pcbid_auth && !cabinet) {
        Logger.warn(
          `Rejected connection from unregistered PCBID: ${body.pcbid} (Game: ${gameCode})`
        );
        res.sendStatus(403);
        return;
      }
      if (cabinet) {
        const now = Date.now();
        const lastWrite = lastSeenWriteAt.get(cabinet.pcbid) || 0;
        if (now - lastWrite >= CABINET_LAST_SEEN_INTERVAL_MS) {
          lastSeenWriteAt.set(cabinet.pcbid, now);
          UpdateCabinetLastSeen(cabinet.pcbid);
        }
      }
    }

    const send = new EamuseSend(body, res);
    const data = get(body.data, `call.${body.module}`);
    const forwardedFor = forwardedHeader(req, 'x-forwarded-for');
    const clientIp = forwardedFor || req.ip;
    const cleanIp = gameIp(clientIp);

    const forwardedHost = forwardedHeader(req, 'x-forwarded-host');
    const forwardedProto = forwardedHeader(req, 'x-forwarded-proto');

    const info: EamuseInfo = {
      gameCode,
      module: body.module,
      method: body.method,
      model: body.model,
      pcbid: body.pcbid,
      ip: cleanIp,
      host: forwardedHost ? stripPort(forwardedHost) : req.hostname,
      protocol: forwardedProto || req.protocol,
      proxy: Boolean(forwardedHost || forwardedProto),
    };

    // HACK: give facility ip
    if (body.module == 'facility' && body.method == 'get') {
      info.ip = cleanIp;
    }

    try {
      await router.run(gameCode, body.module, body.method, info, data, send);
    } catch (err) {
      Logger.error(err);
      send.object({}, { status: 1 });
    }
  };

  return route;
};
