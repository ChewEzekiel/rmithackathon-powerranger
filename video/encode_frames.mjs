// Re-encode captured screencast frames (video/rec/<name>.mp4.frames/list.txt) into mp4s, with absolute
// paths (ffmpeg's concat demuxer resolves entries relative to the list file).
// usage: node video/encode_frames.mjs [name...]
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const rec = resolve("video/rec");
const ffmpeg = resolve("video/bin/ffmpeg.exe");
const wanted = process.argv.slice(2);
for (const d of readdirSync(rec).filter((x) => x.endsWith(".mp4.frames") && !x.startsWith("test"))) {
  const name = d.replace(/\.mp4\.frames$/, "");
  if (wanted.length && !wanted.includes(name)) continue;
  const list = join(rec, d, "list.txt");
  if (!existsSync(list)) { console.log("skip (no list yet)", name); continue; }
  const abs = readFileSync(list, "utf8").replace(/file '([^']+)'/g, (_, f) => `file '${resolve(f).replace(/\\/g, "/")}'`);
  const absList = join(rec, d, "list_abs.txt");
  writeFileSync(absList, abs);
  const out = join(rec, `${name}.mp4`);
  const r = spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", absList,
    "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0b0b0d,fps=30,format=yuv420p",
    "-c:v", "libx264", "-crf", "20", "-movflags", "+faststart", out], { stdio: "inherit" });
  console.log(r.status === 0 ? `ok ${name}.mp4` : `FAILED ${name}`);
}
