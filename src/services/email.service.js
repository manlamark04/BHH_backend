const nodemailer = require('nodemailer');

// Ethereal is a fake SMTP service, mostly aimed at Nodemailer users.
// We use this for testing out the email integration without needing real SMTP credentials.

let transporter;

async function initTransporter() {
  if (transporter) return transporter;

  try {
    // Generate test SMTP service account from ethereal.email
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

    return transporter;
  } catch (err) {
    console.error('Failed to initialize test email transporter:', err);
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
      from: '"Cambacay Breeze Inn" <no-reply@cambacaybreezeinn.com>',
      to,
      subject,
      html,
    });

    console.log(`✉️ Email sent to ${to} (Subject: ${subject})`);
    console.log(`✉️ Preview URL: %s`, nodemailer.getTestMessageUrl(info));
    return info;
  } catch (err) {
    console.error(`Failed to send email to ${to}:`, err);
  }
}

module.exports = {
  sendEmail
};
