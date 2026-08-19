// server.js — À FUSIONNER avec ton server.js existant (celui qui sert
// déjà /login et /users). Les morceaux à reprendre sont clairement
// indiqués ci-dessous ; ce fichier est fourni complet pour pouvoir aussi
// démarrer isolément en test.

require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const path = require('path');

const authRoutes = require('./routes/auth');
const appRoutes = require('./routes/app');
const usersRoutes = require('./routes/users');
const savedRoutesRoutes = require('./routes/savedRoutes');
const authHookRoutes = require('./routes/authHook');
const { getUserFromRequest } = require('./middleware/requireAuth');

const app = express();

// En-têtes de sécurité de base (CSP volontairement permissive ici à cause
// des CDN Leaflet/Supabase déjà utilisés par l'appli d'origine — à
// resserrer si tu passes ces libs en dépendances npm plutôt qu'en CDN).
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(cookieParser());

// Config publique (clé anon) injectée au navigateur sans la coder en dur
// dans le HTML statique — reste dans les variables d'environnement.
app.get('/config.js', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send(
    `window.__SUPABASE_CONFIG__ = ${JSON.stringify({
      url: process.env.SUPABASE_URL,
      anonKey: process.env.SUPABASE_ANON_KEY,
    })};`
  );
});

app.use(authRoutes);
app.use(appRoutes);
app.use(usersRoutes);
app.use(savedRoutesRoutes);
app.use(authHookRoutes);

// GET / AVANT express.static : sinon un éventuel public/index.html serait
// servi automatiquement en premier et empêcherait cette redirection de
// s'exécuter (bug déjà rencontré précédemment).
app.get('/', async (req, res) => {
  const user = await getUserFromRequest(req);
  res.redirect(user ? '/app' : '/login.html');
});

// Fichiers statiques (login.html, CSS/JS de Traceur sous /app/*.css|js).
app.use(express.static(path.join(__dirname, 'public')));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Rando listening on port ${port}`));

module.exports = app;
