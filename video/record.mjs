// Record a real browser tab (Chrome started with --remote-debugging-port) as an mp4, via the
// DevTools screencast. Stops when the file <out>.stop appears, or after maxSeconds.
// usage: node video/record.mjs <port> <urlPrefix> <out.mp4> [maxSeconds=300]
import { mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";

const [port, prefix, outArg, maxSeconds = "300"] = process.argv.slice(2);
const out = resolve(outArg); // absolute: ffmpeg concat resolves entries relative to the list file
const frames = `${out}.frames`;
rmSync(frames, { recursive: true, force: true });
mkdirSync(frames, { recursive: true });

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const t = targets.find((x) => x.type === "page" && x.url.startsWith(prefix));
if (!t) throw new Error(`no page starting with ${prefix} on port ${port}`);
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
const shots = []; // [file, timestampSeconds]
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.method !== "Page.screencastFrame") return;
  const f = join(frames, `${String(shots.length).padStart(6, "0")}.jpg`);
  writeFileSync(f, Buffer.from(d.params.data, "base64"));
  shots.push([f, d.params.metadata.timestamp]);
  send("Page.screencastFrameAck", { sessionId: d.params.sessionId });
};
send("Page.bringToFront"); // background tabs do not paint, so they emit no frames
send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
console.log(`recording ${t.url.slice(0, 80)} ... touch ${out}.stop to finish`);

const started = Date.now();
while (!existsSync(`${out}.stop`) && Date.now() - started < +maxSeconds * 1000) await new Promise((r) => setTimeout(r, 250));
send("Page.stopScreencast");
ws.close();
rmSync(`${out}.stop`, { force: true });
if (shots.length < 2) throw new Error("no frames captured (is the tab visible?)");

// The screencast only emits frames when the page changes: hold each frame until the next one.
const end = shots.at(-1)[1] + 1;
const list = shots.map(([f, ts], i) => `file '${f.replace(/\\/g, "/")}'\nduration ${((shots[i + 1]?.[1] ?? end) - ts).toFixed(3)}`).join("\n");
writeFileSync(`${frames}/list.txt`, `${list}\nfile '${shots.at(-1)[0].replace(/\\/g, "/")}'\n`);
const ffmpeg = process.env.FFMPEG || join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "bin", "ffmpeg.exe");
const r = spawnSync(ffmpeg, ["-y", "-f", "concat", "-safe", "0", "-i", `${frames}/list.txt`, "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x101014,fps=30,format=yuv420p", "-c:v", "libx264", "-crf", "20", out], { stdio: "inherit" });
console.log(r.status === 0 ? `saved ${out} (${shots.length} frames, ${(end - shots[0][1]).toFixed(1)} s)` : "ffmpeg failed");
