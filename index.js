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
    EmbedBuilder
} = require('discord.js');
// --- ADDED VOICE IMPORT ---
const { joinVoiceChannel } = require('@discordjs/voice');
const http = require('http');
const fs = require('fs');

// --- AI Import ---
const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai');

// Check for the mandatory token environment variable
if (!process.env.TOKEN) {
    console.error("❌ TOKEN not found. Add TOKEN in Environment Variables.");
    process.exit(1);
}

// --- AI Key Check ---
let ai;
let AI_ENABLED = !!process.env.GEMINI_API_KEY;

if (!AI_ENABLED) {
    console.error("❌ GEMINI_API_KEY not found. AI commands (/ask) and AI moderation are DISABLED.");
} else {
    try {
        ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } catch (e) {
        console.error("❌ Failed to initialize GoogleGenAI.", e);
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
        GatewayIntentBits.GuildMessageReactions,
        // --- ADDED VOICE STATE INTENT (REQUIRED FOR VC) ---
        GatewayIntentBits.GuildVoiceStates 
    ]
});

// ====================== CONFIGURATION ======================

// ** LOCAL IMAGE CONFIG **
const STORMY_IMAGE_FILE = './stormy.png';
const RANK_CARD_BACKGROUND_URL = 'https://i.imgur.com/r62Y0c7.png';
const STORMY_AVATAR_URL = 'https://i.imgur.com/r62Y0c7.png';

// --- DISCORD IDs ---
const GUILD_ID = '1369477266958192720';
const TARGET_CHANNEL_ID = '1415134887232540764'; // Image-only channel
const LOG_CHANNEL_ID = '1414286807360602112'; // Moderation Logs
const TRANSCRIPT_CHANNEL_ID = '1414354204079689849';
const SETUP_POST_CHANNEL = '1445628128423579660';
const RP_CHANNEL_ID = '1421219064985948346';
const RP_CATEGORY_ID = '1446530920650899536';
const AFK_XP_EXCLUSION_CHANNEL_ID = '1414352027034583080';
const BOOSTER_ROLE_ID = '1400596498969923685';

// --- LEVELING/XP CONFIGURATION ---
const XP_COOLDOWN_MS = 60 * 1000;
const DAILY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const XP_GAIN = 15;

const LEVEL_ROLES = {
    5: '1418567907662630964',
    10: '1418568030132244611',
    15: '1418568206662238269',
    20: '1418568333229559978',
    30: '1418568692819824741',
    50: '1418568903411372063',
    100: '1441563487565250692',
};

const NICKNAME_SCAN_INTERVAL = 5 * 1000;
const HELP_MESSAGE = `hello! Do you need help?
Please go to https://discord.com/channels/${GUILD_ID}/1414304297122009099
and for more assistance please use
https://discord.com/channels/${GUILD_ID}/1414352972304879626`;

// ====================== DATA STORAGE ======================
const userLevels = {};
const xpCooldown = new Map();
const dailyCooldown = new Map();
const joinTracker = new Map();
const afkStatus = new Map();

// ====================== HELPER FUNCTIONS ======================

function calculateLevel(totalXp) {
    let level = 0;
    let xpRemaining = totalXp;
    let xpNeeded = 100;
    while (xpRemaining >= xpNeeded) {
        xpRemaining -= xpNeeded;
        level++;
        xpNeeded = 5 * level * level + 50 * level + 100;
    }
    return { level, xpForNext: xpNeeded, xpNeeded: xpRemaining };
}

async function handleLevelRoles(member, newLevel) {
    if (!member || !member.guild) return;
    const guild = member.guild;
    const levelKeys = Object.keys(LEVEL_ROLES).map(Number).sort((a, b) => b - a);
    try {
        let roleToAddId = null;
        for (const levelThreshold of levelKeys) {
            if (newLevel >= levelThreshold) {
                roleToAddId = LEVEL_ROLES[levelThreshold];
                break;
            }
        }
        for (const levelThreshold of levelKeys) {
            const roleId = LEVEL_ROLES[levelThreshold];
            const role = guild.roles.cache.get(roleId);
            if (!role) continue;
            if (roleId === roleToAddId) {
                if (!member.roles.cache.has(roleId)) await member.roles.add(role);
            } else {
                if (member.roles.cache.has(roleId) && newLevel > levelThreshold) await member.roles.remove(role);
            }
        }
    } catch (e) {
        console.error('Failed to handle level up roles:', e);
    }
}

