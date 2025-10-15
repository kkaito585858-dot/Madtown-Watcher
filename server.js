import express from "express";
import http from "http";
import { Server } from "socket.io";
import cron from "node-cron";
import axios from "axios";
import dotenv from "dotenv";
import puppeteer from "puppeteer";
import { streamers } from "./streamers.js";
import { getTwitchData } from "./twitch-check.js";

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

/**
 * Puppeteer版 YouTubeライブ判定
 */
async function getYoutubeDataPuppeteer(channelId) {
  if (!channelId) return { live: false, videoId: null, thumbnail: "", valid: false };

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.goto(`https://www.youtube.com/channel/${channelId}/live`, {
      waitUntil: "domcontentloaded",
      timeout: 60000, // タイムアウト60秒に延長
    });

    // ページから ytInitialData を取得
    const data = await page.evaluate(() => {
      try {
        const scripts = Array.from(document.querySelectorAll("script"));
        const initialDataScript = scripts.find(s => s.textContent.includes("ytInitialData"));
        if (!initialDataScript) return null;
        const jsonText = initialDataScript.textContent.match(/ytInitialData\s*=\s*(\{.*\});/)[1];
        return JSON.parse(jsonText);
      } catch {
        return null;
      }
    });

    let live = false;
    let videoId = null;

    if (data) {
      const videoRenderer =
        data.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
          ?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]
          ?.shelfRenderer?.content?.expandedShelfContentsRenderer?.items?.[0]
          ?.videoRenderer;

      if (videoRenderer) {
        live = true;
        videoId = videoRenderer.videoId;
      }
    }

    const thumbnail = videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : "";

    return { live, videoId, thumbnail, valid: true };
  } catch (err) {
    console.error("Puppeteer YouTube check failed:", err);
    return { live: false, videoId: null, thumbnail: "", valid: false };
  } finally {
    if (browser) await browser.close();
  }
}

/**
 * 配信状況更新（逐次処理＋同時実行防止）
 */
let updateQueue = Promise.resolve();

async function updateStatusesSequential() {
  const results = [];

  for (const streamer of streamers) {
    try {
      const twitchData = await getTwitchData(streamer.twitch);
      const youtubeData = await getYoutubeDataPuppeteer(streamer.youtube);

      results.push({
        name: streamer.name,
        twitchLogin: twitchData.valid ? streamer.twitch : "",
        twitchLive: twitchData.valid ? twitchData.live : false,
        twitchIcon: twitchData.valid ? twitchData.profile_image_url : "",
        youtubeLive: youtubeData.valid ? youtubeData.live : false,
        youtubeIcon: youtubeData.valid ? youtubeData.thumbnail : "",
        videoId: youtubeData.valid ? youtubeData.videoId : null,
      });
    } catch (err) {
      console.error(`Error updating ${streamer.name}:`, err);
    }
  }

  io.emit("statusUpdate", results);
}

function scheduleUpdateStatuses() {
  updateQueue = updateQueue.then(updateStatusesSequential);
}

// 🔁 1分ごとに更新
cron.schedule("* * * * *", () => {
  console.log("[CRON] Updating stream statuses...");
  scheduleUpdateStatuses();
});

// 🌐 クライアント接続時に即送信
io.on("connection", (socket) => {
  console.log("Client connected");
  scheduleUpdateStatuses();
});

// 🚀 サーバー起動
server.listen(3000, () =>
  console.log("Server running on http://localhost:3000")
);
