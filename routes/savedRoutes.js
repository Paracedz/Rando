// routes/savedRoutes.js
//
// Persiste les sauvegardes de parcours (autrefois "en mémoire", perdues à
// la fermeture de l'onglet/navigateur) dans Supabase, liées au compte
// connecté (table `saved_routes`, voir supabase/schema.sql).
//
// Important : on interroge Supabase avec le token DE L'UTILISATEUR (pas
// la clé service_role) pour que les policies RLS s'appliquent réellement
// (chacun ne voit/modifie que ses propres lignes) — défense en profondeur
// en plus du filtre applicatif par req.user.id.

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { requireAuthApi, COOKIE_NAME } = require('../middleware/requireAuth');
const { supabaseAdmin } = require('../lib/supabaseAdmin');
const { sendEmail } = require('../lib/email');
const { shareRouteEmail } = require('../lib/emailTemplates');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function supabaseAsUser(token) {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Liste légère (sans le contenu du parcours) pour afficher la liste vite.
router.get('/api/saved-routes', requireAuthApi, async (req, res) => {
  const sb = supabaseAsUser(req.cookies[COOKIE_NAME]);
  const { data, error } = await sb
    .from('saved_routes')
    .select('id, label, created_at')
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ routes: data });
});

// Détail complet (avec l'état du parcours), récupéré seulement à la reprise.
router.get('/api/saved-routes/:id', requireAuthApi, async (req, res) => {
  const sb = supabaseAsUser(req.cookies[COOKIE_NAME]);
  const { data, error } = await sb
    .from('saved_routes')
    .select('id, label, state, created_at')
    .eq('id', req.params.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Sauvegarde introuvable' });
  res.json({ route: data });
});

router.post('/api/saved-routes', express.json({ limit: '15mb' }), requireAuthApi, async (req, res) => {
  const { label, state } = req.body || {};
  if (!label || !state) {
    return res.status(400).json({ error: 'label et state sont requis' });
  }

  const sb = supabaseAsUser(req.cookies[COOKIE_NAME]);
  const { data, error } = await sb
    .from('saved_routes')
    .insert({ user_id: req.user.id, label, state })
    .select('id, label, created_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json({ route: data });
});

router.delete('/api/saved-routes/:id', requireAuthApi, async (req, res) => {
  const sb = supabaseAsUser(req.cookies[COOKIE_NAME]);
  const { error } = await sb.from('saved_routes').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Partage d'une sauvegarde avec un ami par email :
// 1) copie la sauvegarde (nouvelle ligne, propre id) ;
// 2) crée le compte de l'ami s'il n'existe pas déjà ;
// 3) rattache la copie au compte de l'ami ;
// 4) envoie un email (contenu différent selon compte existant/nouveau,
//    avec le message personnel inséré si fourni).
router.post('/api/saved-routes/:id/share', express.json(), requireAuthApi, async (req, res) => {
  const friendEmail = String(req.body?.email || '').trim().toLowerCase();
  const personalMessage = String(req.body?.message || '').trim().slice(0, 500);

  if (!EMAIL_RE.test(friendEmail)) {
    return res.status(400).json({ error: 'Adresse email invalide' });
  }
  const senderEmail = req.user.email || '';
  if (friendEmail === senderEmail.toLowerCase()) {
    return res.status(400).json({ error: 'Tu ne peux pas te partager une sauvegarde à toi-même' });
  }

  // 1) Récupère la sauvegarde à partager (RLS garantit qu'elle t'appartient).
  const sbUser = supabaseAsUser(req.cookies[COOKIE_NAME]);
  const { data: route, error: routeErr } = await sbUser
    .from('saved_routes')
    .select('label, state')
    .eq('id', req.params.id)
    .single();
  if (routeErr || !route) return res.status(404).json({ error: 'Sauvegarde introuvable' });

  // 2) Le compte de l'ami existe-t-il déjà ? (recherche via service_role,
  // nécessaire puisque RLS empêcherait normalement de voir la ligne d'un
  // autre utilisateur).
  const { data: existingUser } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('email', friendEmail)
    .maybeSingle();

  let friendId = existingUser?.id;
  let isNewAccount = false;

  if (!friendId) {
    // 3) Sinon, création du compte — la ligne public.users correspondante
    // est provisionnée automatiquement par le trigger on_auth_user_created
    // (voir supabase/schema.sql). L'ami se connectera ensuite normalement
    // via Google/Facebook avec cette même adresse email.
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: friendEmail,
      email_confirm: true,
    });
    if (createErr) return res.status(500).json({ error: createErr.message });
    friendId = created.user.id;
    isNewAccount = true;
  }

  // 4) Copie de la sauvegarde, rattachée au compte de l'ami.
  const { error: insertErr } = await supabaseAdmin
    .from('saved_routes')
    .insert({ user_id: friendId, label: route.label, state: route.state });
  if (insertErr) return res.status(500).json({ error: insertErr.message });

  // 5) Email — gabarit HTML aux couleurs de l'appli (+ version texte),
  // 2 formulations selon compte existant/nouveau, message personnel inséré
  // uniquement s'il a été renseigné.
  const appUrl = `${req.protocol}://${req.get('host')}/login.html`;
  const { text, html } = shareRouteEmail({
    senderEmail,
    personalMessage,
    isNewAccount,
    appUrl,
  });

  try {
    await sendEmail({ to: friendEmail, subject: 'Un parcours partagé sur Traceur', text, html });
  } catch (err) {
    // La copie a bien été créée même si l'envoi de l'email échoue : on le
    // signale sans annuler le partage.
    return res.json({ ok: true, emailSent: false, warning: err.message });
  }

  res.json({ ok: true, emailSent: true, newAccount: isNewAccount });
});

module.exports = router;
