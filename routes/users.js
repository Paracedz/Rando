// routes/users.js
//
// Reproduit la page /users existante, mais désormais protégée : il faut
// être connecté pour la voir. La clé service_role (qui contourne RLS)
// reste strictement côté serveur — jamais envoyée au navigateur.

const express = require('express');
const { requireAuthPage } = require('../middleware/requireAuth');
const { supabaseAdmin } = require('../lib/supabaseAdmin');

const router = express.Router();

router.get('/users', requireAuthPage, async (req, res) => {
  const { data: users, error } = await supabaseAdmin
    .from('users')
    .select('display_name, email, created_at')
    .order('created_at', { ascending: true });

  const rows = error
    ? `<tr><td colspan="3" class="error">Erreur de chargement</td></tr>`
    : users.length === 0
    ? `<tr><td colspan="3" class="empty">Aucun utilisateur</td></tr>`
    : users
        .map(
          (u) => `<tr>
          <td>${escapeHtml(u.display_name || '')}</td>
          <td>${escapeHtml(u.email || '')}</td>
          <td>${new Date(u.created_at).toLocaleString('fr-FR')}</td>
        </tr>`
        )
        .join('\n');

  res.set('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Utilisateurs — Rando</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f7f4;margin:0;padding:2rem;color:#22331e;">
  <div style="max-width:700px;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;box-shadow:0 4px 16px rgba(0,0,0,.08);">
    <h1 style="color:#1e5631;">🥾 Utilisateurs Rando <span style="background:#eafbe7;color:#1e5631;padding:.2rem .7rem;border-radius:999px;font-size:.85rem;">${error ? '?' : users.length}</span></h1>
    <table style="width:100%;border-collapse:collapse;margin-top:1rem;">
      <thead><tr><th style="text-align:left;padding:.6rem .8rem;border-bottom:1px solid #e2e8e0;background:#eafbe7;color:#1e5631;">Nom</th><th style="text-align:left;padding:.6rem .8rem;border-bottom:1px solid #e2e8e0;background:#eafbe7;color:#1e5631;">Email</th><th style="text-align:left;padding:.6rem .8rem;border-bottom:1px solid #e2e8e0;background:#eafbe7;color:#1e5631;">Inscrit le</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</body>
</html>`);
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = router;
