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

const router = express.Router();

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

module.exports = router;