async function addXP(member, xpAmount, message = null) {
    if (!member) return;
    const userId = member.id;
    if (!userLevels[userId]) userLevels[userId] = { xp: 0, level: 0 };
    const oldLevel = userLevels[userId].level;
    userLevels[userId].xp += xpAmount;
    const { level } = calculateLevel(userLevels[userId].xp);
    userLevels[userId].level = level;
    if (level > oldLevel) {
        if (message && message.channel) {
            message.channel.send(`${member.toString()} wow toon! You are now level **${level}**!`);
        }
        await handleLevelRoles(member, level);
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
// UPDATED: Changed to BLOCK_MEDIUM_AND_ABOVE to fix the "There's a lot of things we can talk about" error
const safetySettings = [
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];
const aiModel = 'gemini-2.5-flash';

async function checkMessageToxicity(text) {
    if (!AI_ENABLED) return { isToxic: false, blockCategory: 'AI_DISABLED' };
    if (!text || text.length === 0) return { isToxic: false, blockCategory: 'None' };
    try {
        const response = await ai.models.generateContent({
            model: aiModel,
            contents: [{ role: "user", parts: [{ text: `Analyze the following user message for hate speech, slurs, harassment: "${text}"` }] }],
            safetySettings: safetySettings,
        });
        if (response.candidates && response.candidates.length > 0) {
            const candidate = response.candidates[0];
            if (candidate.finishReason === 'SAFETY') return { isToxic: true, blockCategory: 'Safety Block' };
        }
        return { isToxic: false, blockCategory: 'None' };
    } catch (error) {
        console.error('Gemini Moderation API Error:', error);
        return { isToxic: false, blockCategory: 'API_Error' };
    }
}

async function moderateNickname(member) {
    let displayName = member.displayName.toLowerCase();
    let normalized = displayName.replace(/[^a-z0-9]/g, '');
    let leetNormalized = normalized.split('').map(char => LEET_MAP[char] || char).join('');
    const isBad = BAD_WORDS.some(badWord => normalized.includes(badWord) || leetNormalized.includes(badWord));
    if (isBad) {
        try {
            if (member.manageable) {
                await member.setNickname("[moderated nickname]");
                const log = member.guild.channels.cache.get(LOG_CHANNEL_ID);
                if (log) log.send(`<:thinking_preston:1448751103822004437> **Nickname Moderated**\nUser: <@${member.id}>\nOld Name: ||${member.user.username}||`);
                return true;
            }
        } catch (err) {
            console.error(`Failed to moderate nickname for ${member.user.tag}:`, err);
        }
    }
    return false;
}

function startAutomatedNicknameScan(guild) {
    const runScan = async () => {
        if (!guild) return;
        try {
            const members = await guild.members.fetch();
            for (const [id, member] of members) {
                if (member.user.bot) continue;
                await moderateNickname(member);
            }
        } catch (error) {
            console.error('Automated Nickname Scan failed:', error);
        }
    };
    runScan();
    setInterval(runScan, NICKNAME_SCAN_INTERVAL);
}

// ================= BOT EVENTS =================

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    client.guilds.cache.forEach(async (guild) => {
        if (guild.id !== GUILD_ID) {
            console.log(`❌ Found unauthorized server: ${guild.name}. Leaving...`);
            await guild.leave().catch(e => console.error(e));
        }
    });
    client.user.setPresence({ activities: [{ name: 'hopping around Toon Springs', type: 0 }], status: 'online' });
    const guild = client.guilds.cache.get(GUILD_ID);
    if (guild) startAutomatedNicknameScan(guild);

    // Commands
    const commands = [
        new SlashCommandBuilder().setName('say').setDescription('Say something anonymously').addStringOption(opt => opt.setName('text').setDescription('Text').setRequired(true)),
        new SlashCommandBuilder().setName('sayrp').setDescription('Speak as a character').addStringOption(opt => opt.setName('character').setDescription('Character (Stormy/Hops)').setRequired(true).addChoices({ name: 'Stormy', value: 'stormy' }, { name: 'Hops', value: 'hops' })).addStringOption(opt => opt.setName('message').setDescription('Message').setRequired(true)),
        new SlashCommandBuilder().setName('ask').setDescription('Search about stormy and hops').addStringOption(opt => opt.setName('prompt').setDescription('Question').setRequired(true)),
        new SlashCommandBuilder().setName('help').setDescription('Get help'),
        new SlashCommandBuilder().setName('serverinfo').setDescription('Server info'),
        new SlashCommandBuilder().setName('clear').setDescription('Clear messages').addIntegerOption(opt => opt.setName('number').setDescription('Number').setRequired(true)),
        new SlashCommandBuilder().setName('addrole').setDescription('Add a role to a user').addUserOption(opt => opt.setName('user').setDescription('The user').setRequired(true)).addRoleOption(opt => opt.setName('role').setDescription('The role').setRequired(true)),
        new SlashCommandBuilder().setName('userinfo').setDescription('User info').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(false)),
        new SlashCommandBuilder().setName('daily').setDescription('Claim daily XP'),
        new SlashCommandBuilder().setName('leaderboard').setDescription('Show top members'),
        new SlashCommandBuilder().setName('rank').setDescription('Show rank card').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(false)),
        new SlashCommandBuilder().setName('givexp').setDescription('Give XP').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addIntegerOption(opt => opt.setName('xp').setDescription('XP').setRequired(true)),
        new SlashCommandBuilder().setName('takeawayxp').setDescription('Take XP').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addIntegerOption(opt => opt.setName('xp').setDescription('XP').setRequired(true)),
        new SlashCommandBuilder().setName('changelevel').setDescription('Set level').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addIntegerOption(opt => opt.setName('level').setDescription('Level').setRequired(true)),
        new SlashCommandBuilder().setName('kick').setDescription('Kick member').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)),
        new SlashCommandBuilder().setName('ban').setDescription('Ban member').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)),
        new SlashCommandBuilder().setName('unban').setDescription('Unban member').addStringOption(opt => opt.setName('userid').setDescription('User ID').setRequired(true)),
        new SlashCommandBuilder().setName('timeout').setDescription('Timeout member').addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true)).addIntegerOption(opt => opt.setName('minutes').setDescription('Minutes').setRequired(true)),
        new SlashCommandBuilder().setName('setup').setDescription('Post ticket panel'),
        // --- ADDED JOINVC COMMAND ---
        new SlashCommandBuilder().setName('joinvc').setDescription('Join your current voice channel'),
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
    // --- SLASH COMMANDS ---
    if (interaction.isChatInputCommand()) {
        const isMod = interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers);
        const modCommands = ['kick', 'ban', 'unban', 'timeout', 'setup', 'givexp', 'takeawayxp', 'changelevel', 'clear', 'addrole'];
        if (modCommands.includes(interaction.commandName) && !isMod) return interaction.reply({ content: '❌ Mods only', ephemeral: true });

        // --- NEW JOIN VC LOGIC ---
        if (interaction.commandName === 'joinvc') {
            const voiceChannel = interaction.member.voice.channel;
            
            if (!voiceChannel) {
                return interaction.reply({ content: "❌ You need to be in a voice channel first so I know where to go!", ephemeral: true });
            }

            try {
                joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: interaction.guild.id,
                    adapterCreator: interaction.guild.voiceAdapterCreator,
                    selfDeaf: true,
                });
                return interaction.reply({ content: `🔊 Joined **${voiceChannel.name}**!`, ephemeral: true });
            } catch (error) {
                console.error("Failed to join VC:", error);
                return interaction.reply({ content: "❌ I couldn't join that channel. Check my permissions!", ephemeral: true });
            }
        }

        if (interaction.commandName === 'say') {
            const text = interaction.options.getString('text');
            if (AI_ENABLED) {
                const { isToxic } = await checkMessageToxicity(text);
                if (isToxic) return interaction.reply({ content: "<:scaredcloudy:1448751027950977117> Blocked by filter.", ephemeral: true });
            }
            await interaction.channel.send(text);
            return interaction.reply({ content: "<:cheeringstormy:1448751467400790206> Sent", ephemeral: true });
        }

        if (interaction.commandName === 'sayrp') {
            const char = interaction.options.getString('character');
            const msg = interaction.options.getString('message');
            if (AI_ENABLED) {
                const { isToxic } = await checkMessageToxicity(msg);
                if (isToxic) return interaction.reply({ content: "<:scaredcloudy:1448751027950977117> Message blocked by filter.", ephemeral: true });
            }
            let payload = { content: '', files: [] };
            if (char === 'stormy') {
                payload.content = `**Stormy Bunny:** ${msg}`;
                if (fs.existsSync(STORMY_IMAGE_FILE)) {
                    payload.files = [new AttachmentBuilder(STORMY_IMAGE_FILE, { name: 'stormy.png' })];
                }
            } else {
                payload.content = `**Hops (Bot):** ${msg}`;
            }
            await interaction.channel.send(payload);
            return interaction.reply({ content: `<:cheeringstormy:1448751467400790206> Sent as ${char}`, ephemeral: true });
        }

        if (interaction.commandName === 'ask') {
            await interaction.deferReply();
            if (!AI_ENABLED) return interaction.editReply('<:scaredcloudy:1448751027950977117> AI is disabled (Missing Key).');
            const prompt = interaction.options.getString('prompt');
            const manualFilter = filterMessageManually(prompt);
            if (manualFilter.isSevere || manualFilter.isMild) return interaction.editReply('<:scaredcloudy:1448751027950977117> Filtered.');
            const { isToxic } = await checkMessageToxicity(prompt);
            if (isToxic) return interaction.editReply('<:scaredcloudy:1448751027950977117> Filtered by AI.');
            try {
                const systemInstruction = `You are Hops Bunny, an assistant for 'Stormy and Hops'. Use Google Search. Only use sources: stormy-and-hops.fandom.com, stormyandhops.netlify.app, X.com/stormyandhops, YouTube.com/stormyandhops. 
                
                Use these emojis depending on what they are searching for for Stormy and hops:
                <:MrLuck:1448751843885842623> <:cheeringstormy:1448751467400790206> <:concerdnedjin:1448751740030816481> <:happymissdiamond:1448752668259647619> <:madscarlet:1448751667863355482> <:heartkatie:1448751305756639372> <:mischevousoscar:1448752833951305789> <:questioninghops:1448751559067308053> <:ragingpaul:1448752763164037295> <:thinking_preston:1448751103822004437> <:scaredcloudy:1448751027950977117> <:tiredscout:1448751394881278043> <:Stormyandhopslogo:1448502746113118291> <:1_plus_1_equals_2:1372781129861435413> <:Evil_paul:1428932282818760785>`;
                
                const result = await ai.models.generateContent({
                    model: aiModel,
                    contents: [{ role: "user", parts: [{ text: prompt }] }],
                    safetySettings: safetySettings,
                    config: { systemInstruction, tools: [{ googleSearch: {} }] }
                });
                await interaction.editReply(`🐰 **Hopper response:**\n\n${result.text.slice(0, 1900)}`);
            } catch (error) {
                console.error(error);
                const futureTime = new Date(Date.now() + 5 * 60000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                await interaction.editReply(`<:scaredcloudy:1448751027950977117> uhoh I am unable to get information right now please wait until ${futureTime} <:happymissdiamond:1448752668259647619>`);
            }
            return;
        }

        if (interaction.commandName === 'help') return interaction.reply({ content: HELP_MESSAGE, ephemeral: true });
        if (interaction.commandName === 'serverinfo') return interaction.reply({ content: `**Server:** ${interaction.guild.name}\n**Members:** ${interaction.guild.memberCount}`, ephemeral: true });
        if (interaction.commandName === 'userinfo') {
            const user = interaction.options.getUser('user') || interaction.user;
            const member = interaction.guild.members.cache.get(user.id);
            return interaction.reply({ content: `User: ${user.tag}\nJoined: ${member ? member.joinedAt.toDateString() : 'Unknown'}`, ephemeral: true });
        }

        if (interaction.commandName === 'clear') {
            const amount = interaction.options.getInteger('number');
            if (amount < 1 || amount > 100) return interaction.reply({ content: '1-100 only', ephemeral: true });
            await interaction.channel.bulkDelete(amount, true);
            return interaction.reply({ content: '<:cheeringstormy:1448751467400790206> Cleared.', ephemeral: true });
        }

        if (interaction.commandName === 'addrole') {
            const user = interaction.options.getUser('user');
            const role = interaction.options.getRole('role');
            const member = interaction.guild.members.cache.get(user.id);
            
            if (!member) return interaction.reply({ content: "❌ User not found.", ephemeral: true });
            
            try {
                await member.roles.add(role);
                const log = client.channels.cache.get(LOG_CHANNEL_ID);
                if(log) log.send(`<:cheeringstormy:1448751467400790206> **Role Added**\nTarget: ${user.tag}\nRole: ${role.name}\nMod: ${interaction.user.tag}`);
                return interaction.reply(`<:cheeringstormy:1448751467400790206> Added role ${role.name} to ${user.tag}`);
            } catch (e) {
                return interaction.reply({ content: "<:scaredcloudy:1448751027950977117> Failed to add role (Check my permissions).", ephemeral: true });
            }
        }

        if (interaction.commandName === 'daily') {
            const userId = interaction.user.id;
            const now = Date.now();
            if (dailyCooldown.has(userId) && now < dailyCooldown.get(userId)) return interaction.reply({ content: "❌ Cooldown.", ephemeral: true });
            await addXP(interaction.member, 500);
            dailyCooldown.set(userId, now + DAILY_COOLDOWN_MS);
            return interaction.reply("<:happymissdiamond:1448752668259647619> Claimed daily!");
        }

        if (interaction.commandName === 'leaderboard') {
            await interaction.deferReply();
            try {
                const sortedUsers = Object.entries(userLevels).sort(([, a], [, b]) => b.level - a.level || b.xp - a.xp).slice(0, 10);
                if (sortedUsers.length === 0) return interaction.editReply("No data yet.");

                let lbString = "";
                sortedUsers.forEach(([userId, data], index) => {
                    const member = interaction.guild.members.cache.get(userId);
                    const name = member ? member.displayName : "Unknown User";
                    lbString += `**${index + 1}.** ${name} - Lvl ${data.level} (${data.xp} XP)\n`;
                });

                const embed = new EmbedBuilder()
                    .setTitle('🏆 Toon Springs Leaderboard')
                    .setDescription(lbString || "No members found.")
                    .setColor(0x00FF00); // Green

                await interaction.editReply({ embeds: [embed] });
            } catch (e) {
                console.error(e);
                await interaction.editReply("Failed to generate leaderboard.");
            }
            return;
        }

        if (interaction.commandName === 'rank') {
            await interaction.deferReply();
            const user = interaction.options.getUser('user') || interaction.user;
            const member = interaction.guild.members.cache.get(user.id);
            if (!member) return interaction.editReply("User not found.");

            const userData = userLevels[user.id] || { xp: 0, level: 0 };
            const { level, xpForNext, xpNeeded } = calculateLevel(userData.xp);
            const sorted = Object.entries(userLevels).sort(([, a], [, b]) => b.xp - a.xp);
            const rank = sorted.findIndex(([id]) => id === user.id) + 1;

            const embed = new EmbedBuilder()
                .setTitle(`🐰 Rank Card: ${user.username}`)
                .setThumbnail(user.displayAvatarURL())
                .addFields(
                    { name: 'Rank', value: `#${rank || 'N/A'}`, inline: true },
                    { name: 'Level', value: `${level}`, inline: true },
                    { name: 'XP Progress', value: `${xpNeeded} / ${xpForNext}`, inline: true }
                )
                .setColor(0x9B59B6); // Purple

            await interaction.editReply({ embeds: [embed] });
            return;
        }

        if (interaction.commandName === 'givexp') {
            const user = interaction.options.getUser('user');
            const amt = interaction.options.getInteger('xp');
            await addXP(interaction.guild.members.cache.get(user.id), amt);
            const log = client.channels.cache.get(LOG_CHANNEL_ID);
            if(log) log.send(`<:cheeringstormy:1448751467400790206> **XP Given**\nTarget: ${user.tag}\nAmount: ${amt}\nMod: ${interaction.user.tag}`);
            return interaction.reply(`✅ Gave ${amt} XP to ${user.tag}`);
        }
        if (interaction.commandName === 'takeawayxp') {
            const user = interaction.options.getUser('user');
            const amt = interaction.options.getInteger('xp');
            const userId = user.id;
            if (userLevels[userId]) {
                userLevels[userId].xp = Math.max(0, userLevels[userId].xp - amt);
                const { level } = calculateLevel(userLevels[userId].xp);
                userLevels[userId].level = level;
            }
            const log = client.channels.cache.get(LOG_CHANNEL_ID);
            if(log) log.send(`<:concerdnedjin:1448751740030816481> **XP Removed**\nTarget: ${user.tag}\nAmount: ${amt}\nMod: ${interaction.user.tag}`);
            return interaction.reply(`✅ Took ${amt} XP from ${user.tag}`);
        }
        if (interaction.commandName === 'changelevel') {
            const user = interaction.options.getUser('user');
            const level = interaction.options.getInteger('level');
            const userId = user.id;
            let totalXP = 0;
            for (let l = 0; l < level; l++) totalXP += 5 * l * l + 50 * l + 100;
            userLevels[userId] = { xp: totalXP, level: level };
            await handleLevelRoles(interaction.guild.members.cache.get(userId), level);
            const log = client.channels.cache.get(LOG_CHANNEL_ID);
            if(log) log.send(`<:cheeringstormy:1448751467400790206> **Level Changed**\nTarget: ${user.tag}\nLevel: ${level}\nMod: ${interaction.user.tag}`);
            return interaction.reply(`✅ Set ${user.tag} to level ${level}`);
        }

        if (interaction.commandName === 'kick') {
            const user = interaction.options.getUser('user');
            const member = interaction.guild.members.cache.get(user.id);
            if (member.kickable) { 
                await member.kick(); 
                const log = client.channels.cache.get(LOG_CHANNEL_ID);
                if(log) log.send(`<:ragingpaul:1448752763164037295> **User Kicked**\nTarget: ${user.tag}\nMod: ${interaction.user.tag}`);
                return interaction.reply(`✅ Kicked ${user.tag}`); 
            }
            return interaction.reply("❌ Cannot kick user.");
        }
        if (interaction.commandName === 'ban') {
            const user = interaction.options.getUser('user');
            const member = interaction.guild.members.cache.get(user.id);
            if (member.bannable) { 
                await member.ban(); 
                const log = client.channels.cache.get(LOG_CHANNEL_ID);
                if(log) log.send(`<:ragingpaul:1448752763164037295> **User Banned**\nTarget: ${user.tag}\nMod: ${interaction.user.tag}`);
                return interaction.reply(`✅ Banned ${user.tag}`); 
            }
            return interaction.reply("❌ Cannot ban user.");
        }
        if (interaction.commandName === 'unban') {
            const id = interaction.options.getString('userid');
            await interaction.guild.members.unban(id).catch(() => {});
            const log = client.channels.cache.get(LOG_CHANNEL_ID);
            if(log) log.send(`<:cheeringstormy:1448751467400790206> **User Unbanned**\nTarget ID: ${id}\nMod: ${interaction.user.tag}`);
            return interaction.reply(`✅ Unbanned ID ${id}`);
        }
        if (interaction.commandName === 'timeout') {
            const user = interaction.options.getUser('user');
            const mins = interaction.options.getInteger('minutes');
            const member = interaction.guild.members.cache.get(user.id);
            if (member.manageable) { 
                await member.timeout(mins * 60 * 1000); 
                const log = client.channels.cache.get(LOG_CHANNEL_ID);
                if(log) log.send(`<:concerdnedjin:1448751740030816481> **User Timeout**\nTarget: ${user.tag}\nDuration: ${mins}m\nMod: ${interaction.user.tag}`);
                return interaction.reply(`✅ Timed out ${user.tag}`); 
            }
            return interaction.reply("❌ Cannot timeout user.");
        }

        if (interaction.commandName === 'setup') {
            const ch = client.channels.cache.get(SETUP_POST_CHANNEL);
            if (!ch) return interaction.reply({ content: "Setup channel not found", ephemeral: true });
            const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('create_ticket').setLabel('Create Ticket').setStyle(ButtonStyle.Primary));
            await ch.send({ content: 'Create Ticket:', components: [row] });
            return interaction.reply({ content: '✅ Posted', ephemeral: true });
        }
    }

    // --- BUTTONS ---
    if (interaction.isButton()) {
        if (interaction.customId === 'create_ticket') {
            const channel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username}`,
                type: 0,
                parent: RP_CATEGORY_ID,
                permissionOverwrites: [
                    { id: interaction.guild.roles.everyone, deny: [PermissionsBitField.Flags.ViewChannel] },
                    { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                    { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
                ]
            });
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('confirm_close_yes').setLabel('Close').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success)
            );
            await channel.send({ content: `<@${interaction.user.id}> Welcome!`, components: [row] });
            return interaction.reply({ content: `Ticket created: ${channel}`, ephemeral: true });
        }

        if (interaction.customId === 'claim_ticket') {
            await interaction.channel.setTopic(`Claimed by ${interaction.user.tag}`);
            return interaction.reply({ content: "Ticket claimed!", ephemeral: true });
        }

        if (interaction.customId === 'confirm_close_yes') {
            const msgs = await interaction.channel.messages.fetch({ limit: 100 });
            const transcript = msgs.reverse().map(m => `${m.author.tag}: ${m.content}`).join('\n');
            const tChannel = client.channels.cache.get(TRANSCRIPT_CHANNEL_ID);
            
            // === 1902 LIMIT ===
            const MAX = 1902;
            
            if (tChannel) {
                if (transcript.length < MAX) {
                    const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), { name: 'transcript.txt' });
                    await tChannel.send({ content: `Ticket closed: ${interaction.channel.name}`, files: [attachment] });
                } else {
                    await tChannel.send(`Transcript too long (> ${MAX} chars). Sending split messages.`);
                    const chunks = transcript.match(new RegExp(`.{1,${MAX}}`, 'g'));
                    for (const chunk of chunks) await tChannel.send(`\`\`\`${chunk}\`\`\``);
                }
            }
            await interaction.channel.delete();
        }

        // --- FIXED THREAD ARCHIVE BUTTON LOGIC ---
        if (interaction.customId === 'archive_thread') {
             const thread = interaction.channel;
             if (!thread || !thread.isThread()) {
                 return interaction.reply({ content: "❌ This is not a thread.", ephemeral: true });
             }
             // Reply first to prevent timeout, then archive
             await interaction.reply({ content: "🔒 Archiving thread...", ephemeral: true });
             try {
                 await thread.setArchived(true);
             } catch (e) {
                 console.error(e);
                 await interaction.followUp({ content: "❌ Failed to archive (Check Permissions).", ephemeral: true });
             }
        }
        if (interaction.customId === 'edit_title') {
            const thread = interaction.channel;
            if (thread.isThread()) {
                await interaction.reply({ content: "Send the new title in this thread. You have 30 seconds.", ephemeral: true });
                const filter = m => m.author.id === interaction.user.id && m.channelId === thread.id;
                const collector = thread.createMessageCollector({ filter, time: 30000, max: 1 });
                
                collector.on('collect', async (msg) => {
                    try {
                        await thread.setName(msg.content.slice(0, 100)); 
                        await msg.delete();
                        await interaction.followUp({ content: "✅ Title updated", ephemeral: true });
                    } catch (e) {
                        await interaction.followUp({ content: "❌ Failed to update title.", ephemeral: true });
                    }
                });
            }
        }
    }
});

