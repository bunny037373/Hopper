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
const IGNORED_IDS = ['888238712780128288', '1360737030895833360'];

// ====================== DATA STORAGE ======================
const afkStatus = new Map();
let copyEnabled = true;    
let reverseEnabled = false; 
let selfCopyEnabled = true; 
let targetUserId = null; 
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

function scrambleWord(word) {
    if (word.length <= 2) return word;
    const chars = word.split('');
    for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
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

    client.user.setPresence({ 
        activities: [{ name: 'looi', type: 3 }], 
        status: 'online' 
    });

    const commands = [
        new SlashCommandBuilder().setName('target').setDescription('Lock on and mirror/follow a specific user').addUserOption(opt => opt.setName('user').setDescription('The user to follow').setRequired(true)),
        new SlashCommandBuilder().setName('untarget').setDescription('Stop following the current target'),
        new SlashCommandBuilder().setName('copytoggle').setDescription('Turn automatic message copying ON or OFF'),
        new SlashCommandBuilder().setName('reversetoggle').setDescription('Turn character scramble ON or OFF'),
        new SlashCommandBuilder().setName('afk').setDescription('Set an AFK status').addStringOption(opt => opt.setName('reason').setDescription('Why are you away?')),
        new SlashCommandBuilder().setName('ask').setDescription('Ask AI').addStringOption(opt => opt.setName('prompt').setDescription('Question').setRequired(true)),
        new SlashCommandBuilder().setName('joinvc').setDescription('Join current VC manually'),
        new SlashCommandBuilder().setName('leavevc').setDescription('Leave VC manually'),
        new SlashCommandBuilder().setName('clear').setDescription('Clear messages').addIntegerOption(opt => opt.setName('number').setDescription('Number').setRequired(true))
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
        console.log('✅ Commands and Follower Logic ready.');
    } catch (err) { console.error(err); }
});

// ================= INTERACTION HANDLER =================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options } = interaction;

    if (commandName === 'target') {
        const user = options.getUser('user');
        targetUserId = user.id;
        return interaction.reply({ content: `🎯 Target locked: **${user.username}**. I'll follow you everywhere.` });
    }

    if (commandName === 'untarget') {
        targetUserId = null;
        return interaction.reply({ content: `🔓 Standing down. I am no longer following anyone.` });
    }

    if (commandName === 'copytoggle') {
        copyEnabled = !copyEnabled;
        return interaction.reply({ content: `Copying is now **${copyEnabled ? 'ENABLED' : 'DISABLED'}**.` });
    }

    if (commandName === 'reversetoggle') {
        reverseEnabled = !reverseEnabled;
        return interaction.reply({ content: `Scramble mode is **${reverseEnabled ? 'ON' : 'OFF'}**.` });
    }

    if (commandName === 'ask') {
        if (!AI_ENABLED) return interaction.reply("AI is disabled.");
        await interaction.deferReply();
        try {
            const prompt = options.getString('prompt');
            const result = await aiModelInstance.generateContent(prompt);
            const response = await result.response;
            return interaction.editReply(response.text().substring(0, 2000));
        } catch (e) { return interaction.editReply("AI Error."); }
    }

    if (commandName === 'joinvc') {
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.reply("Join a VC first!");
        joinVoiceChannel({
            channelId: channel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
        });
        return interaction.reply(`Joined ${channel.name}`);
    }

    if (commandName === 'leavevc') {
        const conn = getVoiceConnection(interaction.guild.id);
        if (conn) { conn.destroy(); return interaction.reply("Left VC."); }
        return interaction.reply("Not in a VC.");
    }

    if (commandName === 'clear') {
        const num = options.getInteger('number');
        await interaction.channel.bulkDelete(Math.min(num, 100), true);
        return interaction.reply({ content: `Cleared ${num} messages.`, ephemeral: true });
    }
});

// ================= MESSAGE HANDLER =================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    if (copyEnabled) {
        let shouldMirror = targetUserId ? (message.author.id === targetUserId) : !IGNORED_IDS.includes(message.author.id);
        
        if (shouldMirror && !message.content.startsWith('/')) {
            let text = message.content;
            if (reverseEnabled) text = text.split(' ').map(w => scrambleWord(w)).join(' ');
            if (text.length > 0) await message.channel.send(text);
        }
    }

    // AFK Check
    if (message.mentions.users.some(u => afkStatus.has(u.id))) {
        const user = message.mentions.users.find(u => afkStatus.has(u.id));
        message.reply(`${user.username} is AFK: ${afkStatus.get(user.id)}`);
    }
    if (afkStatus.has(message.author.id)) {
        afkStatus.delete(message.author.id);
        message.reply("Welcome back! AFK removed.").then(m => setTimeout(() => m.delete(), 3000));
    }
});

// ================= VOICE STATE UPDATES (THE FOLLOWER LOGIC) =================
client.on('voiceStateUpdate', (oldState, newState) => {
    // 1. If we have a target and they move...
    if (targetUserId && newState.member.id === targetUserId) {
        
        // Target joined or moved to a new VC
        if (newState.channelId && oldState.channelId !== newState.channelId) {
            joinVoiceChannel({
                channelId: newState.channelId,
                guildId: newState.guild.id,
                adapterCreator: newState.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });
            console.log(`🚀 Following target to: ${newState.channel.name}`);
        } 
        
        // Target left VC entirely
        else if (!newState.channelId) {
            const connection = getVoiceConnection(newState.guild.id);
            if (connection) {
                connection.destroy();
                console.log(`👋 Target left VC, so I left too.`);
            }
        }
    }

    // 2. Greeting logic if someone joins the bot's current room
    if (!oldState.channelId && newState.channelId && !newState.member.user.bot) {
        const connection = getVoiceConnection(newState.guild.id);
        if (connection && connection.joinConfig.channelId === newState.channelId) {
            setTimeout(() => {
                speakInVC(newState.guild.id, `Hey ${newState.member.displayName}, I'm here.`);
            }, 1000);
        }
    }
});

process.on('uncaughtException', (err) => console.error('❌ Exception:', err));
process.on('unhandledRejection', (reason) => console.error('❌ Rejection:', reason));

client.login(process.env.TOKEN);

const PORT = process.env.PORT || 1902;
http.createServer((req, res) => { res.writeHead(200); res.end('Follower Bot Active'); }).listen(PORT);
