import { Router } from 'express';
import {
  CreateCabinet,
  GetCabinetsByUser,
  GetAllCabinets,
  DeleteCabinet,
  GetCabinetByPCBID,
  UpdateCabinet,
} from '../../utils/EamuseIO';
import { wrap } from '../shared/middleware';
import { data } from '../shared/helpers';

export const cabinetsRouter = Router();

cabinetsRouter.get(
  '/cabinets',
  wrap(async (req, res) => {
    const sessionUser = (req.session as any).user;
    const isAdmin = Boolean(sessionUser.admin);
    const cabinets = isAdmin
      ? await GetAllCabinets()
      : await GetCabinetsByUser(sessionUser.username);

    res.render(
      'cabinets',
      data(req, 'Cabinets', 'core', {
        cabinets: cabinets || [],
        isAdmin,
      })
    );
  })
);

cabinetsRouter.post(
  '/cabinets/new',
  wrap(async (req, res) => {
    const sessionUser = (req.session as any).user;
    const { name, targetUsername } = req.body;
    if (!name || name.trim() === '') {
      req.flash('formWarn', 'Cabinet name is required.');
      return res.redirect('/cabinets');
    }

    const username = sessionUser.admin && targetUsername ? targetUsername : sessionUser.username;
    const pcbid = await CreateCabinet(username, name.trim());
    if (pcbid) {
      req.flash('formOk', `Cabinet created successfully (PCBID: ${pcbid}).`);
    } else {
      req.flash('formWarn', 'Failed to create cabinet.');
    }

    res.redirect('/cabinets');
  })
);

cabinetsRouter.post(
  '/cabinets/rename',
  wrap(async (req, res) => {
    const sessionUser = (req.session as any).user;
    const { pcbid, name } = req.body;
    if (!pcbid || !name || name.trim() === '') {
      req.flash('formWarn', 'Invalid cabinet parameters.');
      return res.redirect('/cabinets');
    }

    const cabinet = await GetCabinetByPCBID(pcbid);
    if (!cabinet) {
      req.flash('formWarn', 'Cabinet not found.');
      return res.redirect('/cabinets');
    }

    if (!sessionUser.admin && cabinet.username !== sessionUser.username) {
      req.flash('formWarn', 'Permission denied.');
      return res.redirect('/cabinets');
    }

    await UpdateCabinet(pcbid, { name: name.trim() });
    req.flash('formOk', 'Cabinet renamed.');
    res.redirect('/cabinets');
  })
);

cabinetsRouter.post(
  '/cabinets/delete',
  wrap(async (req, res) => {
    const sessionUser = (req.session as any).user;
    const { pcbid } = req.body;

    const cabinet = await GetCabinetByPCBID(pcbid);
    if (!cabinet) {
      req.flash('formWarn', 'Cabinet not found.');
      return res.redirect('/cabinets');
    }

    if (!sessionUser.admin && cabinet.username !== sessionUser.username) {
      req.flash('formWarn', 'Permission denied.');
      return res.redirect('/cabinets');
    }

    await DeleteCabinet(pcbid);
    req.flash('formOk', 'Cabinet deleted.');
    res.redirect('/cabinets');
  })
);
