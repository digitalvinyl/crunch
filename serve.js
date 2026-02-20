// Simple static file server for CRUNCH development.
// Usage: node serve.js
// Then open http://localhost:3000 in your browser.

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3000;
const DIR = __dirname;

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".jsx": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".xer": "application/octet-stream",
};

const server = http.createServer((req, res) => {
  let filePath = path.join(DIR, req.url === "/" ? "index.html" : decodeURIComponent(req.url));
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] || "application/octet-stream";

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found: " + req.url);
      return;
    }
    res.writeHead(200, { "Content-Type": contentType + "; charset=utf-8" });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`CRUNCH dev server running at http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});
