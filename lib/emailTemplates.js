// lib/emailTemplates.js
//
// Gabarit des emails envoyés par l'appli, repris aux couleurs de Traceur :
// fond très sombre du header (#10140F), accent doré (#D9A441) et bouton
// ambre (#C9752E) comme sur la page de connexion, fond papier clair
// (#FBF9F2) pour le corps. Structure en tableaux + styles inline, requis
// pour un rendu correct dans la plupart des clients mail (Outlook inclus).

const COLORS = {
  headerBg: '#10140F',
  gold: '#D9A441',
  amber: '#C9752E',
  paper: '#FBF9F2',
  paperDeep: '#F1ECDD',
  ink: '#1F3527',
  inkSoft: '#4B5A50',
  line: '#D8CFB2',
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Email envoyé à l'ami quand une sauvegarde lui est partagée. */
function shareRouteEmail({ senderEmail, personalMessage, isNewAccount, appUrl }) {
  const ctaLabel = isNewAccount ? 'Créer mon compte' : 'Se connecter';
  const introAction = isNewAccount
    ? 'Vous pouvez facilement vous créer un compte afin de pouvoir voir cette proposition.'
    : 'Connectez-vous afin de pouvoir voir cette proposition.';

  // Version texte : lignes courtes, séparées, pour une lecture propre même
  // sans rendu HTML (webmails en mode texte, clients mail restrictifs...).
  const textLines = [
    'Bonjour,',
    '',
    `Votre ami ${senderEmail} vient de vous partager une proposition de parcours sur Traceur.`,
  ];
  if (personalMessage) {
    textLines.push('', 'Voici son message :', `"${personalMessage}"`);
  }
  textLines.push('', introAction, '', `${ctaLabel} : ${appUrl}`, '', 'Bonne journée,', 'Traceur Team');
  const text = textLines.join('\n');

  const messageBlockHtml = personalMessage
    ? `
          <tr>
            <td style="padding:0 32px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${COLORS.paperDeep}" style="border-radius:6px;">
                <tr>
                  <td style="padding:14px 18px; border-left:3px solid ${COLORS.gold}; font-family:Georgia,'Times New Roman',serif; font-size:14px; line-height:1.6; color:${COLORS.ink}; font-style:italic;">
                    &ldquo;${escapeHtml(personalMessage)}&rdquo;
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Traceur</title>
</head>
<body style="margin:0; padding:0; background-color:#EFEAD9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#EFEAD9">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px; width:100%; background-color:${COLORS.paper}; border-radius:14px; overflow:hidden;">
          <tr>
            <td bgcolor="${COLORS.headerBg}" style="padding:26px 32px;">
              <span style="font-family:Georgia,'Times New Roman',serif; font-size:24px; font-weight:700; color:${COLORS.gold};">&#127757; Traceur</span><br>
              <span style="font-family:Arial,Helvetica,sans-serif; font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#C9D6C9;">Prépare tes étapes</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 32px 8px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.6; color:${COLORS.ink};">
              Bonjour,
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 24px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.6; color:${COLORS.ink};">
              Votre ami <strong>${escapeHtml(senderEmail)}</strong> vient de vous partager une proposition de parcours sur Traceur.
            </td>
          </tr>${messageBlockHtml}
          <tr>
            <td style="padding:0 32px 28px; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.6; color:${COLORS.ink};">
              ${introAction}
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:0 32px 34px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td bgcolor="${COLORS.amber}" style="border-radius:8px;">
                    <a href="${appUrl}" style="display:inline-block; padding:13px 26px; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:700; color:#ffffff; text-decoration:none;">${ctaLabel}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td bgcolor="${COLORS.paperDeep}" style="padding:18px 32px; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:${COLORS.inkSoft}; border-top:1px solid ${COLORS.line};">
              Bonne journée,<br>
              <strong>Traceur Team</strong>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { text, html };
}

module.exports = { shareRouteEmail };
