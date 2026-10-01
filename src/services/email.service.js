const nodemailer = require('nodemailer');
require('dotenv').config();

let transporter;

async function initTransporter() {
  if (transporter) return transporter;

  try {
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      console.log('✉️ Initializing SMTP transporter...');
      transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT, 10) || 587,
        secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    } else {
      console.log('No SMTP credentials found in .env, falling back to Ethereal Email for testing...');
      let testAccount = await nodemailer.createTestAccount();
      console.log('✉️ Ethereal Email test account created:', testAccount.user);

      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false, // true for 465, false for other ports
        auth: {
          user: testAccount.user, // generated ethereal user
          pass: testAccount.pass, // generated ethereal password
        },
      });
    }
    return transporter;
  } catch (err) {
    console.error('Failed to initialize email transporter:', err);
    throw err;
  }
}

/**
 * Sends an email and logs the ethereal URL so we can view it in the terminal
 */
async function sendEmail(to, subject, html) {
  try {
    const t = await initTransporter();
    let info = await t.sendMail({
      from: process.env.EMAIL_FROM || '"Cambacay Breeze Inn" <no-reply@cambacaybreezeinn.com>',
      to,
      subject,
      html,
    });

    console.log(`✉️ Email sent to ${to} (Subject: ${subject})`);
    
    // If using ethereal, log the preview URL
    if (info.messageId && info.messageId.includes('ethereal')) {
        console.log(`✉️ Preview URL: %s`, nodemailer.getTestMessageUrl(info));
    }
    return info;
  } catch (err) {
    console.error(`Failed to send email to ${to}:`, err);
  }
}

module.exports = {
  sendEmail
};
