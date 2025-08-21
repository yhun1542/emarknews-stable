import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.join(__dirname, "..", "public");
const HTML_FILES = ["index.html", "detail.html"];
const STATIC_EXT = /\.(css|js|png|jpg|jpeg|gif|webp|svg|ico|woff2?)$/i;

const hashedMap = new Map();

function hashOf(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 8);
}

function isAlreadyHashed(filename) {
  // e.g. app.1a2b3c4d.js
  return /\.[0-9a-f]{8}\.[^.]+$/i.test(filename);
}

function hashRenameFile(absPath) {
  const rel = path.relative(PUBLIC_DIR, absPath).replace(/\\/g, "/");
  const base = path.basename(rel);
  if (isAlreadyHashed(base)) return rel; // skip

  const buf = fs.readFileSync(absPath);
  const h = hashOf(buf);

  const ext = path.extname(base);
  const name = path.basename(base, ext);
  const hashedName = `${name}.${h}${ext}`;
  const newRel = path.join(path.dirname(rel), hashedName).replace(/\\/g, "/");
  const newAbs = path.join(PUBLIC_DIR, newRel);

  // 중복 생성 방지
  if (!fs.existsSync(path.dirname(newAbs))) {
    fs.mkdirSync(path.dirname(newAbs), { recursive: true });
  }
  fs.copyFileSync(absPath, newAbs);

  hashedMap.set(`/${rel}`, `/${newRel}`);
  return newRel;
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(abs);
    } else if (STATIC_EXT.test(entry.name)) {
      hashRenameFile(abs);
    }
  }
}

function rewriteHTML(htmlFile) {
  const abs = path.join(PUBLIC_DIR, htmlFile);
  if (!fs.existsSync(abs)) return;

  let html = fs.readFileSync(abs, "utf-8");

  // href/src 교체 (절대/상대 경로 모두 대응)
  for (const [orig, hashed] of hashedMap) {
    const re1 = new RegExp(orig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    html = html.replace(re1, hashed);

    const relOrig = orig.replace(/^\//, "");
    const relHashed = hashed.replace(/^\//, "");
    const re2 = new RegExp(relOrig.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    html = html.replace(re2, relHashed);
  }

  fs.writeFileSync(abs, html, "utf-8");
}

function writeManifest() {
  const obj = {};
  for (const [k, v] of hashedMap.entries()) obj[k] = v;
  fs.writeFileSync(path.join(PUBLIC_DIR, "asset-manifest.json"), JSON.stringify(obj, null, 2));
}

console.log("[hash-static] start");
walk(PUBLIC_DIR);
HTML_FILES.forEach(rewriteHTML);
writeManifest();
console.log(`[hash-static] done. hashed ${hashedMap.size} assets`);

