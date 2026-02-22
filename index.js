// Import necessary modules
const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionsBitField,
    ThreadChannel,
    AttachmentBuilder,
    EmbedBuilder,
    ChannelType 
} = require('discord.js');

// --- VOICE IMPORTS ---
const { 
    joinVoiceChannel, 
    getVoiceConnection, 
    createAudioPlayer,
    createAudioResource, 
    VoiceConnectionStatus,
    entersState
} = require('@discordjs/voice');
const discordTTS = require('discord-tts'); 

const http = require('http');
const fs = require('fs');

// --- AI Import ---
const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require('@google/generative-ai');

// Check for the mandatory token environment variable
if (!process.env.TOKEN) {
    console.error("❌ TOKEN not found. Add TOKEN in Environment Variables.");
    process.exit(1);
}

// --- AI Key Check ---
let aiModelInstance;
let AI_ENABLED = !!process.env.GEMINI_API_KEY;

if (!AI_ENABLED) {
    console.error("❌ GEMINI_API_KEY not found. AI commands (/ask) and AI moderation are DISABLED.");
} else {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        aiModelInstance = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    } catch (e) {
        console.error("❌ Failed to initialize GoogleGenerativeAI.", e);
        AI_ENABLED = false;
    }
}

// ====================== CLIENT SETUP ======================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates 
    ]
});

// ====================== CONFIGURATION ======================
const GUILD_ID = '1369477266958192720';
const TARGET_CHANNEL_ID = '1415134887232540764';
const LOG_CHANNEL_ID = '1414286807360602112';

// ====================== BLACKLIST ======================
// The bot will NEVER copy these IDs
const IGNORED_IDS = ['888238712780128288', '1360737030895833360'];

// ====================== DATA STORAGE ======================
const afkStatus = new Map();
let copyEnabled = true; // Global toggle switch
let persistentVoiceChannelId = null;

// ====================== HELPER FUNCTIONS ======================

function speakInVC(guildId, text) {
    const connection = getVoiceConnection(guildId);
    if (!connection) return false;
    try {
        const safeText = text.length > 200 ? text.substring(0, 200) + "..." : text;
        const stream = discordTTS.getVoiceStream(safeText);
        const resource = createAudioResource(stream, { inlineVolume: true });
        resource.volume.setVolume(1);
        const player = createAudioPlayer();
        player.play(resource);
        connection.subscribe(player);
        return true;
    } catch (e) {
        console.error("TTS Error:", e);
        return false;
    }
}

// ====================== FILTER LOGIC ======================
const ALLOWED_WORDS = ["assist", "assistance", "assistant", "associat", "class", "classic", "glass", "grass", "pass", "bass", "compass", "hello", "shell", "peacock", "cocktail", "babcock"];
const MILD_BAD_WORDS = ["fuck", "f*ck", "f**k", "f-ck", "fck", "fu-", "f-", "f*cking", "fucking", "shit", "s*it", "s**t", "sh!t", "ass", "bitch", "hoe", "whore", "slut", "cunt", "dick", "pussy", "cock", "bastard", "sexy"];
const SEVERE_WORDS = ["nigger", "nigga", "niga", "faggot", "fag", "dyke", "tranny", "chink", "kike", "paki", "gook", "spic", "beaner", "coon", "retard", "spastic", "mong", "autist", "kys", "kill yourself", "suicide", "rape", "molest", "hitler", "nazi", "kkk"];
const LEET_MAP = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '(': 'c', '+': 't', '8': 'b', '*': 'o', '9': 'g' };

