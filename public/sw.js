// public/sw.js
//
// Service worker minimal, nécessaire pour l'installabilité PWA (Chrome/
// Android exige un service worker actif avec un handler `fetch`).
//
// IMPORTANT : /app est rendu côté serveur avec des données propres à
// l'utilisateur connecté (email, plan...) — on ne le met JAMAIS en cache,
// ni les appels /api/* ou /auth/*, pour ne jamais servir une page ou une
// réponse périmée ou appartenant à quelqu'un d'autre sur un appareil
// partagé. Seuls les fichiers vraiment statiques (page de connexion,
// script/CSS de l'outil, icônes) sont mis en cache.

const CACHE_NAME = 'traceur-shell-v2';

const SHELL_URLS = [
  '/login.html',
  '/manifest.json',
  '/app/traceur.css',
  '/app/traceur.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).catch(() => {})
  );
  self.skipWaiting(); // active la nouvelle version tout de suite, sans attendre la fermeture des onglets ouverts
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim(); // prend le contrôle des onglets déjà ouverts immédiatement
});

function isCacheable(url) {
  return SHELL_URLS.some((path) => url.pathname === path);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Jamais de cache pour les pages dynamiques par utilisateur ni les appels API.
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/auth/') ||
    url.pathname === '/app' ||
    url.pathname === '/users' ||
    url.pathname === '/config.js'
  ) {
    return; // laisse passer au réseau normalement, pas d'interception
  }

  if (!isCacheable(url)) return;

  // Réseau en priorité (code toujours à jour dès qu'il y a une connexion) ;
  // le cache ne sert que de repli hors-ligne. C'est l'inverse d'un
  // cache-first : celui-ci renvoyait la version mise en cache sans jamais
  // attendre le réseau, donc une mise à jour ne prenait effet qu'au
  // rechargement suivant — jamais pour la session déjà ouverte.
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
