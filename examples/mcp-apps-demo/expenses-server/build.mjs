// 1) Bundle the server (deps stay in node_modules).  2) Bundle the View + SDK into ONE html file.
import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/main.ts"], outfile: "dist/server.js", bundle: true, platform: "node",
  format: "esm", target: "node22", packages: "external", logLevel: "warning",
});
const view = await build({ entryPoints: ["ui/expenses.ts"], bundle: true, format: "iife", target: "es2020", minify: true, write: false });
const js = view.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = await readFile("ui/expenses.css", "utf8");
await writeFile("dist/expenses.html", (await readFile("ui/expenses.html", "utf8"))
  .replace("/*__CSS__*/", () => css).replace("/*__JS__*/", () => js));
console.log("built dist/server.js and dist/expenses.html");
