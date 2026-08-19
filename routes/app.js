// routes/app.js
//
// Sert l'outil Traceur — protégé par requireAuthPage : impossible d'y
// accéder sans un cookie de session valide vérifié serveur.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuthPage } = require('../middleware/requireAuth');
const { supabaseAdmin } = require('../lib/supabaseAdmin');

const router = express.Router();

// Numéro de version affiché dans le menu "compte" (bulle nom/email).
// À incrémenter à chaque nouveau merge de code sur main.
const APP_VERSION = '1.1';

const templatePath = path.join(__dirname, '..', 'views', 'app.html');

router.get('/app', requireAuthPage, async (req, res) => {
  let html = fs.readFileSync(templatePath, 'utf-8');

  // Infos de profil Google (déjà présentes dans le JWT via req.user, pas
  // besoin d'appel réseau supplémentaire à Google). On les resynchronise
  // en base à CHAQUE visite de /app (pas seulement à l'inscription) : ça
  // permet de récupérer les comptes déjà existants avant cette évolution,
  // et de suivre les éventuels changements côté Google (photo, nom...).
  const meta = req.user.user_metadata || {};
  const fullName = meta.full_name || meta.name || null;
  const givenName = meta.given_name || (fullName ? fullName.trim().split(/\s+/)[0] : null);
  const familyNameParts = fullName && fullName.trim().includes(' ')
    ? fullName.trim().split(/\s+/).slice(1).join(' ')
    : null;
  const familyName = meta.family_name || familyNameParts || null;
  const avatarUrl = meta.avatar_url || meta.picture || null;
  const locale = meta.locale || null;

  // Le plan (free/pro) sert à restreindre le mode avancé. Non bloquant si
  // la requête échoue : on retombe sur "free".
  let plan = 'free';
  try {
    const { data } = await supabaseAdmin
      .from('users')
      .update({
        email: req.user.email,
        given_name: givenName,
        family_name: familyName,
        full_name: fullName,
        avatar_url: avatarUrl,
        locale,
      })
      .eq('id', req.user.id)
      .select('plan')
      .single();
    if (data?.plan) plan = data.plan;
  } catch {
    // ignore, reste sur 'free'
  }

  const displayGivenName = givenName || fullName || (req.user.email || '').split('@')[0] || 'Mon compte';
  const displayFullName = fullName || displayGivenName;

  html = html
    .replace('__USER_EMAIL__', escapeHtml(req.user.email || ''))
    .replace(/__USER_GIVEN_NAME__/g, escapeHtml(displayGivenName))
    .replace(/__USER_FULL_NAME__/g, escapeHtml(displayFullName))
    .replace('__PLAN_LABEL__', plan === 'pro' ? '★ Premium' : 'Compte gratuit')
    .replace('__PLAN_VALUE__', plan === 'pro' ? 'pro' : 'free')
    .replace('__APP_VERSION__', APP_VERSION);

  res.set('Content-Type', 'text/html');
  res.send(html);
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
