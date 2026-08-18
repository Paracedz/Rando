// public/pwa.js
//
// Enregistre le service worker et affiche une bannière d'installation
// personnalisée dès que le navigateur signale que l'app est installable
// (événement `beforeinstallprompt`, Chrome/Edge/Android — Chrome masque de
// plus en plus souvent sa propre mini-barre automatique par défaut, une
// bannière maison est donc plus fiable pour vraiment la proposer).
//
// Important : iOS/Safari ne déclenche JAMAIS `beforeinstallprompt` — Apple
// n'expose aucune invite automatique, l'utilisateur doit passer par
// Partager → "Sur l'écran d'accueil" à la main. Rien ne permet de
// contourner ça côté web ; on affiche un petit rappel dédié à ce cas.

(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  // sessionStorage (pas localStorage) : la bannière doit se représenter à
  // chaque nouvelle session (nouvel onglet/redémarrage du navigateur ou de
  // l'app), pas seulement une fois par semaine.
  const DISMISS_KEY = 'traceur_pwa_install_dismissed';

  function wasRecentlyDismissed() {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  }

  // Détecte le type d'appareil pour adapter le message de la bannière
  // (le texte "sur ton téléphone" n'a pas de sens si beforeinstallprompt
  // se déclenche depuis Chrome/Edge sur un PC, par exemple).
  function detectPlatform() {
    const ua = window.navigator.userAgent || '';
    const isTouchMac = /macintosh|mac os x/i.test(ua) && navigator.maxTouchPoints > 1; // iPad en mode "Mac"
    if (isIos() || isTouchMac) return 'ios';
    if (/android/i.test(ua)) return 'android';
    if (/windows/i.test(ua)) return 'windows';
    if (/macintosh|mac os x/i.test(ua)) return 'mac';
    if (/linux/i.test(ua)) return 'linux';
    return 'other';
  }

  const INSTALL_MESSAGES = {
    android: "Installe Traceur sur ton téléphone pour l'ouvrir directement depuis l'écran d'accueil.",
    windows: "Installe Traceur sur cet ordinateur pour l'ouvrir directement depuis le menu Démarrer ou le bureau.",
    mac: "Installe Traceur sur ce Mac pour l'ouvrir directement depuis le Dock ou Launchpad.",
    linux: "Installe Traceur sur cet ordinateur pour l'ouvrir directement comme une application.",
    other: "Installe Traceur pour l'ouvrir directement depuis cet appareil.",
  };

  function buildBanner({ text, buttonLabel, onAccept }) {
    const bar = document.createElement('div');
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', "Installer l'application");
    bar.style.cssText = [
      'position:fixed', 'left:12px', 'right:12px', 'bottom:12px', 'z-index:4000',
      'display:flex', 'align-items:center', 'gap:12px',
      'background:#10140F', 'color:#F1ECDD', 'border-radius:12px',
      'padding:12px 14px', 'box-shadow:0 12px 30px rgba(0,0,0,.35)',
      'font-family:Arial,Helvetica,sans-serif', 'font-size:13.5px',
    ].join(';');

    const icon = document.createElement('span');
    icon.textContent = '📲';
    icon.style.fontSize = '20px';

    const label = document.createElement('span');
    label.textContent = text;
    label.style.flex = '1';
    label.style.lineHeight = '1.4';

    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = buttonLabel;
    acceptBtn.style.cssText = [
      'background:#C9752E', 'color:#fff', 'border:none', 'border-radius:7px',
      'padding:8px 12px', 'font-weight:700', 'font-size:12.5px', 'cursor:pointer', 'white-space:nowrap',
    ].join(';');
    acceptBtn.addEventListener('click', onAccept);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.setAttribute('aria-label', 'Fermer');
    closeBtn.style.cssText = [
      'background:transparent', 'border:none', 'color:#C9D6C9',
      'font-size:15px', 'cursor:pointer', 'padding:4px',
    ].join(';');
    closeBtn.addEventListener('click', () => {
      sessionStorage.setItem(DISMISS_KEY, '1');
      bar.remove();
    });

    bar.append(icon, label, acceptBtn, closeBtn);
    document.body.appendChild(bar);
    return bar;
  }

  if (isStandalone() || wasRecentlyDismissed()) return;

  // Chrome / Edge / Android / Windows / etc. : vraie invite d'installation native.
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    const platform = detectPlatform();
    const banner = buildBanner({
      text: INSTALL_MESSAGES[platform] || INSTALL_MESSAGES.other,
      buttonLabel: 'Installer',
      onAccept: async () => {
        banner.remove();
        event.prompt();
        try { await event.userChoice; } catch {}
      },
    });
  });

  window.addEventListener('appinstalled', () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
  });

  // iOS/Safari : pas d'invite automatique possible, on rappelle juste la marche à suivre.
  if (isIos()) {
    buildBanner({
      text: "Sur iPhone : appuie sur Partager, puis \u00abSur l'écran d'accueil\u00bb pour installer Traceur.",
      buttonLabel: 'Compris',
      onAccept: function () {
        sessionStorage.setItem(DISMISS_KEY, '1');
        this.parentElement && this.parentElement.remove();
      },
    });
  }
})();
