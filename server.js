const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const zlib = require("zlib");
const { pathToFileURL } = require("url");

const root = __dirname;
const publicDir = path.join(root, "public");
const localUploadDir = path.join(root, ".local-data", "uploads");

function loadEnv() {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const apiRoutes = {
  "/api/config": "./api/config.js",
  "/api/me": "./api/me.js",
  "/api/auth/google/start": "./api/auth/google/start.js",
  "/api/auth/google/callback": "./api/auth/google/callback.js",
  "/api/auth/logout": "./api/auth/logout.js",
  "/api/course-activity": "./api/course-activity.js",
  "/api/favorites": "./api/favorites.js",
  "/api/stats": "./api/stats.js",
  "/api/quick-reports": "./api/quick-reports.js",
  "/api/admin-stats": "./api/admin-stats.js",
  "/api/admin-logs": "./api/admin-logs.js",
  "/api/admin-user-stats": "./api/admin-user-stats.js",
  "/api/profile": "./api/profile.js",
  "/api/polls": "./api/polls.js",
  "/api/comments": "./api/comments.js"
};

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf"
};

const compressibleTypes = /^(text\/|application\/javascript|application\/json|image\/svg)/;

function sendFile(req, res, filePath) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";
  const buffer = fs.readFileSync(filePath);
  const etag = `"${crypto.createHash("sha1").update(buffer).digest("hex")}"`;

  res.setHeader("content-type", contentType);
  res.setHeader("etag", etag);
  res.setHeader("cache-control", "public, max-age=0, must-revalidate");

  if (req.headers["if-none-match"] === etag) {
    res.statusCode = 304;
    res.end();
    return;
  }

  if (compressibleTypes.test(contentType) && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    res.setHeader("content-encoding", "gzip");
    res.end(zlib.gzipSync(buffer));
    return;
  }

  res.end(buffer);
}

function localResponse(res) {
  res.status = (statusCode) => {
    res.statusCode = statusCode;
    return res;
  };
  res.json = (payload) => {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(payload));
  };
  res.send = (payload) => {
    res.end(payload);
  };
  return res;
}

async function handleApi(req, res, pathname) {
  const route = apiRoutes[pathname];
  if (!route) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "API not found" }));
    return;
  }

  const apiDir = path.join(root, "api");
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(apiDir)) delete require.cache[key];
  }
  const handler = require(route);
  await handler(req, localResponse(res));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);

    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname);
      return;
    }

    if (pathname.startsWith("/uploads/")) {
      const uploadName = path.basename(pathname);
      sendFile(req, res, path.join(localUploadDir, uploadName));
      return;
    }

    const requested = pathname === "/" ? "/index.html" : pathname;
    const filePath = path.join(publicDir, requested);
    const normalized = path.normalize(filePath);

    if (!normalized.startsWith(publicDir)) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    if (fs.existsSync(normalized)) {
      sendFile(req, res, normalized);
      return;
    }

    sendFile(req, res, path.join(publicDir, "index.html"));
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Internal server error" }));
  }
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`SNU Archive dev server: http://localhost:${port}`);
  console.log(pathToFileURL(path.join(publicDir, "index.html")).toString());
});
