// middleware/requireAuth.js
//
// Vérifie la session CÔTÉ SERVEUR à partir du cookie httpOnly posé par
// /auth/session (voir routes/auth.js). Ne fait jamais confiance à un
// état "connecté" côté client seul : ce middleware doit protéger toute
// route qui rend une page ou une donnée sensible.

const { supabaseAnon } = require('../lib/supabaseAnon');

const COOKIE_NAME = 'sb_access_token';

async function getUserFromRequest(req) {
  const token = req.cookies ? req.cookies[COOKIE_NAME] : null;
  if (!token) return null;

  // Appelle l'API Supabase Auth : vérifie signature + expiration + que le
  // token n'a pas été révoqué (déconnexion globale, etc.). Coût : un aller-
  // retour réseau par requête, largement suffisant à l'échelle de l'appli.
  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}

// Pour les routes qui rendent une PAGE HTML : redirige vers /login si pas connecté.
function requireAuthPage(req, res, next) {
  getUserFromRequest(req)
    .then((user) => {
      if (!user) return res.redirect('/login.html');
      req.user = user;
      next();
    })
    .catch(() => res.redirect('/login.html'));
}

// Pour les routes API/JSON : renvoie 401 si pas connecté.
function requireAuthApi(req, res, next) {
  getUserFromRequest(req)
    .then((user) => {
      if (!user) return res.status(401).json({ error: 'Non authentifié' });
      req.user = user;
      next();
    })
    .catch(() => res.status(401).json({ error: 'Non authentifié' }));
}

module.exports = { requireAuthPage, requireAuthApi, COOKIE_NAME, getUserFromRequest };
