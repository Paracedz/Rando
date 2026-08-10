// lib/email.js
//
// Envoi d'emails transactionnels via Resend (https://resend.com).
// Nécessite 2 variables d'environnement :
//   RESEND_API_KEY     - clé API Resend (obligatoire)
//   RESEND_FROM_EMAIL   - adresse expéditrice, ex. "Traceur <contact@ton-domaine.fr>"
//                         (optionnelle en test : par défaut "onboarding@resend.dev",
//                         mais ce sender "bac à sable" ne peut envoyer QUE vers
//                         l'adresse email de ton propre compte Resend — pour
//                         envoyer vers l'email de n'importe quel ami, il faut
//                         vérifier un nom de domaine dans Resend et utiliser une
//                         adresse de ce domaine).
//
// Node 18+ (dont Node 24 utilisé sur Vercel) fournit `fetch` nativement,
// donc aucune dépendance supplémentaire n'est nécessaire ici.

async function sendEmail({ to, subject, text, html }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY manquant : configure un fournisseur d'email pour activer le partage par email.");
  }

  // Mode test : tant qu'aucun domaine n'est vérifié dans Resend, le sender
  // "bac à sable" (onboarding@resend.dev) ne peut envoyer QUE vers l'email
  // du compte Resend lui-même. En définissant EMAIL_TEST_REDIRECT_TO, tous
  // les emails sont redirigés vers cette adresse pour pouvoir tester le
  // contenu réel généré par l'appli, avec le destinataire prévu indiqué en
  // première ligne ("For: ..."). À retirer une fois un domaine vérifié.
  let finalTo = to;
  let finalText = text;
  let finalHtml = html;
  if (process.env.EMAIL_TEST_REDIRECT_TO) {
    finalTo = process.env.EMAIL_TEST_REDIRECT_TO;
    finalText = `For: ${to}\n\n${text}`;
    if (finalHtml) {
      const banner = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFE58A"><tr><td style="padding:10px 16px; font-family:monospace,Arial; font-size:12px; color:#111;">TEST MODE — For: ${to}</td></tr></table>`;
      finalHtml = /<body[^>]*>/i.test(finalHtml)
        ? finalHtml.replace(/(<body[^>]*>)/i, `$1${banner}`)
        : banner + finalHtml;
    }
  }

  const payload = {
    from: process.env.RESEND_FROM_EMAIL || 'Traceur <onboarding@resend.dev>',
    to: [finalTo],
    subject,
    text: finalText,
  };
  if (finalHtml) payload.html = finalHtml;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Échec de l'envoi de l'email (HTTP ${res.status}) : ${body}`);
  }
  return res.json();
}

module.exports = { sendEmail };
