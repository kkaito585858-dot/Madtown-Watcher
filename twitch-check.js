import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_TOKEN = process.env.TWITCH_TOKEN;

// Twitch API GETリクエストをリトライ付きで実行
async function safeTwitchGet(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.get(url, {
        headers: {
          "Client-ID": TWITCH_CLIENT_ID,
          "Authorization": `Bearer ${TWITCH_TOKEN}`,
        },
        timeout: 7000,
      });
    } catch (err) {
      if (i === retries - 1) throw err;
      console.warn(`Twitch request failed, retry ${i + 1}: ${err.message}`);
      await new Promise((res) => setTimeout(res, 500)); // 0.5秒待機
    }
  }
}

export async function getTwitchData(userLogin) {
  if (!userLogin || userLogin.trim() === "")
    return { live: false, profile_image_url: "", valid: false };

  try {
    const userRes = await safeTwitchGet(
      `https://api.twitch.tv/helix/users?login=${userLogin}`
    );
    const user = userRes.data.data?.[0];
    if (!user) return { live: false, profile_image_url: "", valid: false };

    const streamRes = await safeTwitchGet(
      `https://api.twitch.tv/helix/streams?user_login=${userLogin}`
    );
    const live = streamRes.data.data?.length > 0;
    return { live, profile_image_url: user.profile_image_url, valid: true };
  } catch (err) {
    console.error(`Twitch API error for ${userLogin}: ${err.message}`);
    return { live: false, profile_image_url: "", valid: false };
  }
}
