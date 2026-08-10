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

async function sendEmail({ to, subject, text }) {
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY manquant : configure un fournisseur d'email pour activer le partage par email.");
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL || 'Traceur <onboarding@resend.dev>',
      to: [to],
      subject,
      text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Échec de l'envoi de l'email (HTTP ${res.status}) : ${body}`);
  }
  return res.json();
}

module.exports = { sendEmail };
