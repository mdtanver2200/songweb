const express = require("express");
const cors = require("cors");
const scdl = require("soundcloud-downloader").default;

const app = express();
app.set("trust proxy", 1); // needed on Vercel/Railway/Render so req.protocol reports "https" correctly
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// --- Rate limiting -----------------------------------------------------
// A small custom limiter (rather than a fixed express-rate-limit config)
// so an admin can change the limit live from /admin without redeploying.
// Settings live in memory: they reset to the env-var defaults below if
// the server restarts/redeploys, so set RATE_LIMIT_* env vars on your
// host to whatever you want the "safe default" to be.
const rateLimitConfig = {
  windowMinutes: Number(process.env.RATE_LIMIT_WINDOW_MINUTES) || 15,
  maxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS) || 30,
};

const requestLog = new Map(); // ip -> { count, windowStart }

function rateLimiter(req, res, next) {
  const ip = req.ip;
  const now = Date.now();
  const windowMs = rateLimitConfig.windowMinutes * 60 * 1000;

  let entry = requestLog.get(ip);
  if (!entry || now - entry.windowStart > windowMs) {
    entry = { count: 0, windowStart: now };
  }
  entry.count += 1;
  requestLog.set(ip, entry);

  res.setHeader("X-RateLimit-Limit", rateLimitConfig.maxRequests);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, rateLimitConfig.maxRequests - entry.count));

  if (entry.count > rateLimitConfig.maxRequests) {
    return res.status(429).json({
      status: false,
      message: `Too many requests. Limit is ${rateLimitConfig.maxRequests} requests per ${rateLimitConfig.windowMinutes} minute(s). Please try again later.`,
      credit: {
        name: "HELIX TANVIR",
        contact: "https://www.facebook.com/mdtanvir.albert/",
      },
    });
  }
  next();
}

// Periodically clear out stale entries so the map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  const windowMs = rateLimitConfig.windowMinutes * 60 * 1000;
  for (const [ip, entry] of requestLog) {
    if (now - entry.windowStart > windowMs) requestLog.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// Apply the limit to both endpoints that do real work (search + streaming).
// The root "/" status route and /admin are left off this limiter.
app.use(["/api/scdlv2", "/api/stream"], rateLimiter);

// --- Admin auth ----------------------------------------------------------
// Protects the /admin/* routes with HTTP Basic Auth.
// IMPORTANT: set ADMIN_USER and ADMIN_PASSWORD as environment variables
// on your host before going live — the fallbacks below are NOT safe to
// leave in place on a public deployment.
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "changeme";

function requireAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin"');
    return res.status(401).json({ status: false, message: "Admin authentication required." });
  }
  const [user, pass] = Buffer.from(auth.slice(6), "base64").toString().split(":");
  if (user !== ADMIN_USER || pass !== ADMIN_PASSWORD) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin"');
    return res.status(401).json({ status: false, message: "Invalid admin credentials." });
  }
  next();
}

// GET current rate limit settings + how many IPs are currently tracked.
app.get("/admin/settings", requireAdmin, (_req, res) => {
  res.json({
    status: true,
    settings: rateLimitConfig,
    activeClients: requestLog.size,
  });
});

// Update rate limit settings live — no redeploy needed.
app.post("/admin/settings", requireAdmin, (req, res) => {
  const { windowMinutes, maxRequests } = req.body || {};

  if (windowMinutes !== undefined) {
    const n = Number(windowMinutes);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ status: false, message: "windowMinutes must be a positive number." });
    }
    rateLimitConfig.windowMinutes = n;
  }

  if (maxRequests !== undefined) {
    const n = Number(maxRequests);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ status: false, message: "maxRequests must be a positive number." });
    }
    rateLimitConfig.maxRequests = n;
  }

  res.json({ status: true, settings: rateLimitConfig });
});

/**
 * GET /api/scdlv2?query=<song name>
 *
 * Response shape (matches the client code you already have):
 * {
 *   status: true,
 *   result: {
 *     title: "...",
 *     artist: "...",
 *     duration: 123456,        // ms
 *     thumbnail: "https://...",
 *     download_url: "https://.../stream"  // proxied through this API
 *   }
 * }
 */
app.get("/api/scdlv2", async (req, res) => {
  const query = (req.query.query || "").trim();

  if (!query) {
    return res.status(400).json({
      status: false,
      message: "Missing 'query' parameter. Example: /api/scdlv2?query=Happy Nation",
      credit: {
        name: "HELIX TANVIR",
        contact: "https://www.facebook.com/mdtanvir.albert/",
      },
    });
  }

  try {
    // 1. Search SoundCloud for matching tracks
    const results = await scdl.search({
      query,
      limit: 5,
      resourceType: "tracks",
    });

    const track = results?.collection?.find((t) => t.streamable && t.kind === "track");

    if (!track) {
      return res.status(404).json({
        status: false,
        message: "No streamable results found for that query.",
      });
    }

    // 2. Build our own proxied stream URL instead of exposing SoundCloud's
    //    signed CDN URL directly (those expire and require the client_id).
    const downloadUrl = `${req.protocol}://${req.get("host")}/api/stream?track=${encodeURIComponent(
      track.permalink_url
    )}`;

    return res.json({
      status: true,
      result: {
        title: track.title,
        artist: track.user?.username || "Unknown",
        duration: track.duration,
        thumbnail: track.artwork_url || track.user?.avatar_url || null,
        download_url: downloadUrl,
      },
      credit: {
        name: "HELIX TANVIR",
        contact: "https://www.facebook.com/mdtanvir.albert/",
      },
    });
  } catch (err) {
    console.error("Search error:", err.message);
    return res.status(500).json({
      status: false,
      message: "Failed to search SoundCloud: " + err.message,
    });
  }
});

/**
 * GET /api/stream?track=<permalink_url>
 *
 * Streams the actual audio bytes. This is what /api/scdlv2's
 * download_url points to, and what your bot's axios({ responseType: "stream" })
 * call downloads.
 */
app.get("/api/stream", async (req, res) => {
  const trackUrl = req.query.track;

  if (!trackUrl) {
    return res.status(400).json({ status: false, message: "Missing 'track' parameter." });
  }

  if (!scdl.isValidUrl(trackUrl)) {
    console.error("Rejected track URL as invalid:", trackUrl);
    return res.status(400).json({
      status: false,
      message: "The 'track' URL was not recognized as a valid SoundCloud track URL.",
      received: trackUrl,
    });
  }

  try {
    const stream = await scdl.download(trackUrl);
    res.setHeader("Content-Type", "audio/mpeg");
    stream.pipe(res);
    stream.on("error", (err) => {
      console.error("Stream error:", err.message);
      if (!res.headersSent) res.status(500).end();
    });
  } catch (err) {
    console.error("Download error:", err.message);
    return res.status(500).json({ status: false, message: "Failed to stream track: " + err.message });
  }
});

app.get("/", (_req, res) => {
  res.json({
    status: true,
    message: "SoundCloud download API is running.",
    credit: {
      name: "HELIX TANVIR",
      contact: "https://www.facebook.com/mdtanvir.albert/",
    },
  });
});

app.use("/docs", express.static("docs"));
app.use("/admin", express.static("admin"));

app.listen(PORT, () => {
  console.log(`SCDL API running at http://localhost:${PORT}`);
});
