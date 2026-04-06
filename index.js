const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionsBitField
} = require('discord.js');

const { 
    joinVoiceChannel, 
    getVoiceConnection, 
    createAudioPlayer,
    createAudioResource 
} = require('@discordjs/voice');

const discordTTS = require('discord-tts'); 
const http = require('http');
const { GoogleGenerativeAI } = require('@google/generative-ai');

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
const IGNORED_IDS = ['888238712780128288', '1360737030895833360'];

// ====================== DATA STORAGE ======================
const afkStatus = new Map();
let copyEnabled = true;    
let reverseEnabled = false; 
let selfCopyEnabled = true; 
let targetUserId = null; // Stores the specific user being followed
let persistentVoiceChannelId = null;

// ====================== AI SETUP ======================
let aiModelInstance;
let AI_ENABLED = !!process.env.GEMINI_API_KEY;
if (AI_ENABLED) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    aiModelInstance = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

// ====================== HELPER FUNCTIONS ======================

function scrambleWord(word) {
    if (word.length <= 2) return word;
    const chars = word.split('');
    for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }
    return chars.join('');
}

function speakInVC(guildId, text) {
    const connection = getVoiceConnection(guildId);
    if (!connection) return false;
    try {
        const stream = discordTTS.getVoiceStream(text.substring(0, 200));
        const resource = createAudioResource(stream, { inlineVolume: true });
        const player = createAudioPlayer();
        player.play(resource);
        connection.subscribe(player);
        return true;
    } catch (e) { return false; }
}

// ================= BOT EVENTS =================
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    client.user.setPresence({ activities: [{ name: 'looi', type: 3 }] });

    const commands = [
        new SlashCommandBuilder().setName('target').setDescription('Lock on and follow a specific user').addUserOption(opt => opt.setName('user').setDescription('The user to follow').setRequired(true)),
        new SlashCommandBuilder().setName('untarget').setDescription('Stop following a specific user'),
        new SlashCommandBuilder().setName('copytoggle').setDescription('Toggle global mirroring'),
        new SlashCommandBuilder().setName('selfcopytoggle').setDescription('Toggle self-mirroring'),
        new SlashCommandBuilder().setName('reversetoggle').setDescription('Toggle scramble mode'),
        new SlashCommandBuilder().setName('say').setDescription('Send a message as the bot').addStringOption(opt => opt.setName('text').setDescription('Text').setRequired(true)),
        new SlashCommandBuilder().setName('ask').setDescription('Ask AI').addStringOption(opt => opt.setName('prompt').setDescription('Prompt').setRequired(true)),
        new SlashCommandBuilder().setName('afk').setDescription('Set AFK status').addStringOption(opt => opt.setName('reason').setDescription('Reason')),
        new SlashCommandBuilder().setName('joinvc').setDescription('Join VC'),
        new SlashCommandBuilder().setName('leavevc').setDescription('Leave VC'),
        new SlashCommandBuilder().setName('clear').setDescription('Delete messages').addIntegerOption(opt => opt.setName('num').setDescription('Amount').setRequired(true))
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    } catch (err) { console.error(err); }
});

// ================= INTERACTION HANDLER =================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName, options } = interaction;

    if (commandName === 'target') {
        const user = options.getUser('user');
        targetUserId = user.id;
        return interaction.reply(`🎯 Now following **${user.username}** everywhere.`);
    }
    if (commandName === 'untarget') {
        targetUserId = null;
        return interaction.reply(`🔓 Stopped following.`);
    }
    if (commandName === 'copytoggle') {
        copyEnabled = !copyEnabled;
        return interaction.reply(`Global Copy: **${copyEnabled}**`);
    }
    if (commandName === 'selfcopytoggle') {
        selfCopyEnabled = !selfCopyEnabled;
        return interaction.reply(`Self Mirror: **${selfCopyEnabled}**`);
    }
    if (commandName === 'reversetoggle') {
        reverseEnabled = !reverseEnabled;
        return interaction.reply(`Scramble: **${reverseEnabled}**`);
    }
    if (commandName === 'say') {
        const text = options.getString('text');
        await interaction.channel.send(text);
        return interaction.reply({ content: 'Sent!', ephemeral: true });
    }
    if (commandName === 'ask') {
        if (!AI_ENABLED) return interaction.reply("AI Disabled.");
        await interaction.deferReply();
        const result = await aiModelInstance.generateContent(options.getString('prompt'));
        return interaction.editReply(result.response.text().substring(0, 2000));
    }
    if (commandName === 'joinvc') {
        const channel = interaction.member.voice.channel;
        if (!channel) return interaction.reply("Join a VC!");
        joinVoiceChannel({ channelId: channel.id, guildId: interaction.guild.id, adapterCreator: interaction.guild.voiceAdapterCreator });
        return interaction.reply(`Joined ${channel.name}`);
    }
    if (commandName === 'leavevc') {
        getVoiceConnection(interaction.guild.id)?.destroy();
        return interaction.reply("Left VC.");
    }
});

// ================= MESSAGE HANDLER =================
client.on('messageCreate', async (message) => {
    if (message.author.bot && !selfCopyEnabled) return; 
    if (!message.guild || message.content.startsWith('/')) return;

    // --- MIRRORING LOGIC ---
    if (copyEnabled) {
        let shouldMirror = false;
        
        if (targetUserId) {
            if (message.author.id === targetUserId) shouldMirror = true;
        } else {
            if (!IGNORED_IDS.includes(message.author.id) || (selfCopyEnabled && IGNORED_IDS.includes(message.author.id))) {
                shouldMirror = true;
            }
        }

        if (shouldMirror && message.content.length > 0) {
            let text = message.content;
            if (reverseEnabled) text = text.split(' ').map(w => scrambleWord(w)).join(' ');
            await message.channel.send(text);
        }
    }

    // --- AFK LOGIC ---
    if (afkStatus.has(message.author.id)) {
        afkStatus.delete(message.author.id);
        message.reply("Welcome back! AFK removed.").then(m => setTimeout(() => m.delete(), 3000));
    }
});

// ================= VOICE STATE UPDATES (VC FOLLOW) =================
client.on('voiceStateUpdate', (oldState, newState) => {
    // If target exists and they move VCs
    if (targetUserId && newState.member.id === targetUserId) {
        if (newState.channelId && oldState.channelId !== newState.channelId) {
            joinVoiceChannel({
                channelId: newState.channelId,
                guildId: newState.guild.id,
                adapterCreator: newState.guild.voiceAdapterCreator
            });
        } else if (!newState.channelId) {
            getVoiceConnection(newState.guild.id)?.destroy();
        }
    }

    // Auto-Greeting
    if (!oldState.channelId && newState.channelId && !newState.member.user.bot) {
        const conn = getVoiceConnection(newState.guild.id);
        if (conn && conn.joinConfig.channelId === newState.channelId) {
            setTimeout(() => speakInVC(newState.guild.id, `Hello ${newState.member.displayName}`), 1000);
        }
    }
});

client.login(process.env.TOKEN);

// Keep-alive server
const PORT = process.env.PORT || 1902;
http.createServer((req, res) => { res.writeHead(200); res.end('Bot Online'); }).listen(PORT);
