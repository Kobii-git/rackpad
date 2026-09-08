import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
export function headingAnchors(markdown) {
  const anchors = new Set();
  const counts = new Map();
  for (const line of markdown.replace(/```[\s\S]*?```/g, "").split("\n")) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*#*$/)?.[1];
    if (!heading) continue;
    const slug = heading.toLowerCase().replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/ /g, "-");
    const count = counts.get(slug) ?? 0;
    anchors.add(count ? `${slug}-${count}` : slug);
    counts.set(slug, count + 1);
  }
  for (const match of markdown.matchAll(/\bid=["']([^"']+)["']/g)) anchors.add(match[1]);
  return anchors;
}

export function inspectOperatorDocs(repository = root) {
  const docs = ["README.md", "INSTALL.md", "CONTRIBUTING.md", "SECURITY.md", "STYLE_NOTES.md",
    ...readdirSync(path.join(repository, "docs")).filter((name) => name.endsWith(".md")).map((name) => `docs/${name}`)];
  const scripts = JSON.parse(readFileSync(path.join(repository, "package.json"), "utf8")).scripts;
  const failures = [];
  const stable = readFileSync(path.join(repository, "INSTALL.md"), "utf8").match(/Current stable release: `v([^`]+)`/)?.[1];
  if (!stable) failures.push("INSTALL.md: missing stable release declaration");
  for (const file of docs) {
    const original = readFileSync(path.join(repository, file), "utf8");
    const text = original.replace(/```[\s\S]*?```/g, "");
    if (/github\.com\/(?:your-org|your-user|username)\//i.test(original)) failures.push(`${file}: placeholder GitHub URL`);
    for (const match of original.matchAll(/\bnpm run ([\w:-]+)/g)) {
      if (!scripts[match[1]]) failures.push(`${file}: unknown package command ${match[1]}`);
    }
    for (const match of text.matchAll(/(?<!!)\[[^\]\n]+\]\(([^)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, "").split(/\s+["']/)[0];
      if (/^(?:[a-z]+:|\/\/)/i.test(target) || /\.(?:png|jpe?g|webp|svg)(?:#|$)/i.test(target)) continue;
      const [relative, fragment] = target.split("#");
      let decoded;
      try { decoded = decodeURIComponent(relative); } catch { failures.push(`${file}: malformed link ${target}`); continue; }
      const destination = path.resolve(repository, path.dirname(file), decoded || path.basename(file));
      if (!existsSync(destination)) { failures.push(`${file}: missing link ${target}`); continue; }
      if (fragment && destination.endsWith(".md") && !headingAnchors(readFileSync(destination, "utf8")).has(decodeURIComponent(fragment))) {
        failures.push(`${file}: missing anchor ${target}`);
      }
    }
    for (const match of original.matchAll(/(?:Current stable release:\s*`v|Stable:\s*\*\*v)([\d.]+)/g)) {
      if (match[1] !== stable) failures.push(`${file}: stable reference disagrees with INSTALL.md`);
    }
  }
  const version = JSON.parse(readFileSync(path.join(repository, "package.json"), "utf8")).version;
  const candidate = readFileSync(path.join(repository, "README.md"), "utf8").match(/This branch prepares \*\*v([^*]+)\*\*/)?.[1];
  if (candidate && candidate !== version) failures.push("README.md: candidate version differs from package.json");
  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = inspectOperatorDocs();
  if (failures.length) throw new Error(`Operator documentation drift:\n- ${failures.join("\n- ")}`);
  console.log("Maintained operator guides: links, anchors, package commands, release declarations, and repository URLs valid (screenshots excluded).");
}
