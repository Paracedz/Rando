// routes/authHook.js
//
// "Send Email Hook" de Supabase : quand il est activé côté dashboard,
// Supabase délègue l'envoi de TOUS les emails d'authentification (magic
// link, invitation, etc.) à cette route au lieu de les envoyer lui-même.
// Intérêt principal ici : on peut réutiliser notre propre lib/email.js,
// avec son mode test EMAIL_TEST_REDIRECT_TO déjà en place pour le partage
// de sauvegardes — donc un magic link destiné à un ami arrive chez TOI
// avec "For: email-de-l-ami" en tête, exactement comme pour le partage.
//
// Sécurité : Supabase signe chaque requête (spec "Standard Webhooks" —
// en-têtes webhook-id / webhook-timestamp / webhook-signature). On
// vérifie cette signature avec le secret fourni par le dashboard
// (SEND_EMAIL_HOOK_SECRET) AVANT de faire quoi que ce soit avec le
// contenu — sinon n'importe qui connaissant l'URL pourrait déclencher
// des envois d'email arbitraires.

const express = require('express');
const crypto = require('crypto');
const { sendEmail } = require('../lib/email');
const { magicLinkEmail } = require('../lib/emailTemplates');

const router = express.Router();

function verifySupabaseWebhook(rawBody, headers, secret) {
  const id = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatureHeader = headers['webhook-signature'];
  if (!id || !timestamp || !signatureHeader || !secret) return false;

  // Le secret donné par Supabase est préfixé "whsec_" — on ne garde que
  // la partie encodée en base64 pour reconstruire la clé HMAC.
  const secretKey = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let secretBytes;
  try {
    secretBytes = Buffer.from(secretKey, 'base64');
  } catch {
    return false;
  }

  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

  // L'en-tête peut contenir plusieurs signatures espacées ("v1,xxx v1,yyy") :
  // une seule doit correspondre.
  return signatureHeader.split(' ').some((part) => {
    const sig = part.split(',')[1];
    if (!sig) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false; // longueurs différentes = non concordant, pas une erreur à propager
    }
  });
}

router.post(
  '/auth/send-email-hook',
  express.raw({ type: '*/*', limit: '1mb' }), // corps BRUT nécessaire à la vérification de signature
  async (req, res) => {
    const rawBody = req.body.toString('utf-8');

    if (!verifySupabaseWebhook(rawBody, req.headers, process.env.SEND_EMAIL_HOOK_SECRET)) {
      return res.status(401).json({ error: 'Signature invalide' });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'JSON invalide' });
    }

    const friendEmail = payload?.user?.email;
    const emailData = payload?.email_data || {};
    const actionType = emailData.email_action_type;

    if (!friendEmail || !emailData.token_hash) {
      return res.status(400).json({ error: 'Payload incomplet' });
    }

    // Même format que la variable {{ .ConfirmationURL }} des templates
    // Supabase par défaut.
    const confirmationUrl =
      `${process.env.SUPABASE_URL}/auth/v1/verify` +
      `?token=${encodeURIComponent(emailData.token_hash)}` +
      `&type=${encodeURIComponent(actionType || 'magiclink')}` +
      `&redirect_to=${encodeURIComponent(emailData.redirect_to || '')}`;

    // Seul le magic link est réellement utilisé par l'appli (auth
    // uniquement OAuth + magic link, pas de mot de passe) ; les autres
    // types possibles retombent sur un email générique plutôt que d'échouer.
    const { text, html } =
      actionType === 'magiclink' || !actionType
        ? magicLinkEmail({ confirmationUrl })
        : {
            text: `Bonjour,\n\nVoici votre lien : ${confirmationUrl}\n\nTraceur Team`,
            html: null,
          };

    try {
      await sendEmail({ to: friendEmail, subject: 'Ton lien de connexion Traceur', text, html });
    } catch (err) {
      // Supabase réessaiera automatiquement si on répond en erreur.
      return res.status(500).json({ error: err.message });
    }

    res.status(200).json({ ok: true });
  }
);

module.exports = router;
