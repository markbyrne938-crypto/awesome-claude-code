// Wraps dist/index.html the way the artifact host does, and writes test/out/page.html.
const fs = require("fs"), path = require("path");
module.exports = function wrap(extraHead = "") {
  const html = fs.readFileSync(path.join(__dirname, "../dist/index.html"), "utf8");
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style>${extraHead}</head><body>${html}</body></html>`;
  const out = path.join(__dirname, "out/page.html");
  fs.writeFileSync(out, page);
  return "file://" + out;
};
