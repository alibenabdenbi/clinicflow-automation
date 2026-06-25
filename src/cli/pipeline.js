import { spawn } from "child_process";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} failed with code ${code}`));
    });
  });
}

async function main() {
  const args = process.argv.slice(2); // ex: Toronto ON

  // 1) Discover
  await run("node", ["localBusinesses.js", ...args]);

  // 2) Merge
  await run("node", ["src/cli/mergeDiscoveredToOutreach.js"]);

  // 3) Enrich
  await run("node", ["src/cli/enrichEmails.js"]);

  // 4) Send batch
  await run("node", ["src/cli/sendBatch.js"]);
}

main().catch((e) => {
  console.error("Pipeline failed:", e.message || e);
  process.exit(1);
});