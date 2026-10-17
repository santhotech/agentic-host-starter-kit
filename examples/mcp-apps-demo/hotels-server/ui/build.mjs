// Bundle src/explorer.ts (+ the ext-apps SDK) and inline it into one self-contained HTML file.
// One file = nothing external to fetch = nothing for the host's deny-by-default CSP to block.
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";

const out = await build({
  entryPoints: ["src/explorer.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  write: false,
});
const js = out.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = await readFile("src/explorer.css", "utf8");
const html = (await readFile("src/explorer.html", "utf8"))
  .replace("/*__CSS__*/", () => css)
  .replace("/*__JS__*/", () => js);
await mkdir("dist", { recursive: true });
await writeFile("dist/explorer.html", html);
console.log(`dist/explorer.html  ${(html.length / 1024).toFixed(1)} KB`);
