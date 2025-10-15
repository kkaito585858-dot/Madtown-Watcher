import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_TOKEN = process.env.TWITCH_TOKEN;

async function getTwitchData(userLogin) {
  if (!userLogin || userLogin.trim() === "")
    return { live: false, profile_image_url: "", valid: false };

  try {
    const userRes = await axios.get(
      `https://api.twitch.tv/helix/users?login=${userLogin}`,
      {
        headers: {
          "Client-ID": TWITCH_CLIENT_ID,
          "Authorization": `Bearer ${TWITCH_TOKEN}`,
        },
      }
    );
    const user = userRes.data.data?.[0];
    if (!user) return { live: false, profile_image_url: "", valid: false };

    const streamRes = await axios.get(
      `https://api.twitch.tv/helix/streams?user_login=${userLogin}`,
      {
        headers: {
          "Client-ID": TWITCH_CLIENT_ID,
          "Authorization": `Bearer ${TWITCH_TOKEN}`,
        },
      }
    );

    const live = streamRes.data.data?.length > 0;
    return { live, profile_image_url: user.profile_image_url, valid: true };
  } catch (err) {
    console.error("Twitch API error:", err.message);
    return { live: false, profile_image_url: "", valid: false };
  }
}

// ✅ ESM形式でエクスポート
export { getTwitchData };
