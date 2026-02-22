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
        GatewayIntentBits.GuildVoiceStates // REQUIRED for Voice
    ]
});

// ====================== CONFIGURATION ======================
const STORMY_IMAGE_FILE = './stormy.png';
const GUILD_ID = '1369477266958192720';
const TARGET_CHANNEL_ID = '1415134887232540764'; // Image-only channel
const LOG_CHANNEL_ID = '1414286807360602112'; // Moderation Logs
const TRANSCRIPT_CHANNEL_ID = '1414354204079689849';
const SETUP_POST_CHANNEL = '1445628128423579660';
const RP_CATEGORY_ID = '1446530920650899536';
const HELP_MESSAGE = `hello! Do you need help?
Please go to https://discord.com/channels/${GUILD_ID}/1414304297122009099
and for more assistance please use
https://discord.com/channels/${GUILD_ID}/1414352972304879626`;

// ====================== DATA STORAGE ======================
const afkStatus = new Map();
let persistentVoiceChannelId = null; 

// ====================== HELPER FUNCTIONS ======================

// --- VOICE SPEAK FUNCTION ---
function speakInVC(guildId, text) {
    const connection = getVoiceConnection(guildId);
    if (!connection) return false;

    try {
        // Limit text length for TTS stability
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
const BAD_WORDS = [...MILD_BAD_WORDS, ...SEVERE_WORDS];
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

// ================= AI CONFIG =================
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

async function checkMessageToxicity(text) {
    if (!AI_ENABLED) return { isToxic: false, blockCategory: 'AI_DISABLED' };
    if (!text || text.length === 0) return { isToxic: false, blockCategory: 'None' };
    try {
        const response = await aiModelInstance.generateContent({
            contents: [{ role: "user", parts: [{ text: `Analyze for hate speech/harassment (Yes/No): "${text}"` }] }],
            safetySettings: safetySettings,
        });
        
        if (response.response && response.response.candidates && response.response.candidates.length > 0) {
           const candidate = response.response.candidates[0];
           if (candidate.finishReason === 'SAFETY') return { isToxic: true, blockCategory: 'Safety Block' };
        }
        return { isToxic: false, blockCategory: 'None' };
    } catch (error) {
        if (error.toString().includes("SAFETY")) return { isToxic: true, blockCategory: 'Safety Block' };
        console.error('Gemini Moderation API Error:', error);
        return { isToxic: false, blockCategory: 'API_Error' };
    }
}

// ================= BOT EVENTS =================
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    
    client.user.setPresence({ activities: [{ name: 'Big brain. Bigger personality', type: 0 }], status: 'online' });

    // Commands
    const commands = [
        new SlashCommandBuilder().setName('say').setDescription('Say something anonymously').addStringOption(opt => opt.setName('text').setDescription('Text').setRequired(true)),
        new SlashCommandBuilder().setName('sayrp').setDescription('Speak as a character').addStringOption(opt => opt.setName('character').setDescription('Character (Stormy/Hops)').setRequired(true).addChoices({ name: 'Stormy', value: 'stormy' }, { name: 'Hops', value: 'hops' })).addStringOption(opt => opt.setName('message').setDescription('Message').setRequired(true)),
        new SlashCommandBuilder().setName('ask').setDescription('Ask AI (Speaks answer if in VC)').addStringOption(opt => opt.setName('prompt').setDescription('Question').setRequired(true)),
        new SlashCommandBuilder().setName('help').setDescription('Get help'),
        new SlashCommandBuilder().setName('serverinfo').setDescription('Server info'),
        new SlashCommandBuilder().setName('clear').setDescription('Clear messages').addIntegerOption(opt => opt.setName('number').setDescription('Number').setRequired(true)),
        new SlashCommandBuilder().setName('kick').setDescription('Kick member (Server)').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)),
        new SlashCommandBuilder().setName('ban').setDescription('Ban member (Server)').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)),
        new SlashCommandBuilder().setName('timeout').setDescription('Timeout member').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addIntegerOption(opt => opt.setName('minutes').setDescription('Minutes').setRequired(true)),
        new SlashCommandBuilder().setName('setup').setDescription('Post ticket panel'),
        // --- VOICE COMMANDS ---
        new SlashCommandBuilder().setName('joinvc').setDescription('Join a Voice Channel').addChannelOption(opt => opt.setName('channel').setDescription('Voice Channel').addChannelTypes(ChannelType.GuildVoice).setRequired(false)),
        new SlashCommandBuilder().setName('leavevc').setDescription('Leave the Voice Channel'),
        new SlashCommandBuilder().setName('speak').setDescription('Make bot speak in VC').addStringOption(opt => opt.setName('text').setDescription('What to say').setRequired(true)),
        // --- VOICE MODERATION ---
        new SlashCommandBuilder().setName('vckick').setDescription('Disconnect a user from VC').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)),
        new SlashCommandBuilder().setName('vcmute').setDescription('Mute a user in VC').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)),
        new SlashCommandBuilder().setName('vcunmute').setDescription('Unmute a user in VC').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        console.log('⚡ Registering commands...');
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
        console.log('✅ Slash commands registered.');
    } catch (err) {
        console.error('Failed to register commands:', err);
    }
});

