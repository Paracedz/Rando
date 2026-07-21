require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

function renderPage(users, errorMessage) {
  const rows = (users || [])
    .map(
      (u) => `
        <tr>
          <td>${u.display_name || '<em>—</em>'}</td>
          <td>${u.email}</td>
          <td>${new Date(u.created_at).toLocaleString('fr-FR')}</td>
        </tr>`
    )
    .join('');

  const tableOrMessage = errorMessage
    ? `<p class="error">Erreur : ${errorMessage}</p>`
    : users.length === 0
    ? `<p class="empty">Aucun utilisateur pour le moment.</p>`
    : `
      <table>
        <thead>
          <tr><th>Nom</th><th>Email</th><th>Inscrit le</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Utilisateurs — Rando</title>
  <style>
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #f4f7f4;
      margin: 0;
      padding: 2rem;
      color: #22331e;
    }
    .container {
      max-width: 700px;
      margin: 0 auto;
      background: #fff;
      border-radius: 12px;
      padding: 2rem;
      box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    }
    h1 {
      color: #1e5631;
      margin-top: 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1rem;
    }
    th, td {
      text-align: left;
      padding: 0.6rem 0.8rem;
      border-bottom: 1px solid #e2e8e0;
    }
    th {
      background: #eafbe7;
      color: #1e5631;
    }
    .error { color: #b91c1c; }
    .empty { color: #666; }
    .count {
      display: inline-block;
      background: #eafbe7;
      color: #1e5631;
      padding: 0.2rem 0.7rem;
      border-radius: 999px;
      font-size: 0.85rem;
      margin-left: 0.5rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🥾 Utilisateurs Rando ${!errorMessage ? `<span class="count">${users.length}</span>` : ''}</h1>
    ${tableOrMessage}
  </div>
</body>
</html>`;
}

app.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('users')
    .select('display_name, email, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    res.status(500).send(renderPage([], error.message));
    return;
  }

  res.send(renderPage(data, null));
});

// En local : démarre un vrai serveur.
// Sur Vercel : ce fichier est importé comme fonction serverless, app.listen() n'est jamais appelé.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Serveur lancé sur http://localhost:${PORT}`);
  });
}

module.exports = app;
