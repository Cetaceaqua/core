import { Router } from 'express';
import {
  FindUserByUsername,
  UpdateUserAccount,
  GetAllUsers,
  SetUserAdmin,
  FindCard,
  FindUserByCardNumber,
  UpdateProfile,
  FindCardsByRefid,
  CreateCard,
  FindProfile,
  DeleteCard,
  DeleteUserAccount,
} from '../../utils/EamuseIO';
import { wrap, adminMiddleware, invalidateUserCache } from '../shared/middleware';
import { data } from '../shared/helpers';

export const userRouter = Router();

userRouter.get(
  '/account',
  wrap(async (req, res) => {
    const fullUser = await FindUserByUsername((req.session as any).user.username);
    let profile = null;

    if (fullUser && fullUser.cardNumber) {
      const card = await FindCard(fullUser.cardNumber);
      if (card && card.__refid) {
        profile = await FindProfile(card.__refid);
      }
    }

    res.render('account', data(req, 'Account', 'core', { fullUser, profile }));
  })
);

userRouter.post(
  '/account',
  wrap(async (req, res) => {
    const { username, password, confirmPassword, cardNumber } = req.body;
    const currentUsername = (req.session as any).user.username;

    if (password && password !== confirmPassword) {
      req.flash('formWarn', 'Passwords do not match.');
      return res.redirect('/account');
    }

    if (password && password.length < 4) {
      req.flash('formWarn', 'Password must be at least 4 characters.');
      return res.redirect('/account');
    }

    const updateFields: { username?: string; password?: string; cardNumber?: string } = {};

    if (username && username !== currentUsername) {
      if (username.length < 3 || username.length > 32 || !/^[\w\-.@]+$/.test(username)) {
        req.flash('formWarn', 'Invalid username format.');
        return res.redirect('/account');
      }
      const existing = await FindUserByUsername(username);
      if (existing) {
        req.flash('formWarn', 'Username already taken.');
        return res.redirect('/account');
      }
      updateFields.username = username;
    }

    if (password) {
      updateFields.password = password;
    }

    if (cardNumber !== undefined) {
      const normalized = String(cardNumber)
        .toUpperCase()
        .trim()
        .replace(/[\s\-]/g, '');

      if (normalized === '' || /^[0-9A-F]{16}$/.test(normalized)) {
        if (normalized !== '' && normalized !== (req.session as any).user.cardNumber) {
          const existing = await FindUserByCardNumber(normalized);
          if (existing) {
            req.flash('formWarn', 'This card number is already registered to another user.');
            return res.redirect('/account');
          }

          const targetCard = await FindCard(normalized);
          if (!targetCard || !targetCard.__refid) {
            req.flash('formWarn', 'Card number not found. Please play a game first.');
            return res.redirect('/account');
          }

          const currentCardNumber = (req.session as any).user.cardNumber;
          if (currentCardNumber) {
            const currentCard = await FindCard(currentCardNumber);
            if (!currentCard || currentCard.__refid !== targetCard.__refid) {
              req.flash('formWarn', 'You cannot link a card that belongs to another profile.');
              return res.redirect('/account');
            }
          } else {
            const siblingCards = await FindCardsByRefid(targetCard.__refid);
            if (Array.isArray(siblingCards)) {
              for (const sibling of siblingCards) {
                if (await FindUserByCardNumber(sibling.cid)) {
                  req.flash('formWarn', 'This profile is already registered to another user.');
                  return res.redirect('/account');
                }
              }
            }
          }
        }
        updateFields.cardNumber = normalized;
      } else {
        req.flash('formWarn', 'Invalid card number format.');
        return res.redirect('/account');
      }
    }

    if (Object.keys(updateFields).length > 0) {
      await UpdateUserAccount(currentUsername, updateFields);
      invalidateUserCache(currentUsername);
      if (updateFields.username) {
        (req.session as any).user.username = updateFields.username;
      }
      if (updateFields.cardNumber !== undefined) {
        (req.session as any).user.cardNumber = updateFields.cardNumber;
      }
      req.flash('formOk', 'Account updated successfully.');
    }

    res.redirect('/account');
  })
);