// ================= INTERACTION HANDLER =================
client.on('interactionCreate', async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const isMod = interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers);
        
        // Mod Command Guard
        const modCommands = ['kick', 'ban', 'timeout', 'setup', 'clear', 'joinvc', 'leavevc', 'speak', 'vckick', 'vcmute', 'vcunmute'];
        if (modCommands.includes(interaction.commandName) && !isMod) {
            return interaction.reply({ content: '❌ Mods only', ephemeral: true });
        }

        if (interaction.commandName === 'say') {
            const text = interaction.options.getString('text');
            await interaction.channel.send(text);
            return interaction.reply({ content: "Sent", ephemeral: true });
        }

        if (interaction.commandName === 'ask') {
            await interaction.deferReply();
            if (!AI_ENABLED) return interaction.editReply('AI is disabled.');
            
            const prompt = interaction.options.getString('prompt');
            
            try {
                // Determine if we should speak the answer (if bot is in VC)
                const connection = getVoiceConnection(interaction.guild.id);
                
                // Instruct AI to be concise if speaking
                let sysInstr = `You are Hops Bunny.`;
                if (connection) sysInstr += ` You are speaking in a Voice Channel. Keep your answer under 2 sentences.`;

                const result = await aiModelInstance.generateContent({
                    contents: [{ role: "user", parts: [{ text: `System: ${sysInstr}\nUser: ${prompt}` }] }],
                    safetySettings: safetySettings
                });
                
                const responseText = result.response.text();
                
                // Speak if in VC
                if (connection) {
                    speakInVC(interaction.guild.id, responseText);
                    await interaction.editReply(`🗣️ **Spoke:** ${responseText}`);
                } else {
                    await interaction.editReply(`🐰 **Hopper:** ${responseText.slice(0, 1900)}`);
                }

            } catch (error) {
                console.error(error);
                await interaction.editReply(`Error fetching AI response.`);
            }
            return;
        }

        // --- VC MODERATION COMMANDS ---
        if (interaction.commandName === 'vckick') {
            const user = interaction.options.getUser('user');
            const member = interaction.guild.members.cache.get(user.id);
            if (member.voice.channel) {
                await member.voice.disconnect();
                return interaction.reply(`👋 Disconnected ${user.tag} from VC.`);
            }
            return interaction.reply({ content: "User is not in a VC.", ephemeral: true });
        }

        if (interaction.commandName === 'vcmute') {
            const user = interaction.options.getUser('user');
            const member = interaction.guild.members.cache.get(user.id);
            if (member.voice.channel) {
                await member.voice.setMute(true, "Mod Command");
                return interaction.reply(`😶 Muted ${user.tag} in VC.`);
            }
            return interaction.reply({ content: "User is not in a VC.", ephemeral: true });
        }

        if (interaction.commandName === 'vcunmute') {
            const user = interaction.options.getUser('user');
            const member = interaction.guild.members.cache.get(user.id);
            if (member.voice.channel) {
                await member.voice.setMute(false, "Mod Command");
                return interaction.reply(`🎤 Unmuted ${user.tag} in VC.`);
            }
            return interaction.reply({ content: "User is not in a VC.", ephemeral: true });
        }

        // --- GENERAL COMMANDS ---
        if (interaction.commandName === 'joinvc') {
            const channel = interaction.options.getChannel('channel') || interaction.member.voice.channel;
            if (!channel) return interaction.reply({ content: "Specify a channel or join one.", ephemeral: true });
            
            persistentVoiceChannelId = channel.id;
            joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false
            });
            return interaction.reply(`Joined ${channel.name}`);
        }

        if (interaction.commandName === 'speak') {
            const text = interaction.options.getString('text');
            const spoken = speakInVC(interaction.guild.id, text);
            if(spoken) return interaction.reply({ content: `🗣️ Speaking...`, ephemeral: true });
            return interaction.reply({ content: "❌ Not in VC or Error.", ephemeral: true });
        }

        if (interaction.commandName === 'leavevc') {
            const connection = getVoiceConnection(interaction.guild.id);
            if (connection) {
                persistentVoiceChannelId = null;
                connection.destroy();
                return interaction.reply("Left VC.");
            }
            return interaction.reply("Not in VC.");
        }
        
        // ... (Keep other simple commands like kick, ban, clear, setup) ...
        if (interaction.commandName === 'kick') {
            const user = interaction.options.getUser('user');
            const member = interaction.guild.members.cache.get(user.id);
            if (member && member.kickable) { await member.kick(); return interaction.reply(`Kicked ${user.tag}`); }
            return interaction.reply("Failed to kick.");
        }
    }
});

