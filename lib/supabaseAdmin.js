// lib/supabaseAdmin.js
//
// Client Supabase avec la clé SERVICE ROLE.
// ⚠️ Ce fichier ne doit JAMAIS être importé depuis du code envoyé au
// navigateur. Utilisation exclusivement côté serveur (routes Express).
// La clé service_role contourne RLS : à réserver aux opérations qui en
// ont réellement besoin (ex. lister tous les utilisateurs pour /users).

const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY doivent être définis (variables serveur uniquement, jamais NEXT_PUBLIC_/VITE_/etc.)'
  );
}

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

module.exports = { supabaseAdmin };
