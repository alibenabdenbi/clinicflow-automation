// src/services/screenshotEngine.js
// Renders personalized clinic preview HTML and captures a 1200×800 PNG screenshot.

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { generateClinicPreview } from './previewGenerator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const SCREENSHOTS_DIR = path.join(ROOT, 'data', 'screenshots');
const SCREENSHOT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function slug(clinicName) {
  return clinicName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function ensureDir() {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

/**
 * Renders an HTML string via headless Chrome and saves a 1200×800 PNG.
 * @param {string} html - Full HTML document
 * @param {string} outputPath - Absolute path to save the PNG
 * @returns {Promise<string>} outputPath
 */
export async function takeScreenshot(html, outputPath) {
  ensureDir();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.setContent(html, { waitUntil: 'networkidle' });
    // Wait for Google Fonts to finish rendering
    await page.waitForFunction(() => document.fonts.ready.then(() => true));
    await page.waitForTimeout(400); // let CSS animations settle
    await page.screenshot({ path: outputPath, type: 'png', clip: { x: 0, y: 0, width: 1200, height: 800 } });
    return outputPath;
  } finally {
    await browser.close();
  }
}

/**
 * Generates a personalized clinic preview HTML, screenshots it, and returns the path.
 * Caches — skips regeneration if file is < 24h old.
 * @param {object} clinic - Same shape as generateClinicPreview's argument
 * @returns {Promise<string>} path to PNG file
 */
export async function generateProspectScreenshot(clinic) {
  ensureDir();
  const filename = slug(clinic.clinicName || 'clinic') + '.png';
  const outputPath = path.join(SCREENSHOTS_DIR, filename);

  // Cache check
  if (fs.existsSync(outputPath)) {
    const { mtimeMs } = fs.statSync(outputPath);
    if (Date.now() - mtimeMs < SCREENSHOT_TTL_MS) {
      return outputPath;
    }
  }

  const html = generateClinicPreview(clinic);
  return takeScreenshot(html, outputPath);
}
