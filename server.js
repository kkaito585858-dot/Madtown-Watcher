import express from "express";
import http from "http";
import { Server } from "socket.io";
import cron from "node-cron";
import axios from "axios";
import Parser from "rss-parser";
import dotenv from "dotenv";
import { streamers } from "./streamers.js";
import { getTwitchData } from "./twitch-check.js";

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const parser = new Parser();

app.use(express.static("public"));

/**
 * ✅ YouTubeライブ判定（RSS＋/liveページ）
 * - ライブ中のみ live = true
 * - 配信予定は検知しない
 */
async function getYoutubeData(channelIdOrName) {
  if (!channelIdOrName || channelIdOrName.trim() === "")
    return { live: false, thumbnail: "", videoId: null, valid: false };

  try {
    // RSSで最新動画取得
    const feed = await parser.parseURL(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelIdOrName}`
    );

    const latest = feed.items?.[0];
    const match = latest?.link?.match(/(?:v=|shorts\/)([a-zA-Z0-9_-]+)/);
    const videoId = match ? match[1] : null;

    let live = false;
    let liveVideoId = null;

    // /live ページで実際に配信中かチェック
    const url = `https://www.youtube.com/channel/${channelIdOrName}/live`;
    try {
      const res = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 15000,
      });

      const html = res.data;
      const idx = html.indexOf('"isLiveNow":');
      if (idx !== -1) {
        const flag = html.slice(idx, idx + 30).match(/"isLiveNow":(true|false)/);
        if (flag && flag[1] === "true") {
          live = true;
          liveVideoId = videoId;
        }
      }
    } catch (err) {
      console.warn(`YouTube /live check failed (${channelIdOrName}): ${err.message}`);
    }

    const thumbnail = liveVideoId
      ? `https://img.youtube.com/vi/${liveVideoId}/hqdefault.jpg`
      : "";

    return { live, thumbnail, videoId: liveVideoId, valid: true };
  } catch (err) {
    console.error(`YouTube RSS error (${channelIdOrName}): ${err.message}`);
    return { live: false, thumbnail: "", videoId: null, valid: false };
  }
}

/**
 * ✅ 配信状況更新
 */
async function updateStatuses() {
  console.time("updateStatuses");

  try {
    const results = await Promise.all(
      streamers.map(async (streamer) => {
        try {
          const [twitchData, youtubeData] = await Promise.allSettled([
            getTwitchData(streamer.twitch),
            getYoutubeData(streamer.youtube),
          ]);

          const twitch = twitchData.status === "fulfilled" ? twitchData.value : {};
          const youtube = youtubeData.status === "fulfilled" ? youtubeData.value : {};

          return {
            name: streamer.name,
            // Twitch
            twitchLogin: twitch.valid ? streamer.twitch : "",
            twitchLive: twitch.valid ? twitch.live : false,
            twitchIcon: twitch.valid ? twitch.profile_image_url : "",
            // YouTube
            youtubeLive: youtube.valid ? youtube.live : false,
            youtubeIcon: youtube.valid ? youtube.thumbnail : "",
            videoId: youtube.valid ? youtube.videoId : null,
          };
        } catch (err) {
          console.error(`[updateStatuses] ${streamer.name} failed: ${err.message}`);
          return {
            name: streamer.name,
            twitchLogin: "",
            twitchLive: false,
            twitchIcon: "",
            youtubeLive: false,
            youtubeIcon: "",
            videoId: null,
          };
        }
      })
    );

    io.emit("statusUpdate", results);
  } catch (err) {
    console.error("[updateStatuses] Global error:", err);
  }

  console.timeEnd("updateStatuses");
}

// 🔁 1分ごとに更新
cron.schedule("* * * * *", () => {
  console.log("[CRON] Updating stream statuses...");
  updateStatuses();
});

// 🌐 クライアント接続時に即送信
io.on("connection", (socket) => {
  console.log("Client connected");
  updateStatuses();
});

// 🚀 サーバー起動
server.listen(3000, () =>
  console.log("✅ Server running on http://localhost:3000")
);
