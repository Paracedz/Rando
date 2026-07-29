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

const templatePath = path.join(__dirname, '..', 'views', 'app.html');

router.get('/app', requireAuthPage, async (req, res) => {
  let html = fs.readFileSync(templatePath, 'utf-8');

  // Le plan (free/pro) servira plus tard à restreindre le mode avancé.
  // Non bloquant si la requête échoue : on retombe sur "free".
  let plan = 'free';
  try {
    const { data } = await supabaseAdmin
      .from('users')
      .select('plan')
      .eq('id', req.user.id)
      .single();
    if (data?.plan) plan = data.plan;
  } catch {
    // ignore, reste sur 'free'
  }

  html = html
    .replace('__USER_EMAIL__', escapeHtml(req.user.email || ''))
    .replace('__PLAN_LABEL__', plan === 'pro' ? '★ Premium' : 'Compte gratuit')
    .replace('__PLAN_VALUE__', plan === 'pro' ? 'pro' : 'free');

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
