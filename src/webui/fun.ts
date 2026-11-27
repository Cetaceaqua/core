import { Router } from 'express';
import open from 'open';
import { CONFIG } from '../utils/ArgConfig';
import { PLUGIN_PATH } from '../utils/EamuseIO';

export const fun = Router();

fun.get('/open-plugins', async (req, res) => {
  if (req.ip == '127.0.0.1' || req.ip == '::1') {
    open(PLUGIN_PATH);
  }
  res.sendStatus(200);
});

fun.get('/ping', async (req, res) => {
  res.json('pong');
});

fun.post('/shutdown', async (req, res) => {
  if (CONFIG.online_mode && !(req.session as any)?.user?.admin) {
    return res.sendStatus(403);
  }
  res.status(200).send('OK');
  res.on('finish', () => process.exit(0));
});
