require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const { Client, GatewayIntentBits, ActivityType } = require("discord.js");

const app = express();
const PORT = process.env.PORT || 4000;
const TOKEN = process.env.DISCORD_TOKEN;
const TENOR_KEY = process.env.TENOR_API_KEY;

// --- WEB SERVER (Keep-alive) ---
app.get("/", (req, res) => {
  res.send("✅ Floppa Bot is running");
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

// Fetch random Floppa GIF from Tenor
async function getRandomFloppa() {
  try {
    // Note: Tenor v2 uses 'q' for search and returns 'results'
    const url = `https://tenor.googleapis.com/v2/search?q=floppa&key=${TENOR_KEY}&limit=20`;
    const response = await fetch(url);
    const json = await response.json();
    
    if (!json.results || json.results.length === 0) return "😭 No Floppa found";

    const randomIndex = Math.floor(Math.random() * json.results.length);
    // Path for v2: results[i].media_formats.gif.url
    return json.results[randomIndex].media_formats.gif.url;
  } catch (err) {
    console.error("Error fetching Floppa GIF:", err);
    return "❌ Error getting Floppa";
  }
}

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  client.user.setPresence({
    status: "online",
    activities: [{ name: "Floppa is watching", type: ActivityType.Watching }]
  });
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();
  const isCommand = content === "!floppa";
  const isTrigger = content.includes("buh") || content.includes("bruh");

  if (isCommand || isTrigger) {
    if (cooldown) return;
    
    cooldown = true;
    const gif = await getRandomFloppa();
    await message.channel.send(gif);

    // Reset cooldown after 3 seconds
    setTimeout(() => (cooldown = false), 3000);
  }
});

// Global error handling
process.on("unhandledRejection", (error) => {
  console.error("Unhandled promise rejection:", error);
});

client.login(TOKEN);