function filterMessageManually(text) {
    if (!text) return { isSevere: false, isMild: false };
    let normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');
    let leetNormalized = normalized.split('').map(char => LEET_MAP[char] || char).join('');
    const checkNormalizedText = (list, normText) => {
        for (const badWord of list) {
            if (normText.includes(badWord)) {
                if (ALLOWED_WORDS.some(allowed => allowed.includes(badWord))) continue;
                return badWord;
            }
        }
        return null;
    };
    let severeMatch = checkNormalizedText(SEVERE_WORDS, normalized) || checkNormalizedText(SEVERE_WORDS, leetNormalized);
    if (severeMatch) return { isSevere: true, isMild: false, matchedWord: severeMatch };
    let mildMatch = checkNormalizedText(MILD_BAD_WORDS, normalized) || checkNormalizedText(MILD_BAD_WORDS, leetNormalized);
    if (mildMatch) return { isSevere: false, isMild: true, matchedWord: mildMatch };
    return { isSevere: false, isMild: false, matchedWord: null };
}

// ================= BOT EVENTS =================
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    const commands = [
        new SlashCommandBuilder().setName('copytoggle').setDescription('Turn automatic message copying ON or OFF'),
        new SlashCommandBuilder().setName('say').setDescription('Say something anonymously').addStringOption(opt => opt.setName('text').setDescription('Text').setRequired(true)),
        new SlashCommandBuilder().setName('ask').setDescription('Ask AI').addStringOption(opt => opt.setName('prompt').setDescription('Question').setRequired(true)),
        new SlashCommandBuilder().setName('joinvc').setDescription('Join VC'),
        new SlashCommandBuilder().setName('leavevc').setDescription('Leave VC'),
        new SlashCommandBuilder().setName('clear').setDescription('Clear messages').addIntegerOption(opt => opt.setName('number').setDescription('Number').setRequired(true))
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
        console.log('✅ Slash commands registered.');
    } catch (err) { console.error(err); }
});

// ================= INTERACTION HANDLER =================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // --- /copytoggle handler ---
    if (interaction.commandName === 'copytoggle') {
        copyEnabled = !copyEnabled;
        const status = copyEnabled ? 'ENABLED 🔛' : 'DISABLED 📴';
        return interaction.reply({ content: `Copying is now **${status}**.` });
    }

    if (interaction.commandName === 'say') {
        const text = interaction.options.getString('text');
        await interaction.channel.send(text);
        return interaction.reply({ content: "Sent", ephemeral: true });
    }

    // (Add logic for other commands like /ask, /clear here if needed)
});

// ================= MESSAGE HANDLER =================
client.on('messageCreate', async (message) => {
    // 1. Safety: Ignore all bots and Direct Messages
    if (message.author.bot || !message.guild) return;

    // 2. AUTOMATIC GLOBAL COPY LOGIC
    if (copyEnabled) {
        // Only copy if: 
        // - User is not in IGNORED_IDS
        // - Message does not start with "/" (slash commands)
        if (!IGNORED_IDS.includes(message.author.id) && !message.content.startsWith('/')) {
            if (message.content.length > 0) {
                await message.channel.send(message.content);
            }
        }
    }

    // --- IMAGE ONLY CHANNEL ---
    if (message.channel.id === TARGET_CHANNEL_ID) {
        if (message.attachments.size === 0) {
            await message.delete().catch(() => {});
            return;
        }
        await message.react('✨');
        await message.startThread({ name: `${message.author.username}'s Post`, autoArchiveDuration: 60 });
    }

    // --- MANUAL FILTER ---
    const manualFilter = filterMessageManually(message.content);
    if (manualFilter.isSevere || manualFilter.isMild) {
        await message.delete().catch(() => {});
        const log = client.channels.cache.get(LOG_CHANNEL_ID);
        if (log) log.send(`⚠️ Filter Triggered by ${message.author.tag}: ||${manualFilter.matchedWord}||`);
    }

    // --- AFK LOGIC ---
    if (afkStatus.has(message.author.id)) {
        afkStatus.delete(message.author.id);
        message.reply(`Welcome back ${message.author}! Removed AFK.`);
    }
});

client.login(process.env.TOKEN);

const PORT = process.env.PORT || 1902;
http.createServer((req, res) => { res.writeHead(200); res.end('Bot Running'); }).listen(PORT);