userRouter.post(
  '/account/profile',
  wrap(async (req, res) => {
    const fullUser = await FindUserByUsername((req.session as any).user.username);
    if (!fullUser || !fullUser.cardNumber) {
      req.flash('formWarn', 'You must link a card before editing profile details.');
      return res.redirect('/account');
    }

    const card = await FindCard(fullUser.cardNumber);
    if (!card || !card.__refid) {
      req.flash('formWarn', 'No profile found for your card number. Please play a game first.');
      return res.redirect('/account');
    }

    const update: any = {};
    if (req.body.pin) update.pin = req.body.pin;
    if (req.body.name) update.name = req.body.name;
    if (
      (req.session as any).user.admin &&
      req.body.paseli !== undefined &&
      req.body.paseli !== ''
    ) {
      const paseli = parseInt(String(req.body.paseli), 10);
      if (!isNaN(paseli)) {
        update.paseli = Math.max(0, Math.min(100000, paseli));
      }
    }

    if (Object.keys(update).length > 0) {
      await UpdateProfile(card.__refid, update);
      req.flash('formOk', 'Profile details updated.');
    }

    res.redirect('/account');
  })
);

userRouter.get(
  '/cards',
  wrap(async (req, res) => {
    const fullUser = await FindUserByUsername((req.session as any).user.username);
    if (!fullUser || !fullUser.cardNumber) {
      req.flash('formWarn', 'You must link a card number before managing cards.');
      return res.redirect('/account');
    }

    const card = await FindCard(fullUser.cardNumber);
    if (!card || !card.__refid) {
      req.flash('formWarn', 'No profile found for your card number. Please play a game first.');
      return res.redirect('/account');
    }

    const profileCards = await FindCardsByRefid(card.__refid);
    res.render(
      'cards',
      data(req, 'Cards', 'core', {
        profileCards: profileCards || [],
        refid: card.__refid,
        primaryCard: fullUser.cardNumber,
      })
    );
  })
);

userRouter.post(
  '/cards',
  wrap(async (req, res) => {
    const fullUser = await FindUserByUsername((req.session as any).user.username);
    if (!fullUser || !fullUser.cardNumber) return res.redirect('/cards');

    const mainCard = await FindCard(fullUser.cardNumber);
    if (!mainCard || !mainCard.__refid) return res.redirect('/cards');

    const card = String(req.body.card || '');
    const normalized = card
      .toUpperCase()
      .trim()
      .replace(/[\s\-]/g, '');

    if (/^[0-9A-F]{16}$/.test(normalized)) {
      if (!(await FindCard(normalized))) {
        await CreateCard(normalized, mainCard.__refid);
        req.flash('formOk', 'Card bound successfully.');
      } else {
        req.flash('formWarn', 'This card is already registered.');
      }
    } else {
      req.flash('formWarn', 'Invalid card number format.');
    }

    res.redirect('/cards');
  })
);

userRouter.post(
  '/cards/delete',
  wrap(async (req, res) => {
    const fullUser = await FindUserByUsername((req.session as any).user.username);
    if (!fullUser || !fullUser.cardNumber) return res.redirect('/cards');

    const targetCid = String(req.body.cid || '')
      .toUpperCase()
      .trim();
    if (targetCid === fullUser.cardNumber) {
      req.flash('formWarn', 'Cannot delete primary card. Rebind in account settings first.');
      return res.redirect('/cards');
    }

    const mainCard = await FindCard(fullUser.cardNumber);
    const targetCard = await FindCard(targetCid);
    if (mainCard && targetCard && mainCard.__refid === targetCard.__refid) {
      await DeleteCard(targetCid);
      req.flash('formOk', 'Card unbound successfully.');
    }

    res.redirect('/cards');
  })
);

userRouter.get(
  '/users',
  adminMiddleware,
  wrap(async (req, res) => {
    const users = await GetAllUsers();
    res.render('users', data(req, 'Users', 'core', { users }));
  })
);

userRouter.post(
  '/users/toggle-admin',
  adminMiddleware,
  wrap(async (req, res) => {
    const { username } = req.body;
    if (username === (req.session as any).user.username) {
      req.flash('formWarn', 'Cannot modify your own administrator role.');
      return res.redirect('/users');
    }

    const targetUser = await FindUserByUsername(username);
    if (targetUser) {
      await SetUserAdmin(username, !targetUser.admin);
      invalidateUserCache(username);
      req.flash('formOk', `Updated admin privileges for ${username}.`);
    }

    res.redirect('/users');
  })
);

userRouter.post(
  '/users/delete',
  adminMiddleware,
  wrap(async (req, res) => {
    const { username } = req.body;
    if (username === (req.session as any).user.username) {
      req.flash('formWarn', 'Cannot delete your own account.');
      return res.redirect('/users');
    }

    await DeleteUserAccount(username);
    invalidateUserCache(username);
    req.flash('formOk', `User ${username} deleted.`);
    res.redirect('/users');
  })
);
