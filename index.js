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

    // Set Presence Logic
    client.user.setPresence({ 
        activities: [{ name: 'hopping around Toon Springs', type: 0 }], 
        status: 'online' 
    });

    const commands = [
        new SlashCommandBuilder().setName('copytoggle').setDescription('Turn automatic message copying ON or OFF'),
        new SlashCommandBuilder().setName('reversetoggle').setDescription('Turn reverse mode ON or OFF'),
        new SlashCommandBuilder().setName('afk').setDescription('Set an AFK status').addStringOption(opt => opt.setName('reason').setDescription('Why are you away?')),
        new SlashCommandBuilder().setName('say').setDescription('Say something anonymously').addStringOption(opt => opt.setName('text').setDescription('Text').setRequired(true)),
        new SlashCommandBuilder().setName('ask').setDescription('Ask AI').addStringOption(opt => opt.setName('prompt').setDescription('Question').setRequired(true)),
        new SlashCommandBuilder().setName('joinvc').setDescription('Join VC'),
        new SlashCommandBuilder().setName('leavevc').setDescription('Leave VC'),
        new SlashCommandBuilder().setName('clear').setDescription('Clear messages').addIntegerOption(opt => opt.setName('number').setDescription('Number').setRequired(true))
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
        console.log('✅ Slash commands and Presence registered.');
    } catch (err) { console.error(err); }
});

// ================= INTERACTION HANDLER =================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'copytoggle') {
        copyEnabled = !copyEnabled;
        return interaction.reply({ content: `Quick Tap copying is now **${copyEnabled ? 'ENABLED 🔛' : 'DISABLED 📴'}**.` });
    }

    if (commandName === 'reversetoggle') {
        reverseEnabled = !reverseEnabled;
        return interaction.reply({ content: `Reverse mode is now **${reverseEnabled ? 'ENABLED 🔄' : 'DISABLED ⏹️'}**.` });
    }

    if (commandName === 'afk') {
        const reason = options.getString('reason') || 'No reason provided';
        afkStatus.set(interaction.user.id, reason);
        return interaction.reply({ content: `You are now AFK: **${reason}**` });
    }

    if (commandName === 'say') {
        const text = options.getString('text');
        await interaction.channel.send(text);
        return interaction.reply({ content: "Sent", ephemeral: true });
    }

    if (commandName === 'ask') {
        if (!AI_ENABLED) return interaction.reply("AI is currently disabled.");
        await interaction.deferReply();
        try {
            const prompt = options.getString('prompt');
            const result = await aiModelInstance.generateContent(prompt);
            const response = await result.response;
            return interaction.editReply(response.text().substring(0, 2000));
        } catch (e) {
            return interaction.editReply("AI Error: Could not generate response.");
        }
    }

    if (commandName === 'joinvc') {
        const member = interaction.member;
        if (!member.voice.channel) return interaction.reply("Join a VC first!");
        
        joinVoiceChannel({
            channelId: member.voice.channel.id,
            guildId: interaction.guild.id,
            adapterCreator: interaction.guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: false
        });
        persistentVoiceChannelId = member.voice.channel.id;
        return interaction.reply(`Joined ${member.voice.channel.name}`);
    }

    if (commandName === 'leavevc') {
        const connection = getVoiceConnection(interaction.guild.id);
        if (connection) {
            connection.destroy();
            persistentVoiceChannelId = null;
            return interaction.reply("Left the voice channel.");
        }
        return interaction.reply("I am not in a voice channel.");
    }

    if (commandName === 'clear') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
            return interaction.reply({ content: "You need Manage Messages permission.", ephemeral: true });
        }
        const num = options.getInteger('number');
        const deleted = await interaction.channel.bulkDelete(Math.min(num, 100), true);
        return interaction.reply({ content: `Cleared ${deleted.size} messages.`, ephemeral: true });
    }
});

// ================= MESSAGE HANDLER =================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // --- QUICK TAP / AUTOMATIC GLOBAL COPY ---
    if (copyEnabled) {
        if (!IGNORED_IDS.includes(message.author.id) && !message.content.startsWith('/')) {
            if (message.content.length > 0) {
                let textToSend = message.content;

                // Quick Tap Reversal logic
                if (reverseEnabled) {
                    textToSend = textToSend.split('').reverse().join('');
                }

                await message.channel.send(textToSend);
            }
        }
    }

    // --- AFK MENTION LOGIC ---
    message.mentions.users.forEach((user) => {
        if (afkStatus.has(user.id)) {
            message.reply(`${user.username} is currently AFK: ${afkStatus.get(user.id)}`);
        }
    });

    if (afkStatus.has(message.author.id)) {
        afkStatus.delete(message.author.id);
        message.reply(`Welcome back ${message.author}! Quick Tap has restored your status.`).then(m => setTimeout(() => m.delete(), 5000));
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
});

// ================= VOICE STATE UPDATES =================
client.on('voiceStateUpdate', (oldState, newState) => {
    // 1. Auto-Rejoin Logic
    if (oldState.member.id === client.user.id && !newState.channelId) {
        if (persistentVoiceChannelId) {
            setTimeout(() => {
                const guild = client.guilds.cache.get(GUILD_ID);
                if (guild) {
                    joinVoiceChannel({
                        channelId: persistentVoiceChannelId,
                        guildId: guild.id,
                        adapterCreator: guild.voiceAdapterCreator,
                        selfDeaf: false,
                        selfMute: false
                    });
                }
            }, 2000);
        }
    }

    // 2. Greeting Logic
    if (!oldState.channelId && newState.channelId && !newState.member.user.bot) {
        const connection = getVoiceConnection(newState.guild.id);
        if (connection && connection.joinConfig.channelId === newState.channelId) {
            setTimeout(() => {
                speakInVC(newState.guild.id, `Hello ${newState.member.displayName}, welcome to the voice chat!`);
            }, 1500);
        }
    }
});

process.on('uncaughtException', (err) => console.error('❌ Exception:', err));
process.on('unhandledRejection', (reason) => console.error('❌ Rejection:', reason));

client.login(process.env.TOKEN);

const PORT = process.env.PORT || 1902;
http.createServer((req, res) => { res.writeHead(200); res.end('Bot Running'); }).listen(PORT);
