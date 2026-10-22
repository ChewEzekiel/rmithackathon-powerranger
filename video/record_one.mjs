// Re-record only the sign-in segment (landing -> persona -> rooms) in the headless recorder Chrome.
import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tab } from "./drive.mjs";
const APP = "http://localhost:3000", PORT = "9333", out = "video/rec/01-signin.mp4";
const t = await tab(+PORT, APP);
await t.goto(`${APP}/`); await t.evaluate(`localStorage.clear()`); await t.goto(`${APP}/`); await t.sleep(2500);
rmSync(`${out}.stop`, { force: true });
const rec = spawn(process.execPath, ["video/record.mjs", PORT, APP, out, "60"], { stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => rec.stdout.once("data", r)); await t.sleep(600);
await t.goto(`${APP}/`); await t.sleep(1800);
await t.click("Sign in"); await t.waitText("Sign in as a researcher"); await t.sleep(1200);
await t.click("Dr Mei Lee"); await t.waitFor(`document.querySelector('a[href*="room?id="]')`, 30000); await t.sleep(2400);
writeFileSync(`${out}.stop`, ""); await new Promise((r) => rec.on("exit", r)); t.close();
