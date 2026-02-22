require("dotenv").config();
const express = require("express");
const { Client, GatewayIntentBits, ActivityType, EmbedBuilder } = require("discord.js");

const app = express();
const PORT = process.env.PORT || 10000;
const TOKEN = process.env.DISCORD_TOKEN;

// --- YOUR CUSTOM FLOPPA GALLERY ---
const FLOPPA_IMAGES = [
  "https://media.discordapp.net/attachments/1219622260718047333/1475237750390390915/00.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475237750797111358/R.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475237751296098597/wp9608133.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475237751711596634/8407938.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475237752105603152/caracal-cat-restingon-perch-k3s3jtnv4i060jky.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475237752646926396/8407931.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475237753313562824/8407907.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475237753842041045/d0d3a009c1f23c3937bafabf5106d0a6.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475237754127515819/big-floppa.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475238447571534085/925774398972dd015142017588cd60c4.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475238448028975194/its-floppa-friday-v0-ak7ern2v3o0a1.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475238448414589230/m6r24brupa491.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475238448980824074/walter-floppa-white-v0-fs8wwr55ccna1.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475238449480208555/60b4cf3985600a50dd341bb7.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475238449882730670/f133b868d8438818b222d7381adaadb5.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475238450629185737/f0ccfad7b02dd8cb892c5b53ada5b15c.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475238451455721684/ab28799af864f0db594e9aa273df4b4e.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475238451858112584/343430302_751678373288724_6240394485483171024_n.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475240455464550570/ZLCzIgpig35uRVKEdAYJnXBhba4dLIPxJ0mdHLis38RYzUf2hDwjF7MB2HVU2YpJoGEckTA_9gs900-c-k-c0x00ffffff-no-rj.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475240456161071175/img63f624f4ad7080.84122409.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475240456983150755/387.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475240457922412566/OIP.png",
  "https://media.discordapp.net/attachments/1219622260718047333/1475240459818369205/floppa4.jpg",
  "https://media.discordapp.net/attachments/1219622260718047333/1475240460372152372/floppa6.webp",
  "https://media.discordapp.net/attachments/1219622260718047333/1475240460791447602/floppa7.jpg",
  "https://media.discordapp.net/attachments/1219622260718047333/1475240461152293034/floppa8.jpg",
  "https://wallpapers.com/images/hd/caracal-cat-restingon-perch-k3s3jtnv4i060jky.jpg"
];

// --- WEB SERVER ---
app.get("/", (req, res) => res.send("✅ Floppa Bot with Gallery is live!"));
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 Web server running on port ${PORT}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

let cooldown = false;

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  client.user.setPresence({
    status: "online",
    activities: [{ name: "Big Floppa Gallery", type: ActivityType.Watching }]
  });
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  
  const content = message.content.toLowerCase();

  if (content === "!floppa" || content.includes("bruh") || content.includes("buh")) {
    if (cooldown) return;
    cooldown = true;
    
    // Pick a random image from YOUR specific list
    const randomUrl = FLOPPA_IMAGES[Math.floor(Math.random() * FLOPPA_IMAGES.length)];
    
    const embed = new EmbedBuilder()
      .setColor("#D2B48C")
      .setTitle("📸 Floppa Spotted!")
      .setImage(randomUrl)
      .setFooter({ text: "Source: Private Floppa Collection" });

    await message.channel.send({ embeds: [embed] });
    
    setTimeout(() => (cooldown = false), 3000);
  }
});

client.login(TOKEN).catch(err => console.error("❌ LOGIN FAILED:", err.message));
