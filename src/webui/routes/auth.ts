import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  AuthenticateUser,
  CreateUserAccount,
  FindCard,
  FindCardsByRefid,
  FindUserByCardNumber,
  UpdateProfile,
  UpdateUserAccount,
} from '../../utils/EamuseIO';
import { wrap } from '../shared/middleware';

export const authRouter = Router();

const authLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many attempts from this IP, please try again after 15 minutes.',
});

authRouter.get('/login', (req, res) => {
  const sessionUser = (req.session as any)?.user;
  if (sessionUser) return res.redirect(sessionUser.admin ? '/' : '/account');
  res.render('login', { error: req.flash('authError')[0] || null });
});

authRouter.post(
  '/login',
  authLimit,
  wrap(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      req.flash('authError', 'Please fill in all fields.');
      return res.redirect('/login');
    }

    const user = await AuthenticateUser(username, password);
    if (!user) {
      req.flash('authError', 'Invalid username or password.');
      return res.redirect('/login');
    }

    await UpdateUserAccount(user.username, { lastLogin: Date.now() });

    (req.session as any).user = {
      username: user.username,
      cardNumber: user.cardNumber,
      admin: Boolean(user.admin),
    };

    res.redirect(user.admin ? '/' : '/account');
  })
);

authRouter.get('/signup', (req, res) => {
  const sessionUser = (req.session as any)?.user;
  if (sessionUser) return res.redirect(sessionUser.admin ? '/' : '/account');
  res.render('signup', { error: req.flash('authError')[0] || null, old: {} });
});

authRouter.post(
  '/signup',
  authLimit,
  wrap(async (req, res) => {
    const { username, password, confirmPassword, cardNumber } = req.body;
    const old = { username, cardNumber };

    if (!username || !password || !confirmPassword || !cardNumber) {
      return res.render('signup', { error: 'Please fill in all fields.', old });
    }

    if (password !== confirmPassword) {
      return res.render('signup', { error: 'Passwords do not match.', old });
    }

    if (username.length < 3) {
      return res.render('signup', { error: 'Username must be at least 3 characters.', old });
    }

    if (username.length > 32) {
      return res.render('signup', { error: 'Username must be 32 characters or fewer.', old });
    }

    if (!/^[\w\-.@]+$/.test(username)) {
      return res.render('signup', {
        error: 'Username can only contain letters, numbers, underscores, hyphens, dots, and @.',
        old,
      });
    }

    if (password.length < 4) {
      return res.render('signup', { error: 'Password must be at least 4 characters.', old });
    }

    const normalized = cardNumber.replace(/[\s\-]/g, '').toUpperCase();
    if (!/^[0-9A-F]{16}$/.test(normalized)) {
      return res.render('signup', {
        error: 'Invalid card number format. Must be a 16-character hex string.',
        old,
      });
    }

    const card = await FindCard(normalized);
    if (!card) {
      return res.render('signup', {
        error: 'Card number not found. You must have a registered card to sign up.',
        old,
      });
    }

    if (card.__refid) {
      const profileCards = await FindCardsByRefid(card.__refid);
      if (profileCards && Array.isArray(profileCards)) {
        for (const c of profileCards) {
          const owner = await FindUserByCardNumber(c.cid);
          if (owner) {
            return res.render('signup', {
              error: 'This card number is already registered to an account.',
              old,
            });
          }
        }
      }
    } else {
      const existingAccount = await FindUserByCardNumber(normalized);
      if (existingAccount) {
        return res.render('signup', {
          error: 'This card number is already registered to an account.',
          old,
        });
      }
    }

    const account = await CreateUserAccount(username, password, normalized, false);
    if (!account) {
      return res.render('signup', { error: 'Username already exists.', old });
    }

    if (card.__refid) {
      await UpdateProfile(card.__refid, { name: username });
    }

    (req.session as any).user = { username, cardNumber: normalized, admin: false };
    res.redirect('/account');
  })
);

authRouter.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});
