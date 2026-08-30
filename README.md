<div align="center">

# 🎵 HELIX Song API

### A fast, simple audio search & stream API for bots and websites

[![Made by](https://img.shields.io/badge/Made%20by-HELIX%20TANVIR-6C5CE7?style=for-the-badge)](https://www.facebook.com/mdtanvir.albert/)
[![Node](https://img.shields.io/badge/Node.js-18%2B-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org)
[![Status](https://img.shields.io/badge/Status-Active-00b894?style=for-the-badge)]()

Search any song by name → get back a title, artwork, and a ready-to-play
audio link. No API key. No auth. Just JSON in, audio out.

📩 **Contact / Support:** https://www.facebook.com/mdtanvir.albert/

</div>

---

## ✨ Features

- 🔍 **Search by name** — just send a song title, get a match
- ▶️ **Instantly playable** — the returned link streams directly, no download step needed
- 🖼️ **Rich metadata** — title, artist, duration, thumbnail included
- ⚡ **Lightweight** — built on Express, deploys anywhere in minutes
- 🤖 **Bot-ready** — drop-in compatible with Messenger, Discord, Telegram bots
- 🌐 **Website-ready** — works with a plain `fetch()` call and an `<audio>` tag

---

## 🚀 Quick Start

```bash
git clone <your-repo-url>
cd scdl-api
npm install
npm start
```

Your API is now live at `http://localhost:3000`. Try it:

```
http://localhost:3000/api/scdlv2?query=Happy Nation
```

---

## ☁️ Deploying Online

This API needs a persistently running server (not short-lived serverless
functions), since audio streaming can outlast serverless time limits.

<div align="center">

| Platform | Free Tier | Notes |
|:---:|:---:|:---|
| 🚂 **Railway** | ✅ | Easiest — deploys straight from GitHub |
| 🎨 **Render** | ✅ | Similar, spins down when idle |
| 🪰 **Fly.io** | ✅ | More control, Docker-based |
| 🖥️ **VPS** | ❌ (~$4-6/mo) | Best uptime & reliability |

</div>

### Deploying to Railway

1. Push this project to a GitHub repo
2. Go to [railway.app](https://railway.app) → sign in with GitHub
3. **New Project → Deploy from GitHub repo** → select your repo
4. Wait for the build to finish ✅
5. **Settings → Networking → Generate Domain**
6. You'll get a public URL like:
   ```
   https://your-app-name.up.railway.app
   ```

> ⚠️ Avoid Vercel — its serverless functions can cut off long audio streams mid-play.

---

## 📖 API Reference

### `GET /api/scdlv2?query=<song name>`

Search for a track by name.

**Request**
```
GET https://your-domain.up.railway.app/api/scdlv2?query=Happy Nation
```

**Response**
```json
{
  "status": true,
  "result": {
    "title": "Happy Nation",
    "artist": "Ace of Base",
    "duration": 210000,
    "thumbnail": "https://cdn.example.com/artwork.jpg",
    "download_url": "https://your-domain.../api/stream?track=..."
  },
  "credit": {
    "name": "HELIX TANVIR",
    "contact": "https://www.facebook.com/mdtanvir.albert/"
  }
}
```

**Error response** (missing query, or no match found)
```json
{ "status": false, "message": "..." }
```

### `GET /api/stream?track=<url>`

Streams the audio itself. This is what `result.download_url` already
points to — you won't normally build this URL by hand.

- `Content-Type: audio/mpeg`
- Plays inline in browsers / media players — no forced download

---

## 🤖 Bot Integration Example

<details>
<summary><b>Facebook Messenger bot (Goat Bot / FCA-style) — click to expand</b></summary>

```javascript
const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

module.exports = {
  config: {
    name: "song",
    version: "1.0",
    author: "yourname",
    countDown: 2,
    role: 0,
    shortDescription: { en: "Search and play a song" },
    category: "MEDIA",
    guide: { en: "{pn} <song name>" }
  },
  onStart: async function ({ api, event, args }) {
    const { threadID, messageID } = event;
    const query = args.join(" ");
    if (!query) return api.sendMessage("❌ Please enter a song name.", threadID, messageID);

    const cacheDir = path.join(__dirname, "cache");
    fs.ensureDirSync(cacheDir);

    try {
      const apiUrl = `https://your-domain.up.railway.app/api/scdlv2?query=${encodeURIComponent(query)}`;
      const { data } = await axios.get(apiUrl, { timeout: 20000 });
      if (!data.status) throw new Error(data.message);

      const { title, download_url } = data.result;
      const filePath = path.join(cacheDir, `${Date.now()}.mp3`);
      const response = await axios({ url: download_url, method: "GET", responseType: "stream" });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);
      await new Promise((res, rej) => { writer.on("finish", res); writer.on("error", rej); });

      return api.sendMessage(
        { body: `🎧 ${title}`, attachment: fs.createReadStream(filePath) },
        threadID,
        () => fs.existsSync(filePath) && fs.unlinkSync(filePath),
        messageID
      );
    } catch (err) {
      return api.sendMessage(`❌ Failed: ${err.message}`, threadID, messageID);
    }
  }
};
```

</details>

---

## 🌐 Website Integration Example

<details>
<summary><b>Plain HTML + JS search box — click to expand</b></summary>

```html
<input id="query" placeholder="Search a song..." />
<button onclick="search()">Search</button>
<audio id="player" controls></audio>

<script>
  async function search() {
    const query = document.getElementById("query").value;
    const res = await fetch(
      `https://your-domain.up.railway.app/api/scdlv2?query=${encodeURIComponent(query)}`
    );
    const data = await res.json();
    if (data.status) {
      document.getElementById("player").src = data.result.download_url;
    } else {
      alert(data.message);
    }
  }
</script>
```

</details>

For Discord, Telegram, or any other platform, the pattern is identical:
call `/api/scdlv2?query=...`, read `result.download_url`, then stream or
download it depending on what that platform expects.

---

## 📝 Notes

- Only tracks with a valid, playable stream are returned; restricted or
  unavailable tracks are automatically filtered out.
- No rate limiting is built in — if you share this publicly, consider
  adding `express-rate-limit` so your hosting's free-tier hours don't
  get exhausted by heavy use.
- *Maintainer note:* under the hood this relies on a third-party public
  audio-search library that can change without notice — if search
  suddenly stops returning results, check that dependency for an update
  first before assuming your own code broke.

---

<div align="center">

### 💚 Credit

**Built and maintained by HELIX TANVIR**

📩 https://www.facebook.com/mdtanvir.albert/

*Free to use in your own bots and websites — a credit back is appreciated.*

</div>
