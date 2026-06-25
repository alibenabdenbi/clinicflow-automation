// src/cli/triggerDemo.js
// Sends the opening demo SMS to a prospect immediately after a sales call.
// Usage: node src/cli/triggerDemo.js --phone +16135551234 --clinic "Fallowfield Dental"
// When the prospect texts back, demo-sms.js handles the AI receptionist demo.

import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config();

const args = process.argv.slice(2);
const phoneIdx  = args.indexOf('--phone');
const clinicIdx = args.indexOf('--clinic');

const phone  = phoneIdx  !== -1 ? args[phoneIdx  + 1] : null;
const clinic = clinicIdx !== -1 ? args[clinicIdx + 1] : 'your clinic';

if (!phone) {
  console.log('Usage: node src/cli/triggerDemo.js --phone +1XXXXXXXXXX --clinic "Clinic Name"');
  process.exit(1);
}

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

await client.messages.create({
  body: `Hi — you just spoke with Mohamed's team about ClinicFlow.

Text anything back to this number and experience exactly what your patients would feel when they call ${clinic} and no one picks up.

Takes 60 seconds. — ClinicFlow Team`,
  from: process.env.TWILIO_FROM_NUMBER,
  to: phone,
});

console.log('✓ Demo trigger sent to:', phone);
console.log('  Clinic:', clinic);
console.log('  When they text back → AI receptionist demo fires automatically');
