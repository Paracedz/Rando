// lib/supabaseAnon.js
//
// Client Supabase avec la clé ANON (la même que celle utilisée côté
// navigateur). Sert uniquement, ici, à vérifier un access token reçu
// du client (supabase.auth.getUser(token) interroge l'API Supabase Auth
// et confirme que le token est valide et non révoqué).

const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  throw new Error('SUPABASE_URL et SUPABASE_ANON_KEY doivent être définis.');
}

const supabaseAnon = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

module.exports = { supabaseAnon };
