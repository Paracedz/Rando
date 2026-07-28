# Rando — sécurisation + outil Traceur (Express)

Ce dossier complète ton appli Express existante (`/login`, `/users`) au
lieu de la remplacer. Comme je n'ai pas accès au code source de ton repo
(je n'ai que la sortie HTML de tes pages déployées), **ces fichiers sont
à fusionner à la main** avec ton `server.js` actuel — ils ne s'ajoutent
pas tout seuls.

## Le problème corrigé

Avant : `/users` rendait déjà les vraies données **sans vérifier de
session côté serveur** (`sb.auth.getSession()` n'existait que côté
client). N'importe qui pouvait charger `/users` directement. La table
`users` avait aussi une policy RLS `select` ouverte à tous (`true`),
donc lisible directement par n'importe qui possédant ta clé `anon`
(publique dans le JS du front), sans même passer par ta page.

J'ai déjà corrigé la base (RLS resserrée à "chacun lit sa propre ligne").
Ce paquet corrige le serveur : chaque route sensible vérifie maintenant
une vraie session, via un cookie `httpOnly` que le navigateur ne peut
pas lire (protection contre le vol de session par XSS).

## Comment ça marche

1. Le front (supabase-js) gère la connexion OAuth comme avant.
2. À chaque connexion/rafraîchissement de token (`onAuthStateChange`),
   le front envoie l'access token à `POST /auth/session`.
3. Le serveur **vérifie ce token auprès de Supabase** (`auth.getUser`)
   avant de le stocker dans un cookie `httpOnly`, `secure`, `sameSite=lax`.
4. Toute route protégée (`/app`, `/users`) passe par le middleware
   `requireAuthPage`, qui relit ce cookie et revérifie le token à chaque
   requête — jamais de confiance aveugle dans un état côté client.
5. `/users` utilise la clé `service_role` **côté serveur uniquement**
   pour lister tous les utilisateurs (nécessaire puisque RLS ne laisse
   plus chacun voir que sa propre ligne) — mais la route elle-même reste
   protégée par le middleware : il faut être connecté pour la voir.

## Fichiers fournis

```
lib/supabaseAdmin.js     → client service_role (SERVEUR UNIQUEMENT)
lib/supabaseAnon.js       → client anon, sert à vérifier les tokens reçus
middleware/requireAuth.js → vérifie le cookie de session à chaque requête
routes/auth.js            → POST /auth/session, POST /auth/logout
routes/app.js              → GET /app (protégé) : sert l'outil Traceur
routes/users.js             → GET /users (protégé) : reprend ta page existante
views/app.html               → page Traceur (markup + CSS/JS d'origine, quasi inchangés)
public/login.html             → ta page de login, complétée par la synchro cookie
public/app/traceur.css, .js    → CSS/JS d'origine de Traceur (chemins base-gpx à adapter si utilisés)
server.js                       → exemple d'assemblage complet
.env.example
```

## Étapes d'intégration

1. **Dans ton `server.js` existant**, ajoute :
   ```js
   const cookieParser = require('cookie-parser');
   const helmet = require('helmet');
   app.use(helmet({ contentSecurityPolicy: false }));
   app.use(cookieParser());
   app.use(require('./routes/auth'));
   app.use(require('./routes/app'));
   app.use(require('./routes/users'));   // remplace ta route /users actuelle si tu en as une
   app.get('/config.js', ...);           // voir server.js fourni
   ```
2. Copie `lib/`, `middleware/`, `routes/`, `views/app.html`,
   `public/app/` dans ton repo.
3. Remplace ta `public/login.html` (ou équivalent) par celle fournie —
   ou reporte juste le bloc `syncServerSession` / `onAuthStateChange`
   dans la tienne si tu préfères garder ton design actuel.
4. `npm install @supabase/supabase-js cookie-parser dotenv express helmet`
   (adapte selon ce que tu as déjà).
5. Ajoute les variables d'environnement (`.env.example`) dans Vercel :
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
   **La clé service_role ne doit exister que côté serveur.**
6. Dans Supabase → Authentication → URL Configuration, vérifie que les
   redirect URLs incluent `https://<ton-domaine>/login.html` et
   l'équivalent local.
7. Déploie (`git push`), teste : `/app` et `/users` doivent rediriger
   vers `/login.html` si tu n'es pas connecté, même en y accédant en
   direct (pas seulement via un clic dans l'appli).

## Mode simple (base-gpx)

`public/app/traceur.js` référence `/base-gpx/manifest.json` et
`/base-gpx/<fichier>.gpx`. Ajoute ces fichiers dans `public/base-gpx/`
si tu utilises le mode simple.

## Restriction du mode avancé aux abonnés (plus tard)

`routes/app.js` lit déjà `users.plan` (`free`/`pro`, ajouté par la
migration Supabase) et l'affiche dans la barre de compte. Pour
restreindre réellement le mode avancé, il suffira de passer ce plan à
`traceur.js` (ex. variable globale injectée dans `views/app.html`) et
d'y désactiver le bouton `#modeAdvancedBtn` si `plan !== 'pro'`.
