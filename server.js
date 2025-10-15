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
 * YouTubeライブ判定（RSS＋/liveページ）
 * - ライブ中のみ live = true
 * - 配信予定は検知しない
 */
async function getYoutubeData(channelIdOrName) {
  if (!channelIdOrName || channelIdOrName.trim() === "")
    return { live: false, thumbnail: "", videoId: null, valid: false };

  try {
    // RSSで最新動画取得（ライブ以外も取得可能）
    const feed = await parser.parseURL(
      `https://www.youtube.com/feeds/videos.xml?channel_id=${channelIdOrName}`
    );

    const latest = feed.items?.[0];
    const match = latest?.link?.match(/(?:v=|shorts\/)([a-zA-Z0-9_-]+)/);
    const videoId = match ? match[1] : null;

    // 初期値
    let live = false;
    let liveVideoId = null;

    // /liveページを取得してライブ中か判定
    if (channelIdOrName) {
      try {
        const url = `https://www.youtube.com/channel/${channelIdOrName}/live`;
        const res = await axios.get(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          timeout: 10000,
        });
        const html = res.data;

        // JSON内のisLiveNowを正確に取得
        const liveMatch = html.match(/"isLiveNow":(true|false)/);
        if (liveMatch) {
          live = liveMatch[1] === "true";
          if (live) liveVideoId = videoId; // ライブ中のみ動画IDを設定
        }
      } catch (err) {
        console.warn(`YouTube check failed (${channelIdOrName}):`, err.message);
      }
    }

    const thumbnail = liveVideoId
      ? `https://img.youtube.com/vi/${liveVideoId}/hqdefault.jpg`
      : "";

    return { live, thumbnail, videoId: liveVideoId, valid: true };
  } catch (err) {
    console.error("YouTube RSS error:", err.message);
    return { live: false, thumbnail: "", videoId: null, valid: false };
  }
}


/**
 * ✅ 配信状況更新
 */
async function updateStatuses() {
  console.time("updateStatuses");

  const results = await Promise.all(
    streamers.map(async (streamer) => {
      const [twitchData, youtubeData] = await Promise.all([
        getTwitchData(streamer.twitch),
        getYoutubeData(streamer.youtube),
      ]);

      return {
        name: streamer.name,

        // Twitch
        twitchLogin: twitchData.valid ? streamer.twitch : "",
        twitchLive: twitchData.valid ? twitchData.live : false,
        twitchIcon: twitchData.valid ? twitchData.profile_image_url : "",

        // YouTube
        youtubeLive: youtubeData.valid ? youtubeData.live : false,
        youtubeIcon: youtubeData.valid ? youtubeData.thumbnail : "",
        videoId: youtubeData.valid ? youtubeData.videoId : null,
      };
    })
  );

  io.emit("statusUpdate", results);
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
  console.log("Server running on http://localhost:3000")
);
