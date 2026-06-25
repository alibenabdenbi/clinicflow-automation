// src/services/mailer.js
// Single shared SMTP transporter for all outbound email.
// All services import createTransporter() from here — never configure SMTP inline.

import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

export function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false },
    pool: true,
    maxConnections: 3,
    maxMessages: 10,
    rateDelta: 3000,
    rateLimit: 1,
  });
}

export const FROM      = process.env.SMTP_FROM || process.env.SMTP_USER;
export const FROM_NAME = 'Mohamed - ClinicFlow';
export const FROM_FULL = `${FROM_NAME} <${FROM}>`;

export async function verifyConnection() {
  const t = createTransporter();
  await t.verify();
  return true;
}

export async function sendMail(options) {
  const t = createTransporter();
  return await t.sendMail({
    from: FROM_FULL,
    headers: {
      'List-Unsubscribe': '<mailto:contact@clinicflowautomation.com?subject=unsubscribe>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      ...(options.headers || {}),
    },
    ...options,
  });
}
