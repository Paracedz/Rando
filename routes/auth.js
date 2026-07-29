// routes/auth.js
//
// Le SDK supabase-js (côté navigateur) gère la connexion OAuth et garde
// sa session dans son propre storage. Ces deux routes servent uniquement
// à faire correspondre cette session à un cookie httpOnly que le SERVEUR
// peut vérifier (voir middleware/requireAuth.js) — sans jamais exposer le
// token à du JavaScript côté client (protection contre le vol par XSS).

const express = require('express');
const { supabaseAnon } = require('../lib/supabaseAnon');
const { supabaseAdmin } = require('../lib/supabaseAdmin');
const { COOKIE_NAME } = require('../middleware/requireAuth');

const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';

const cookieOptions = {
  httpOnly: true,
  secure: isProd, // HTTPS uniquement en prod (Vercel = toujours HTTPS)
  sameSite: 'lax',
  path: '/',
  maxAge: 60 * 60 * 1000, // 1h, aligné sur la durée de vie par défaut de l'access token
};

// Appelée par le front juste après connexion et à chaque rafraîchissement
// de token (voir public/login/login.js — onAuthStateChange).
router.post('/auth/session', express.json(), async (req, res) => {
  const { access_token } = req.body || {};
  if (!access_token) {
    return res.status(400).json({ error: 'access_token manquant' });
  }

  // On ne fait confiance au token qu'après vérification serveur.
  const { data, error } = await supabaseAnon.auth.getUser(access_token);
  if (error || !data?.user) {
    return res.status(401).json({ error: 'Token invalide' });
  }

  res.cookie(COOKIE_NAME, access_token, cookieOptions);
  res.json({ ok: true });
});

router.post('/auth/logout', async (req, res) => {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (token) {
    // Révoque la session côté Supabase (refresh token inclus), pas
    // seulement le cookie local : reste valable même si sb.auth.signOut()
    // côté navigateur n'a pas pu s'exécuter (JS bloqué, autre onglet...).
    try {
      await supabaseAdmin.auth.admin.signOut(token, 'global');
    } catch {
      // Le token peut déjà être expiré/invalide : sans conséquence, on
      // nettoie quand même le cookie ci-dessous.
    }
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  res.json({ ok: true });
});

module.exports = router;
