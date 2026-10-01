// يفحص صياغة كل ملفات JavaScript في المشروع (بدون تشغيلها) قبل النشر
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const SKIP = new Set(["node_modules", ".git", "auth", "logs", "deps"]);
const files = [];

(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(c|m)?js$/.test(entry.name)) files.push(full);
  }
})(".");

let failed = 0;
for (const file of files) {
  try {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  } catch (error) {
    failed++;
    console.error(`❌ ${file}\n${error.stderr?.toString() || error.message}`);
  }
}

console.log(`${files.length - failed}/${files.length} files OK`);
if (failed) process.exit(1);
