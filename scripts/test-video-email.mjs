import dotenv from 'dotenv';
dotenv.config();
import { sendMail } from '../src/services/mailer.js';
import { buildVideoEmail } from '../src/templates/videoEmail.js';

const testClinic = {
  clinicName: 'Toronto Physiotherapy',
  city: 'Toronto',
  email: 'm.aliben432@gmail.com',
  painSignals: [],
};

const { subject, textBody, htmlBody } = buildVideoEmail(testClinic);

await sendMail({
  to: 'm.aliben432@gmail.com',
  subject,
  text: textBody,
  html: htmlBody,
});

console.log('✓ Video thumbnail test email sent to m.aliben432@gmail.com');
console.log('Subject:', subject);
console.log('Check Gmail — click the thumbnail → should open /live');