// ================= MESSAGE HANDLER (Filters & Threads) =================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // Image Only Channel
    if (message.channel.id === TARGET_CHANNEL_ID) {
        if (message.attachments.size === 0) {
            await message.delete().catch(() => {});
            return;
        }
        await message.react('✨');
        await message.startThread({ name: `${message.author.username}'s Post`, autoArchiveDuration: 60 });
    }

    // Manual Filter
    const manualFilter = filterMessageManually(message.content);
    if (manualFilter.isSevere || manualFilter.isMild) {
        await message.delete().catch(() => {});
        const log = client.channels.cache.get(LOG_CHANNEL_ID);
        if (log) log.send(`⚠️ Filter Triggered by ${message.author.tag}: ||${manualFilter.matchedWord}||`);
    }

    // AFK Logic
    if (afkStatus.has(message.author.id)) {
        afkStatus.delete(message.author.id);
        message.reply(`Welcome back ${message.author}! Removed AFK.`);
    }
    if (message.mentions.users.size > 0) {
        message.mentions.users.forEach(u => {
            if (afkStatus.has(u.id)) message.reply(`${u.username} is AFK: ${afkStatus.get(u.id).reason}`);
        });
    }
    if (message.content.startsWith('?afk')) {
        afkStatus.set(message.author.id, { reason: message.content.slice(4).trim() || 'AFK', timestamp: Date.now() });
        message.reply("AFK set.");
    }
});

// ================= VOICE STATE (GREETING & REJOIN) =================
client.on('voiceStateUpdate', async (oldState, newState) => {
    // 1. Auto-Rejoin Logic
    if (oldState.member.id === client.user.id && oldState.channelId && !newState.channelId) {
        if (persistentVoiceChannelId) {
            setTimeout(() => {
                const guild = client.guilds.cache.get(GUILD_ID);
                if (guild) {
                    try {
                        joinVoiceChannel({
                            channelId: persistentVoiceChannelId,
                            guildId: guild.id,
                            adapterCreator: guild.voiceAdapterCreator,
                            selfDeaf: false,
                            selfMute: false
                        });
                    } catch (e) { console.error("Rejoin failed", e); }
                }
            }, 2000);
        }
    }

    // 2. Greeting Logic (React to Hellos/Entry)
    // Check if a REAL user (not bot) joined a channel
    if (!oldState.channelId && newState.channelId && !newState.member.user.bot) {
        const connection = getVoiceConnection(newState.guild.id);
        
        // If the bot is currently in the channel the user just joined
        if (connection && connection.joinConfig.channelId === newState.channelId) {
            // Wait 1.5 seconds for them to fully connect
            setTimeout(() => {
                speakInVC(newState.guild.id, `Hello ${newState.member.displayName}, welcome to the voice chat!`);
            }, 1500);
        }
    }
});

// ================= ERROR HANDLING =================
process.on('uncaughtException', (err) => console.error('❌ Exception:', err));
process.on('unhandledRejection', (reason) => console.error('❌ Rejection:', reason));

client.login(process.env.TOKEN);

// === PORT ===
const PORT = process.env.PORT || 1902;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot Running');
}).listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

