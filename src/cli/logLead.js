import fs from "fs";
import path from "path";

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf-8");
}

function readArg(name) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return null;
  return process.argv[idx + 1] ?? null;
}

async function main() {
  const file = path.join("data", "leads.json");
  const leads = readJson(file, []);

  const channel = readArg("--channel") || "unknown";
  const handle = readArg("--handle") || "unknown";
  const status = readArg("--status") || "contacted"; // contacted|replied|paid|ignored
  const price = readArg("--price") ? Number(readArg("--price")) : null;
  const notes = readArg("--notes") || "";

  leads.push({
    at: new Date().toISOString(),
    channel,
    handle,
    status,
    price,
    notes
  });

  writeJson(file, leads);
  console.log("✅ Logged lead:", { channel, handle, status, price });
}

main().catch((e) => {
  console.error("❌ Error:", e);
  process.exit(1);
});