// ================= MESSAGE CREATE =================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // --- 1. IMAGE ONLY CHANNEL CHECK (FIRST LAYER) ---
    if (message.channel.id === TARGET_CHANNEL_ID) {
        if (message.attachments.size === 0 && message.stickers.size === 0) {
            await message.delete().catch(() => {});
            return; // Deleted because text-only.
        } else {
            // Valid Image - CREATE THREAD
            try {
                await message.react('✨');
                const thread = await message.startThread({
                    name: `${message.author.username}'s Post`,
                    autoArchiveDuration: 60, // 1 hour
                });
                
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('archive_thread').setLabel('Archive Thread').setStyle(ButtonStyle.Danger),
                    new ButtonBuilder().setCustomId('edit_title').setLabel('Edit Title').setStyle(ButtonStyle.Secondary)
                );
                
                await thread.send({ content: `Hey ${message.author}! Manage your thread here:`, components: [row] });
            } catch (e) {
                console.error("Failed to create thread:", e);
            }
        }
    }

    // --- 2. FILTERS (SECOND LAYER) ---
    const manualFilter = filterMessageManually(message.content);
    if (manualFilter.isSevere) {
        await message.delete().catch(() => {});
        if (message.member.manageable) message.member.timeout(60 * 60 * 1000, "Severe Filter").catch(() => {});
        const log = client.channels.cache.get(LOG_CHANNEL_ID);
        if (log) log.send(`<:ragingpaul:1448752763164037295> Severe Violation: ${message.author.tag}`);
        return;
    }
    if (manualFilter.isMild) {
        await message.delete().catch(() => {});
        const log = client.channels.cache.get(LOG_CHANNEL_ID);
        if (log) log.send(`<:madscarlet:1448751667863355482> Mild Violation (Deleted): ${message.author.tag}`);
        return;
    }
    
    // AI CHECK (Double Check)
    if (AI_ENABLED) {
        const { isToxic } = await checkMessageToxicity(message.content);
        if (isToxic) {
            await message.delete().catch(() => {});
            if (message.member.manageable) message.member.timeout(10 * 60 * 1000, "AI Filter").catch(() => {});
            const log = client.channels.cache.get(LOG_CHANNEL_ID);
            if (log) log.send(`<:scaredcloudy:1448751027950977117> AI Filter Violation: ${message.author.tag}`);
            return;
        }
    }

    // --- 3. AFK LOGIC ---
    // User returning
    if (afkStatus.has(message.author.id)) {
        afkStatus.delete(message.author.id);
        message.reply(`welcome back ${message.author} I have removed your AFK <:happymissdiamond:1448752668259647619>`).then(m => setTimeout(() => m.delete(), 5000));
    }
    
    // User being pinged
    if (message.mentions.users.size > 0) {
        message.mentions.users.forEach(u => {
            if (afkStatus.has(u.id)) {
                message.reply(`${u.username} is currently AFK (${afkStatus.get(u.id).reason})`);
            }
        });
    }
    
    // Set AFK
    if (message.content.toLowerCase().startsWith('?afk')) {
        const reason = message.content.slice(4).trim() || 'AFK';
        afkStatus.set(message.author.id, { reason, timestamp: Date.now() });
        return message.reply(`afk ${message.author} ${reason} has been set`);
    }

    // --- 4. XP LOGIC ---
    if (message.channel.id !== AFK_XP_EXCLUSION_CHANNEL_ID) {
        const userId = message.author.id;
        const now = Date.now();
        if (!xpCooldown.has(userId) || now > xpCooldown.get(userId)) {
            let gain = XP_GAIN;
            if (message.member.roles.cache.has(BOOSTER_ROLE_ID)) gain *= 2;
            await addXP(message.member, gain, message);
            xpCooldown.set(userId, now + XP_COOLDOWN_MS);
        }
    }
});

client.on('guildMemberAdd', async (member) => {
    moderateNickname(member);
    const now = Date.now();
    const data = joinTracker.get(member.id) || { count: 0, lastJoin: 0 };
    if (now - data.lastJoin > 15 * 60 * 1000) data.count = 0;
    data.count++;
    data.lastJoin = now;
    joinTracker.set(member.id, data);
    if (data.count >= 10 && member.bannable) {
        await member.ban({ reason: 'Rapid Join' });
    }
});

client.login(process.env.TOKEN);

// === 1902 PORT ===
const PORT = process.env.PORT || 1902;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('Bot Running');
}).listen(PORT, () => console.log(`Web server listening on port ${PORT}`));
