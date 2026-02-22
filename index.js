require("dotenv").config();
const express = require("express");
const { Client, GatewayIntentBits, ActivityType } = require("discord.js");

const app = express();
const PORT = process.env.PORT || 4000;
const TOKEN = process.env.DISCORD_TOKEN;
const TENOR_KEY = process.env.TENOR_API_KEY;

// --- WEB SERVER ---
app.get("/", (req, res) => {
  res.send("✅ Floppa Bot is awake");
});
app.listen(PORT, () => console.log(`🌐 Web server running on port ${PORT}`));

// --- DISCORD BOT ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let cooldown = false;

async function getRandomFloppa() {
  try {
    // Using built-in fetch (standard in Node 25)
    const response = await fetch(`https://tenor.googleapis.com/v2/search?q=floppa&key=${TENOR_KEY}&limit=20`);
    const json = await response.json();
    if (!json.results || json.results.length === 0) return "😭 No Floppa found";
    const randomIndex = Math.floor(Math.random() * json.results.length);
    return json.results[randomIndex].media_formats.gif.url;
  } catch (err) {
    console.error("Fetch Error:", err);
    return "❌ Error getting Floppa";
  }
}

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setPresence({
    activities: [{ name: "for !floppa", type: ActivityType.Watching }]
  });
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  const content = message.content.toLowerCase();

  if (content === "!floppa" || content.includes("bruh") || content.includes("buh")) {
    if (cooldown) return;
    cooldown = true;
    const gif = await getRandomFloppa();
    await message.channel.send(gif);
    setTimeout(() => (cooldown = false), 3000);
  }
});

// LOGIN ERROR CATCHING
client.login(TOKEN).catch(err => {
  console.error("❌ LOGIN FAILED:", err.message);
});
