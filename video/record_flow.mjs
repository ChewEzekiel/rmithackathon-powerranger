// Perform the Treaty Room walkthrough in the debug Chrome and record each segment to video/rec/<name>.mp4.
// usage: node video/record_flow.mjs [--dry]   (--dry: no recording, screenshots only)
import { spawn } from "node:child_process";
import { writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tab } from "./drive.mjs";

const DRY = process.argv.includes("--dry");
const APP = "http://localhost:3000";
mkdirSync("video/rec", { recursive: true });
const t = await tab(9222, APP);

async function segment(name, fn) {
  let rec;
  const out = `video/rec/${name}.mp4`;
  if (!DRY) {
    rmSync(`${out}.stop`, { force: true });
    rec = spawn(process.execPath, ["video/record.mjs", "9222", APP, out, "120"], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((r) => rec.stdout.once("data", r)); // recorder attached
    await t.sleep(600);
  }
  try { await fn(); await t.sleep(1200); }
  catch (e) { await t.shot(`video/shots/FAIL-${name}.png`); throw e; }
  finally {
    if (!DRY) { writeFileSync(`${out}.stop`, ""); await new Promise((r) => rec.on("exit", r)); }
    else await t.shot(`video/shots/dry-${name}.png`);
  }
  console.log("segment", name, "done");
}
const as = async (who) => { // switch researcher (off camera)
  await t.goto(`${APP}/walkthrough`); await t.waitText("Sign in as a researcher");
  await t.click(who); await t.waitFor(`location.pathname === '/rooms'`); await t.waitFor(`document.querySelector('a[href*="room?id="]')`, 30000); await t.sleep(800);
};
const room = async () => { await t.goto(`${APP}/room?id=alz-biomarkers`); await t.waitText("The treaty", 30000); await t.sleep(900); };
const deposit = async () => { await t.click("Load my synthetic example"); await t.sleep(700); await t.click("Encrypt"); await t.waitText("Deposited", 20000); };

// Clean start (off camera).
await t.goto(`${APP}/`); await t.evaluate(`localStorage.clear()`);

await segment("01-signin", async () => {
  await t.goto(`${APP}/`); await t.sleep(1800);
  await t.click("Sign in"); await t.waitText("Sign in as a researcher"); await t.sleep(1200);
  await t.click("Dr Mei Lee"); await t.waitFor(`document.querySelector('a[href*="room?id="]')`, 30000); await t.sleep(1800);
});
await segment("02-seal-and-deposit", async () => {
  await t.click("Alzheimer"); await t.waitText("The treaty", 30000); await t.sleep(1500);
  await t.click("Sign deposit policy"); await t.waitText("Deposit policy signed", 20000); await t.sleep(900);
  await t.click("Sign reading policy"); await t.waitText("Reading policy signed", 20000); await t.sleep(1200);
  await deposit(); await t.sleep(1200);
  await t.scroll(520, 1500);
});
// Off camera: the other two institutions deposit too.
await as("Dr Daniel Chen"); await room(); await deposit();
await as("Dr Aisha Rahman"); await room(); await deposit();
await as("Dr Mei Lee"); await room();

await segment("03-sealed-for-everyone", async () => {
  await t.scroll(560, 1200);
  await t.click("Open all"); await t.waitText("refused", 20000); await t.sleep(2600);
});
await segment("04-operator-view", async () => {
  await t.click("Operator view"); await t.waitText("What the platform sees", 30000); await t.sleep(1800);
  await t.click("Try to decrypt"); await t.waitText("refused", 20000); await t.sleep(2200);
  await t.scroll(900, 1800);
});
await as("Dr Daniel Chen");
await segment("05-rogue-steward", async () => {
  await t.click("Governance"); await t.waitText("Governance", 30000); await t.sleep(1500);
  await t.click("Propose unseal: Alzheimer"); await t.waitText("change request filed", 20000); await t.sleep(1500);
  await t.waitText("to sign)", 15000); await t.click("Tide enclave"); await t.sleep(900);
  await t.click("Approve and sign"); await t.waitText("1 of 2", 20000); await t.sleep(1800);
  await t.click("Refresh", { exact: true }); await t.sleep(1500);
  await t.click("Force as operator"); await t.waitText("refused", 20000); await t.sleep(2600);
});
await segment("06-still-sealed", async () => {
  await room(); await t.scroll(560, 1000);
  await t.click("Open all"); await t.waitText("refused", 20000); await t.sleep(2200);
});
await as("Dr Aisha Rahman");
await segment("07-treaty-cosign", async () => {
  await t.click("Governance"); await t.waitText("Waiting for signatures", 30000); await t.sleep(1500);
  await t.waitText("to sign)", 15000); await t.click("Tide enclave"); await t.sleep(900);
  await t.click("Approve and sign"); await t.waitText("Quorum reached", 20000); await t.sleep(2600);
});
await as("Dr Mei Lee");
await segment("08-room-opens", async () => {
  await room(); await t.sleep(800);
  await t.scroll(560, 1000);
  await t.click("Open all"); await t.waitText("Opened 3", 20000); await t.sleep(1500);
  await t.scroll(760, 2200); await t.scroll(1100, 2200);
});
t.close();
console.log("all segments done");
