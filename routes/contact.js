// routes/contact.js
//
// Formulaire "Nous contacter" (popin À propos) : envoie un email à
// l'éditeur avec les infos du compte connecté + le message saisi.

const express = require('express');
const { requireAuthApi } = require('../middleware/requireAuth');
const { sendEmail } = require('../lib/email');
const { contactMessageEmail } = require('../lib/emailTemplates');

const router = express.Router();

const CONTACT_RECIPIENT = 'cedkite@gmail.com';
const MAX_MESSAGE_LENGTH = 3000;

router.post('/api/contact', express.json(), requireAuthApi, async (req, res) => {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Message vide' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `Message trop long (max ${MAX_MESSAGE_LENGTH} caractères)` });
  }

  const senderEmail = req.user.email || 'inconnu';
  const meta = req.user.user_metadata || {};
  const senderName = meta.full_name || meta.name || senderEmail;

  const { text, html } = contactMessageEmail({ senderEmail, senderName, message });

  try {
    await sendEmail({
      to: CONTACT_RECIPIENT,
      subject: `[Traceur] Message de ${senderName}`,
      text,
      html,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  res.json({ ok: true });
});

module.exports = router;
