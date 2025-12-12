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
  AttachmentBuilder // Needed for sending images
} = require('discord.js');
const http = require('http');

// --- AI Import ---
const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai');

// --- Image Generation Import ---
const { RankCardBuilder, LeaderboardBuilder, Font } = require('canvacord');
// Load the default font for image generation
Font.loadDefault();
// ------------------------------

// Check for the mandatory token environment variable
if (!process.env.TOKEN) {
  console.error("❌ TOKEN not found. Add TOKEN in Render Environment Variables.");
  process.exit(1);
}

// --- AI Key Check ---
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY not found. Add GEMINI_API_KEY in Render Environment Variables to enable AI.");
  process.exit(1);
}
// --------------------

// ====================== 🟢 CRITICAL FIX: CLIENT INITIALIZATION 🟢 ======================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, 
    GatewayIntentBits.GuildMembers,   
    GatewayIntentBits.GuildMessageReactions 
  ]
});
// =========================================================================================


// ====================== CRITICAL CONFIGURATION: REPLACE THESE ======================

// ** CRITICAL: REPLACE THIS WITH THE DIRECT LINK TO STORMY'S RP IMAGE **
const STORMY_IMAGE_URL = 'YOUR_LINK_TO_STORMY_RP_IMAGE.png'; 

// ** CRITICAL: REPLACE THIS WITH YOUR CUSTOM RANK CARD BACKGROUND IMAGE URL **
// It must be a direct link to a PNG or JPG file.
const RANK_CARD_BACKGROUND_URL = 'https://i.imgur.com/r62Y0c7.png'; 

// --- DISCORD IDs ---
const GUILD_ID = '1369477266958192720';           
const TARGET_CHANNEL_ID = '1415134887232540764'; 
const LOG_CHANNEL_ID = '1414286807360602112';    
const TRANSCRIPT_CHANNEL_ID = '1414354204079689849';
const SETUP_POST_CHANNEL = '1445628128423579660';   
const MUTE_ROLE_ID = '1446530920650899536';        
const RP_CHANNEL_ID = '1421219064985948346';      
const RP_CATEGORY_ID = '1446530920650899536';      

// --- LEVELING/XP CONFIGURATION ---
const AFK_XP_EXCLUSION_CHANNEL_ID = '1414352027034583080';
const BOOSTER_ROLE_ID = '1400596498969923685'; 

const LEVEL_ROLES = {
    5: '1418567907662630964',
    10: '1418568030132244611',
    15: '1418568206662238269',
    20: '1418568333229559978', 
    30: '1418568692819824741',
    50: '1418568903411372063', 
    100: '1441563487565250692',
};

// ====================== END CRITICAL CONFIGURATION ======================


const STORMY_AVATAR_URL = 'https://i.imgur.com/r62Y0c7.png'; 
const HOPS_AVATAR_URL = 'https://i.imgur.com/r62Y0c7.png';     
const NICKNAME_SCAN_INTERVAL = 5 * 1000;

const HELP_MESSAGE = `hello! Do you need help?
Please go to https://discord.com/channels/${GUILD_ID}/1414304297122009099
and for more assistance please use
https://discord.com/channels/${GUILD_ID}/1414352972304879626
channel to create a more helpful environment to tell a mod`;

// ====================== IN-MEMORY DATA STORAGE ======================
const userLevels = {}; 
const xpCooldown = new Map(); 
const dailyCooldown = new Map(); 
const joinTracker = new Map(); 
const afkStatus = new Map(); 
// ====================================================================

// ====================== LEVELING SYSTEM FUNCTIONS ======================

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
                if (!member.roles.cache.has(roleId)) {
                    await member.roles.add(role, `Level up to ${newLevel} or set by moderator.`);
                }
            } else {
                if (member.roles.cache.has(roleId)) {
                    await member.roles.remove(role, 'Removing outdated level role.');
                }
            }
        }
    } catch (e) {
        console.error('Failed to handle level up roles:', e);
    }
}

async function addXP(member, xpAmount, message = null) {
    const userId = member.id;
    
    if (!userLevels[userId]) {
        userLevels[userId] = { xp: 0, level: 0 };
    }
    
    const oldLevel = userLevels[userId].level;
    userLevels[userId].xp += xpAmount;
    
    const { level } = calculateLevel(userLevels[userId].xp);
    
    userLevels[userId].level = level;
    
    if (level > oldLevel) {
        if (message && message.channel) {
            message.channel.send(`${member.toString()} wow toon! You are now level **${level}**! Keep messaging and you unlock new level up roles!`);
        }
        await handleLevelRoles(member, level);
    }
}

// ====================== MANUAL WORD FILTER CONFIG ======================

const ALLOWED_WORDS = [
  "assist", "assistance", "assistant", "associat", 
  "class", "classic", "glass", "grass", "pass", "bass", "compass", 
  "hello", "shell", "peacock", "cocktail", "babcock"
];

const MILD_BAD_WORDS = [
  "fuck", "f*ck", "f**k", "f-ck", "fck", "fu-", "f-", "f*cking", "fucking",
  "shit", "s*it", "s**t", "sh!t",
  "ass", "bitch", "hoe", "whore", "slut", "cunt", 
  "dick", "pussy", "cock", "bastard", "sexy",
];

const SEVERE_WORDS = [
  "nigger", "nigga", "niga", "faggot", "fag", "dyke", "tranny", "chink", "kike", "paki", "gook", "spic", "beaner", "coon", 
  "retard", "spastic", "mong", "autist",
  "kys", "kill yourself", "suicide", "rape", "molest",
  "hitler", "nazi", "kkk",
  "joke about harassing", "troll joke", "harassment funny", "trolling funny", "trollin", "troller"
];

const BAD_WORDS = [...MILD_BAD_WORDS, ...SEVERE_WORDS];

const LEET_MAP = {
    '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '(': 'c', '+': 't', 
    '8': 'b', '*': 'o', '9': 'g'
};

function filterMessageManually(text) {
    let normalized = text.toLowerCase().replace(/[^a-z0-9]/g, '');
    let leetNormalized = normalized.split('').map(char => LEET_MAP[char] || char).join('');
    
    const checkNormalizedText = (list, normText) => {
        for (const badWord of list) {
            if (normText.includes(badWord)) {
                if (ALLOWED_WORDS.some(allowed => allowed === badWord)) continue; 
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

// ================= AI INITIALIZATION & CONFIGURATION =================
const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_LOW_AND_ABOVE,
  },
];

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const aiModel = 'gemini-2.5-flash';

async function checkMessageToxicity(text) {
  if (text.length === 0) return { isToxic: false, blockCategory: 'None' };
  
  try {
    const response = await ai.models.generateContent({
      model: aiModel,
      contents: [{ role: "user", parts: [{ text: `Analyze the following user message for hate speech, slurs, harassment, or other inappropriate content: "${text}"` }] }],
      safetySettings: safetySettings,
    });

    if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        if (candidate.finishReason === 'SAFETY') {
            const blockedCategory = candidate.safetyRatings.map(r => {
                if (r.probability === 'MEDIUM' || r.probability === 'HIGH' || r.probability === 'LOW') {
                    return r.category;
                }
                return null;
            }).filter(Boolean).join(' & ');
            return { isToxic: true, blockCategory: blockedCategory || 'Unknown' };
        }
    }
    return { isToxic: false, blockCategory: 'None' };
  } catch (error) {
    console.error('Gemini Moderation API Error:', error);
    return { isToxic: false, blockCategory: 'API_Error' }; 
  }
}

// ================= END AI INITIALIZATION =================

async function moderateNickname(member) {
  let displayName = member.displayName.toLowerCase();
  let normalized = displayName.replace(/[^a-z0-9]/g, '');
  let leetNormalized = normalized.split('').map(char => LEET_MAP[char] || char).join('');

  const isBad = BAD_WORDS.some(badWord => {
    if (normalized.includes(badWord)) return true;
    if (leetNormalized.includes(badWord)) return true;
    return false;
  });

  if (isBad) {
    try {
      if (member.manageable) {
        await member.setNickname("[moderated nickname by hopper]");
        const log = member.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (log) log.send(`🛡️ **Nickname Moderated**\nUser: <@${member.id}>\nOld Name: ||${member.user.username}||\nReason: Inappropriate Username (Manual Filter)`);
        return true; 
      }
    } catch (err) {
      console.error(`Failed to moderate nickname for ${member.user.tag}:`, err);
      return false;
    }
  }
  return false; 
}

async function runAutomatedNicknameScan(guild) {
    if (!guild) return; 
    let moderatedCount = 0;
    try {
        const members = await guild.members.fetch(); 
        for (const [id, member] of members) {
            if (member.user.bot) continue;
            if (await moderateNickname(member)) {
                moderatedCount++;
            }
        }
        if (moderatedCount > 0) {
            const log = guild.channels.cache.get(LOG_CHANNEL_ID);
            if (log) log.send(`✅ **Recurring Scan Complete:** Checked ${members.size} members. Moderated **${moderatedCount}** inappropriate names.`);
        }
    } catch (error) {
        console.error('Automated Nickname Scan failed:', error);
    }
}

function startAutomatedNicknameScan(guild) {
    runAutomatedNicknameScan(guild); 
    setInterval(() => {
        runAutomatedNicknameScan(guild);
    }, NICKNAME_SCAN_INTERVAL);
    console.log(`Automated nickname scan started, running every ${NICKNAME_SCAN_INTERVAL / 1000} seconds.`);
}


// ================= READY =================
client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  client.guilds.cache.forEach(async (guild) => {
    if (guild.id !== GUILD_ID) {
        console.log(`❌ Found unauthorized server on startup: ${guild.name} (${guild.id}). Leaving...`);
        try {
            await guild.leave();
        } catch (err) {
            console.error(`Failed to leave ${guild.name}:`, err);
        }
    }
  });

  client.user.setPresence({
    activities: [{ name: 'hopping all around Toon Springs', type: 0 }],
    status: 'online'
  });

  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
      startAutomatedNicknameScan(guild); 
  }

  const commands = [
    new SlashCommandBuilder()
      .setName('say')
      .setDescription('Make the bot say something anonymously')
      .addStringOption(opt => opt.setName('text').setDescription('Text for the bot to say').setRequired(true)),

    new SlashCommandBuilder()
      .setName('ask') 
      .setDescription('Search about stormy and hops') 
      .addStringOption(opt => opt.setName('prompt').setDescription('Your question for Hopper').setRequired(true)), 
      
    new SlashCommandBuilder().setName('help').setDescription('Get help'),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Get server information'),

    new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Delete a number of messages to clean chat (Mod only)')
      .addIntegerOption(opt => opt.setName('number').setDescription('Number of messages (1-100)').setRequired(true)),
      
    new SlashCommandBuilder()
      .setName('lock')
      .setDescription('Lock a channel to prevent messages (Mod only)')
      .addChannelOption(opt => opt.setName('channel').setDescription('Channel to lock (default: current)').setRequired(false)),
      
    new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Unlock a channel (Mod only)')
      .addChannelOption(opt => opt.setName('channel').setDescription('Channel to unlock (default: current)').setRequired(false)),

    new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('Shows user info and join date')
      .addUserOption(opt => opt.setName('user').setDescription('User to check (default: self)').setRequired(false)),

    // --- Leveling/XP Commands ---
    new SlashCommandBuilder()
        .setName('daily')
        .setDescription('Claim your daily rewards (XP).'),

    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Show top members by level and XP.'),

    new SlashCommandBuilder()
        .setName('quest')
        .setDescription('Get a small task or challenge (placeholder).'),
        
    new SlashCommandBuilder()
        .setName('rank')
        .setDescription('Show your level rank card.')
        .addUserOption(opt => opt.setName('user').setDescription('User to check (default: self)').setRequired(false)),

    // --- XP Mod Commands ---
    new SlashCommandBuilder()
        .setName('givexp')
        .setDescription('Give a user XP (Mod only)')
        .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
        .addIntegerOption(opt => opt.setName('xp').setDescription('Amount of XP').setRequired(true)),
        
    new SlashCommandBuilder()
        .setName('takeawayxp')
        .setDescription('Take away a user XP (Mod only)')
        .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
        .addIntegerOption(opt => opt.setName('xp').setDescription('Amount of XP').setRequired(true)),

    new SlashCommandBuilder()
        .setName('changelevel')
        .setDescription('Set a user to a specific level (Mod only)')
        .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
        .addIntegerOption(opt => opt.setName('level').setDescription('Target level').setRequired(true)),

    new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member')
      .addUserOption(opt => opt.setName('user').setDescription('User to kick').setRequired(true)),

    new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member')
      .addUserOption(opt => opt.setName('user').setDescription('User to ban').setRequired(true)),

    new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Unban a user by ID')
      .addStringOption(opt => opt.setName('userid').setDescription('User ID').setRequired(true)),

    new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('Timeout a member (minutes)')
      .addUserOption(opt => opt.setName('user').setDescription('User').setRequired(true))
      .addIntegerOption(opt => opt.setName('minutes').setDescription('Minutes').setRequired(true)),

    new SlashCommandBuilder()
      .setName('setup')
      .setDescription('Post the ticket creation message in the tickets channel'),
      
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

// ================= ANTI-INVITE PROTECTION (EVENT) =================
client.on('guildCreate', async (guild) => {
    if (guild.id !== GUILD_ID) {
        console.log(`⚠️ Bot was invited to unauthorized server: ${guild.name} (${guild.id}). Leaving immediately.`);
        try {
            await guild.leave();
        } catch (err) {
            console.error('Failed to leave unauthorized server:', err);
        }
    } else {
        console.log(`✅ Joined authorized server: ${guild.name}`);
    }
});

// ================= SLASH COMMANDS AND BUTTONS =================
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const isMod = interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers) || interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages);
    const isChannelMod = interaction.member.permissions.has(PermissionsBitField.Flags.ManageChannels);
    
    const modCommands = ['kick','ban','unban','timeout','setup', 'givexp', 'takeawayxp', 'changelevel'];
    const channelModCommands = ['clear', 'lock', 'unlock'];

    if (modCommands.includes(interaction.commandName) && !isMod) {
        return interaction.reply({ content: '❌ Mods only', ephemeral: true });
    }
    if (channelModCommands.includes(interaction.commandName) && !isMod && !isChannelMod) {
         return interaction.reply({ content: '❌ Need Manage Messages or Manage Channels permission.', ephemeral: true });
    }
    
    if (interaction.commandName === 'say') {
      const text = interaction.options.getString('text');
      const { isToxic } = await checkMessageToxicity(text);
      if (isToxic) return interaction.reply({ content: "❌ That message violates the Hopper content filter.", ephemeral: true });
      
      await interaction.channel.send(text);
      return interaction.reply({ content: "✅ Sent anonymously", ephemeral: true });
    }
    
    if (interaction.commandName === 'ask') { 
        await interaction.deferReply(); 
        const prompt = interaction.options.getString('prompt');

        const manualFilter = filterMessageManually(prompt);
        if (manualFilter.isSevere || manualFilter.isMild) {
            return interaction.editReply('❌ Your question contains inappropriate language and was blocked by the Hopper filter.');
        }

        const { isToxic: promptIsToxic } = await checkMessageToxicity(prompt);
        if (promptIsToxic) {
             return interaction.editReply('❌ Your request was blocked by the safety filter. Please rephrase your question.');
        }

        try {
            const systemInstruction = "You are the character Hops Bunny, an assistant for the 'Stormy and Hops' Discord server. You MUST use Google Search for grounding, but you are strictly limited to ONLY providing information found on the following official and fandom sources: stormy-and-hops.fandom.com, stormyandhops.netlify.app, X.com/stormyandhops, X.com/bunnytoonsstudios, and YouTube.com/stormyandhops. DO NOT use any other external information source. Your answers must be about the Stormy and Hops universe only. Maintain a friendly, server-appropriate 'Hopper' tone, and incorporate the provided custom server emojis into your responses when appropriate: <:MrLuck:1448751843885842623>, <:cheeringstormy:1448751467400790206>, <:concerdnedjin:1448751740030816481>, <:happymissdiamond:1448752668259647619>, <:heartkatie:1448751305756639372>, <:madscarlet:1448751667863355482>, <:mischevousoscar:1448752833951305789>, <:questioninghops:1448751559067308053>, <:ragingpaul:1448752763164037295>, <:scaredcloudy:1448751027950977117>, <:thinking_preston:1448751103822004437>, <:tiredscout:1448751394881278043>, and <:Stormyandhopslogo:1448502746113118291>.";
            
            const result = await ai.models.generateContent({
                model: aiModel,
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                safetySettings: safetySettings,
                config: { 
                    systemInstruction: systemInstruction,
                    tools: [{ googleSearch: {} }], 
                }
            });

            const responseText = result.text.trim();

            if (responseText.length > 2000) {
                const shortenedResponse = responseText.substring(0, 1900) + '... (truncated)';
                await interaction.editReply(`🐰 **Hopper response (Truncated):**\n\n${shortenedResponse}`);
            } else {
                await interaction.editReply(`🐰 **Hopper response:**\n\n${responseText}`);
            }
        } catch (error) {
            if (error.message && error.message.includes('SAFETY')) {
                await interaction.editReply('❌ My generated response was blocked by the safety filter. Please try a different prompt.');
            } else {
                console.error('Gemini API Error:', error);
                const timePlaceholder = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }); 
                await interaction.editReply(`<:scaredcloudy:1448751027950977117> uh-oh I am unable to get information right now please wait until [Your time: ${timePlaceholder}] <:heartkatie:1448751305756639372>`);
            }
        }
        return;
    }

    if (interaction.commandName === 'help') {
      return interaction.reply({ content: HELP_MESSAGE, ephemeral: true });
    }

    if (interaction.commandName === 'serverinfo') {
      const guild = interaction.guild;
      return interaction.reply({
        content:
          `**Server Name:** ${guild.name}\n**Members:** ${guild.memberCount}\n**Created:** ${guild.createdAt.toDateString()}`,
        ephemeral: true
      });
    }

    // --- New Utility/Mod Command Handlers ---
    if (interaction.commandName === 'clear') {
        const amount = interaction.options.getInteger('number');
        if (amount < 1 || amount > 100) {
            return interaction.reply({ content: '❌ Number must be between 1 and 100.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        try {
            const fetched = await interaction.channel.messages.fetch({ limit: amount + 1 });
            const deleted = await interaction.channel.bulkDelete(fetched, true); 
            return interaction.editReply(`✅ Successfully deleted ${deleted.size - 1} messages.`);
        } catch (e) {
            console.error('Clear failed:', e);
            return interaction.editReply('❌ Failed to delete messages (check permissions or message age - Discord limits bulk delete to 14 days).');
        }
    }

    if (interaction.commandName === 'lock' || interaction.commandName === 'unlock') {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const lock = interaction.commandName === 'lock';

        if (!channel.manageable) return interaction.reply({ content: '❌ I cannot manage permissions for that channel.', ephemeral: true });

        try {
            const everyoneRole = channel.guild.roles.cache.find(r => r.name === '@everyone');
            if (!everyoneRole) return interaction.reply({ content: '❌ Could not find @everyone role.', ephemeral: true });

            await channel.permissionOverwrites.edit(everyoneRole, {
                SendMessages: lock ? false : null, 
            });

            return interaction.reply(`✅ Channel ${channel} has been **${lock ? 'locked' : 'unlocked'}**.`);
        } catch (e) {
            console.error(`${interaction.commandName} failed:`, e);
            return interaction.reply(`❌ Failed to ${interaction.commandName} the channel.`);
        }
    }
    
    if (interaction.commandName === 'userinfo') {
        const user = interaction.options.getUser('user') || interaction.user;
        const member = interaction.guild.members.cache.get(user.id);
        
        let info = `**User Info for ${user.tag}**\n`;
        info += `> **ID:** \`${user.id}\`\n`;
        info += `> **Account Created:** ${user.createdAt.toDateString()}\n`;
        
        if (member) {
            info += `> **Joined Server:** ${member.joinedAt.toDateString()}\n`;
            info += `> **Roles:** ${member.roles.cache.size - 1} roles\n`;
            if (member.roles.cache.has(BOOSTER_ROLE_ID)) {
                info += `> **Server Booster:** Yes 💜\n`;
            }
        }

        return interaction.reply({ content: info, ephemeral: true });
    }
    
    // --- New Leveling/XP Command Handlers (UPDATED TO USE CANVACORD) ---
    
    if (interaction.commandName === 'rank') {
        await interaction.deferReply();
        const user = interaction.options.getUser('user') || interaction.user;
        const userData = userLevels[user.id] || { xp: 0, level: 0 };
        const { level, xpForNext, xpNeeded } = calculateLevel(userData.xp);
        
        // Find the user's rank
        const sortedUsers = Object.entries(userLevels).sort(([, a], [, b]) => b.xp - a.xp);
        const rankIndex = sortedUsers.findIndex(([id]) => id === user.id) + 1;

        try {
            const rankCard = new RankCardBuilder()
                .setDisplayName(user.username) // Use username
                .setUsername(user.username)
                .setAvatar(user.displayAvatarURL({ extension: 'png', size: 512 }))
                .setCurrentXP(xpNeeded) // XP within current level
                .setRequiredXP(xpForNext) // Total XP needed for next level
                .setLevel(level)
                .setRank(rankIndex || 1)
                .setStatus('online') // Default status
                .setBackground(RANK_CARD_BACKGROUND_URL); 

            const data = await rankCard.build({ format: 'png' });
            const attachment = new AttachmentBuilder(data, { name: 'rank.png' });
            
            return interaction.editReply({ files: [attachment] });
        } catch (e) {
            console.error("Failed to generate rank card:", e);
            return interaction.editReply(`❌ Failed to generate rank card. (Error: ${e.message})`);
        }
    }
    
    if (interaction.commandName === 'daily') {
        const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
        const userId = interaction.user.id;
        const now = Date.now();
        
        if (dailyCooldown.has(userId) && now < dailyCooldown.get(userId)) {
            const remaining = dailyCooldown.get(userId) - now;
            const hours = Math.floor(remaining / (1000 * 60 * 60));
            const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
            return interaction.reply({ content: `❌ You can claim your daily reward in ${hours}h ${minutes}m.`, ephemeral: true });
        }
        
        const DAILY_XP = 500;
        await addXP(interaction.member, DAILY_XP);
        dailyCooldown.set(userId, now + COOLDOWN_MS);
        
        return interaction.reply(`✅ You claimed your daily reward! You earned **${DAILY_XP} XP**! Keep hopping!`);
    }

    if (interaction.commandName === 'leaderboard') {
        await interaction.deferReply();
        const sortedUsers = Object.entries(userLevels)
            .sort(([, a], [, b]) => b.level - a.level || b.xp - a.xp)
            .slice(0, 10);
            
        if (sortedUsers.length === 0) {
            return interaction.editReply("No one has gained XP yet! Start chatting!");
        }

        try {
            // Transform data for Canvacord
            const players = sortedUsers.map(([userId, data], index) => {
                const member = interaction.guild.members.cache.get(userId);
                const user = member ? member.user : { username: 'Unknown', displayAvatarURL: () => 'https://cdn.discordapp.com/embed/avatars/0.png' };
                return {
                    avatar: user.displayAvatarURL({ extension: 'png' }),
                    username: user.username,
                    displayName: user.username,
                    level: data.level,
                    xp: data.xp,
                    rank: index + 1
                };
            });

            const lb = new LeaderboardBuilder()
                .setHeader({
                    title: 'Toon Springs Top 10',
                    image: STORMY_AVATAR_URL, 
                    subtitle: `${Object.keys(userLevels).length} members`
                })
                .setPlayers(players)
                .setBackground(RANK_CARD_BACKGROUND_URL); // Using same background for consistency

            const data = await lb.build({ format: 'png' });
            const attachment = new AttachmentBuilder(data, { name: 'leaderboard.png' });

            return interaction.editReply({ files: [attachment] });

        } catch (e) {
            console.error("Failed to generate leaderboard:", e);
            // Fallback to text leaderboard if image fails
            let textLeaderboard = "🏆 **Hopper's Top 10 Toons!** (Image Generation Failed)\n";
            for (let i = 0; i < sortedUsers.length; i++) {
                const [userId, data] = sortedUsers[i];
                const member = interaction.guild.members.cache.get(userId);
                const userTag = member ? member.user.username : `Unknown User (${userId})`;
                textLeaderboard += `${i + 1}. **Level ${data.level}** - ${userTag}\n`;
            }
            return interaction.editReply({ content: textLeaderboard });
        }
    }
    
    if (interaction.commandName === 'quest') {
         return interaction.reply({ content: "🗺️ **Current Quest:** Help Hopper by keeping the chat fun and friendly! No specific quest is available right now, but check back later! (This feature is a placeholder and will be expanded soon!)", ephemeral: true });
    }

    // --- XP Mod Commands Handlers ---
    if (interaction.commandName === 'givexp') {
        const user = interaction.options.getUser('user');
        const xpAmount = interaction.options.getInteger('xp');
        const member = interaction.guild.members.cache.get(user.id);
        
        if (!member) return interaction.reply({ content: "❌ User not found in server.", ephemeral: true });
        if (xpAmount <= 0) return interaction.reply({ content: "❌ XP must be positive.", ephemeral: true });
        
        await addXP(member, xpAmount, null);
        
        const currentData = userLevels[user.id];
        return interaction.reply({ content: `✅ Gave **${xpAmount} XP** to ${user.tag}. New Level: **${currentData.level}** (Total XP: ${currentData.xp}).`, ephemeral: true });
    }

    if (interaction.commandName === 'takeawayxp') {
        const user = interaction.options.getUser('user');
        const xpAmount = interaction.options.getInteger('xp');
        const member = interaction.guild.members.cache.get(user.id);
        
        if (!member) return interaction.reply({ content: "❌ User not found in server.", ephemeral: true });
        if (xpAmount <= 0) return interaction.reply({ content: "❌ XP must be positive.", ephemeral: true });

        if (!userLevels[user.id]) userLevels[user.id] = { xp: 0, level: 0 };
        
        userLevels[user.id].xp = Math.max(0, userLevels[user.id].xp - xpAmount);
        const { level } = calculateLevel(userLevels[user.id].xp);
        userLevels[user.id].level = level; 
        
        await handleLevelRoles(member, level);

        return interaction.reply({ content: `✅ Took away **${xpAmount} XP** from ${user.tag}. New Level: **${level}** (Total XP: ${userLevels[user.id].xp}).`, ephemeral: true });
    }
    
    if (interaction.commandName === 'changelevel') {
        const user = interaction.options.getUser('user');
        let targetLevel = interaction.options.getInteger('level');
        const member = interaction.guild.members.cache.get(user.id);

        if (!member) return interaction.reply({ content: "❌ User not found in server.", ephemeral: true });
        if (targetLevel < 0) targetLevel = 0;

        let totalXP = 0;
        for (let l = 0; l < targetLevel; l++) {
             totalXP += 5 * l * l + 50 * l + 100;
        }

        userLevels[user.id] = { xp: totalXP, level: targetLevel };
        
        await handleLevelRoles(member, targetLevel);

        return interaction.reply({ content: `✅ Set level for ${user.tag} to **${targetLevel}**.`, ephemeral: true });
    }

    // --- Moderation Commands ---

    if (interaction.commandName === 'kick') {
      const user = interaction.options.getUser('user');
      const member = interaction.guild.members.cache.get(user.id);
      if (!member) return interaction.reply({ content: "User not found", ephemeral: true });
      if (!member.kickable) return interaction.reply({ content: "❌ Cannot kick that member (role hierarchy).", ephemeral: true });
      await member.kick();
      return interaction.reply({ content: `✅ Kicked ${user.tag}`, ephemeral: true });
    }

    if (interaction.commandName === 'ban') {
      const user = interaction.options.getUser('user');
      await interaction.guild.members.ban(user.id);
      return interaction.reply({ content: `✅ Banned ${user.tag}`, ephemeral: true });
    }

    if (interaction.commandName === 'unban') {
      const id = interaction.options.getString('userid');
      await interaction.guild.members.unban(id);
      return interaction.reply({ content: `✅ Unbanned ${id}`, ephemeral: true });
    }

    if (interaction.commandName === 'timeout') {
      const user = interaction.options.getUser('user');
      const minutes = interaction.options.getInteger('minutes');
      const member = interaction.guild.members.cache.get(user.id);
      if (!member.manageable) return interaction.reply({ content: "❌ Cannot timeout that member (role hierarchy).", ephemeral: true });
      const duration = minutes * 60 * 1000;
      await member.timeout(duration);
      return interaction.reply({ content: `✅ Timed out ${user.tag} for ${minutes} minutes`, ephemeral: true });
    }
    
    // --- Ticket Setup Command ---
    if (interaction.commandName === 'setup') {
      try {
        const postChannel = await client.channels.fetch(SETUP_POST_CHANNEL);
        if (!postChannel) return interaction.reply({ content: 'Setup channel not found', ephemeral: true });

        const createRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('create_ticket').setLabel('Create Ticket').setStyle(ButtonStyle.Primary)
        );

        await postChannel.send({ content: 'Hello! Do you want to create a ticket?', components: [createRow] });
        return interaction.reply({ content: '✅ Setup message posted.', ephemeral: true });
      } catch (err) {
        console.error('Setup failed:', err);
        return interaction.reply({ content: '❌ Setup failed', ephemeral: true });
      }
    }
  }

  // Button interactions (tickets + thread buttons)
  if (interaction.isButton()) {
    
    // --- TICKET CREATION ---
    if (interaction.customId === 'create_ticket') {
      await interaction.deferReply({ ephemeral: true });

      try {
        const guild = interaction.guild;
        const member = interaction.member;
        const username = member.user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
        const short = Math.floor(Math.random() * 9000 + 1000);
        const chanName = `ticket-${username}-${short}`;

        const modRoles = guild.roles.cache.filter(role => {
            if (role.managed) return false;
            const p = role.permissions;
            return p.has(PermissionsBitField.Flags.ManageMessages) || p.has(PermissionsBitField.Flags.ModerateMembers) || p.has(PermissionsBitField.Flags.KickMembers) || p.has(PermissionsBitField.Flags.BanMembers);
        });
        const overwrites = [
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: member.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] }
        ];

        modRoles.forEach(role => {
          overwrites.push({ id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] });
        });

        let parent = null;
        try {
          const setupChan = await client.channels.fetch(SETUP_POST_CHANNEL);
          parent = setupChan.parentId || null;
        } catch {}

        const ticketChannel = await interaction.guild.channels.create({
          name: chanName,
          type: 0, 
          permissionOverwrites: overwrites,
          parent: parent,
          reason: `Ticket created by ${member.user.tag}`
        });

        await interaction.editReply({ content: `Ticket created: ${ticketChannel}`, ephemeral: true });

        try {
          const setupChan = await client.channels.fetch(SETUP_POST_CHANNEL);
          await setupChan.send(`Ticket created ${ticketChannel} — added to Tickets catalog`);
        } catch {}

        let modMention = '';
        if (modRoles.size > 0) {
          modMention = modRoles.map(r => `<@&${r.id}>`).slice(0, 5).join(' ');
        } else {
          modMention = '@moderators';
        }

        const closeRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('claim_ticket').setLabel('Claim').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('close_ticket').setLabel('Close').setStyle(ButtonStyle.Danger)
        );

        await ticketChannel.send({
          content:
`hello! So ${modMention} Will be here any minute to claim the ticket, and whoever has that role and says something in the chat will automatically claim the ticket.
If they want to close it there will be a Close button on top. When close is confirmed, the transcript will be sent to <#${TRANSCRIPT_CHANNEL_ID}>.`,
          components: [closeRow]
        });

      } catch (err) {
        console.error('create_ticket error:', err);
        return interaction.editReply({ content: '❌ Failed to create ticket.', ephemeral: true });
      }
    }

    // --- TICKET CLAIM ---
    if (interaction.customId === 'claim_ticket') {
      const isMod = interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages) || interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers) || interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers);
      if (!isMod) return interaction.reply({ content: 'Only moderators can claim tickets.', ephemeral: true });

      const ch = interaction.channel;
      if (!ch || !ch.name.startsWith('ticket-')) return interaction.reply({ content: 'This button must be used in a ticket channel.', ephemeral: true });

      const topic = ch.topic || '';
      if (topic.startsWith('claimed:')) {
        return interaction.reply({ content: 'Ticket already claimed.', ephemeral: true });
      }

      try {
        await ch.setTopic(`claimed:${interaction.user.id}`);
        await interaction.reply({ content: `✅ Ticket claimed by ${interaction.user.tag}`, ephemeral: true });
        await ch.send(`✅ Ticket claimed by <@${interaction.user.id}>`);
      } catch (err) {
        console.error('claim_ticket error:', err);
        await interaction.reply({ content: 'Failed to claim ticket', ephemeral: true });
      }
    }

    // --- TICKET CLOSE (Confirmation Prompt) ---
    if (interaction.customId === 'close_ticket') {
      const isMod = interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages) || interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers) || interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers);
      if (!isMod) return interaction.reply({ content: 'Only moderators can close tickets.', ephemeral: true });

      const ch = interaction.channel;
      if (!ch || !ch.name.startsWith('ticket-')) return interaction.reply({ content: 'This button must be used in a ticket channel.', ephemeral: true });

      const confirmRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('confirm_close_yes').setLabel('Yes, close').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('confirm_close_no').setLabel('No, keep open').setStyle(ButtonStyle.Secondary)
      );

      await interaction.reply({ content: 'Are you sure you want to close this ticket? This will delete the channel after saving transcript.', components: [confirmRow], ephemeral: true });
    }

    // --- TICKET CLOSE (Confirmed Action) ---
    if (interaction.customId === 'confirm_close_yes') {
      const isMod = interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages) || interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers) || interaction.member.permissions.has(PermissionsBitField.Flags.KickMembers);
      if (!isMod) return interaction.reply({ content: 'Only moderators can close tickets.', ephemeral: true });

      const ch = interaction.channel;
      if (!ch || !ch.name.startsWith('ticket-')) return interaction.reply({ content: 'This must be used in the ticket channel.', ephemeral: true });

      await interaction.deferReply({ ephemeral: true });

      try {
        const fetched = await ch.messages.fetch({ limit: 100 });
        const msgs = Array.from(fetched.values()).reverse(); 

        let transcript = `Transcript for ${ch.name} (closed by ${interaction.user.tag})\n\n`;
        for (const m of msgs) {
          const time = m.createdAt.toISOString();
          const author = `${m.author.tag}`;
          const content = m.content || '';
          const atts = m.attachments.map(a => a.url).join(' ');
          transcript += `[${time}] ${author}: ${content} ${atts}\n`;
        }

        const tChan = await client.channels.fetch(TRANSCRIPT_CHANNEL_ID);
        if (tChan) {
          const MAX = 1900;
          if (transcript.length <= MAX) {
            await tChan.send({ content: `📄 **Ticket closed**: ${ch.name}\nClosed by ${interaction.user.tag}\n\n${transcript}` });
          } else {
            await tChan.send({ content: `📄 **Ticket closed**: ${ch.name}\nClosed by ${interaction.user.tag}\n\nTranscript (first part):` });
            while (transcript.length > 0) {
              const part = transcript.slice(0, MAX);
              transcript = transcript.slice(MAX);
              await tChan.send(part);
            }
          }
        }

        await interaction.editReply({ content: '✅ Transcript saved. Deleting ticket channel...', ephemeral: true });
        await ch.delete('Ticket closed');
      } catch (err) {
        console.error('confirm_close_yes error:', err);
        return interaction.editReply({ content: '❌ Failed to close ticket', ephemeral: true });
      }
    }

    // --- TICKET CLOSE (Cancelled) ---
    if (interaction.customId === 'confirm_close_no') {
      return interaction.reply({ content: 'Close cancelled.', ephemeral: true });
    }
    
    // ================== THREAD BUTTONS LOGIC ==================
    if (interaction.customId === 'archive_thread' || interaction.customId === 'edit_title') {
      const thread = interaction.channel;
      
      if (!(thread instanceof ThreadChannel)) { 
        return interaction.reply({ content: "❌ Use this command inside a thread.", ephemeral: true });
      }
      
      const isThreadStarter = thread.ownerId === interaction.user.id;
      const isMod = interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages) || interaction.member.permissions.has(PermissionsBitField.Flags.ManageThreads);

      if (!isThreadStarter && !isMod) {
          return interaction.reply({ content: "❌ Only the thread creator or a moderator can use these controls.", ephemeral: true });
      }

      if (interaction.customId === 'archive_thread') {
        await thread.setArchived(true);
        return interaction.reply({ content: "✅ Archived", ephemeral: true });
      }

      if (interaction.customId === 'edit_title') {
        await interaction.reply({ content: "Send the new title in the thread. You have 30 seconds.", ephemeral: true });
        
        const filter = m => m.author.id === interaction.user.id && m.channelId === thread.id;
        const collector = thread.createMessageCollector({ filter, time: 30000, max: 1 });
        collector.on('collect', async (msg) => {
          try {
              await thread.setName(msg.content.slice(0, 100)); 
              await msg.delete();
              await interaction.followUp({ content: "✅ Title updated", ephemeral: true });
          } catch (e) {
              console.error("Failed to edit thread title:", e);
              await interaction.followUp({ content: "❌ Failed to update title (Permissions or length)", ephemeral: true });
          }
        });
      }
    }
  }
});

// ================= AUTO MODERATION + RULES =================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content;
  const lowerContent = content.toLowerCase();
  const member = message.member;
  const userId = message.author.id;
  
  // -------------------------------------------------------------
  // --- XP GAIN LOGIC (Runs before moderation checks) ---
  // -------------------------------------------------------------
  const XP_COOLDOWN_MS = 60000; // 60 seconds cooldown
  const BASE_XP = 15;
  const MAX_XP_PER_MESSAGE = 25;
  const XP_GAIN = Math.floor(Math.random() * (MAX_XP_PER_MESSAGE - BASE_XP + 1)) + BASE_XP;
  
  if (message.channel.id !== AFK_XP_EXCLUSION_CHANNEL_ID) {
      const now = Date.now();

      if (!xpCooldown.has(userId) || now > xpCooldown.get(userId)) {
          
          let xpToAward = XP_GAIN;

          if (member && member.roles.cache.has(BOOSTER_ROLE_ID)) {
              xpToAward *= 2;
          }

          await addXP(member, xpToAward, message);
          xpCooldown.set(userId, now + XP_COOLDOWN_MS);
      }
  }
  // -------------------------------------------------------------


  // -------------------------------------------------------------
  // --- AFK REMOVAL AND PING CHECK ---
  // -------------------------------------------------------------
  
  // 1. CHECK FOR RETURNING USER (If the author is currently AFK)
  if (afkStatus.has(userId)) {
      afkStatus.delete(userId); // Remove AFK status

      const returnMessage = `hello <@${userId}>! Toon your AFK has been removed <:happymissdiamond:1448752668259647619>`;
      
      try {
        const sentMessage = await message.channel.send(returnMessage);
        
        setTimeout(() => {
            sentMessage.delete().catch(e => console.log('Failed to delete AFK return message:', e));
        }, 5000);
      } catch (e) {
          console.error("Failed to send/delete AFK return message:", e);
      }
  }
  
  // 2. CHECK FOR AFK PING (If the message mentions an AFK user)
  if (message.mentions.users.size > 0) {
      message.mentions.users.forEach(async (mentionedUser) => {
          if (afkStatus.has(mentionedUser.id) && mentionedUser.id !== userId) {
              const afkData = afkStatus.get(mentionedUser.id);
              
              await message.reply({ 
                  content: `<@${mentionedUser.id}> is currently AFK: **${afkData.reason}**`,
                  allowedMentions: { repliedUser: false } 
              }).catch(e => console.log('Failed to send AFK reply:', e));
          }
      });
  }
  
  // -------------------------------------------------------------
  // --- AFK PREFIX COMMAND CHECK: ?afk [reason] (The ONLY prefix command) ---
  // -------------------------------------------------------------
  if (lowerContent.startsWith('?afk')) {
      const reason = content.slice(4).trim() || 'I am currently away.';
      
      const { isToxic } = await checkMessageToxicity(reason);
      if (isToxic) {
          await message.delete().catch(() => {});
          return message.channel.send(`❌ <@${userId}>: Your AFK reason was blocked by the safety filter.`);
      }

      afkStatus.set(userId, { reason: reason, time: Date.now() });

      try {
          await message.channel.send(`✅ <@${userId}> is now AFK. Message: **${reason}**`);
          await message.delete().catch(() => {}); 
      } catch (e) {
          console.error("Failed to execute/delete ?afk command:", e);
      }
      return; 
  }
  // -------------------------------------------------------------


  // Global Check: Identify a pure GIF link
  const isPureGIFLink = content.trim().length > 0 && 
                        (lowerContent.startsWith('http://') || lowerContent.startsWith('https://')) &&
                        (lowerContent.includes('tenor.com') || lowerContent.includes('giphy.com') || lowerContent.endsWith('.gif')) &&
                        message.attachments.size === 0; 

  // --- MANUAL WORD FILTER CHECK (FIRST LINE OF DEFENSE) ---
  const manualFilter = filterMessageManually(content);
  
  if (manualFilter.isSevere) {
      await message.delete().catch(() => {});
      try {
        if (member && member.manageable) {
            await member.timeout(60 * 60 * 1000, `Manual Severe Word Detected: ${manualFilter.matchedWord}`); 
        }
        const log = client.channels.cache.get(LOG_CHANNEL_ID);
        if (log) log.send(`🛑 **MANUAL Filter Violation (Timeout 60m)**\nUser: <@${message.author.id}>\nReason: Severe word match: ${manualFilter.matchedWord}\nContent: ||${message.content}||`);
      } catch (e) {
          console.error("Failed to apply manual severe moderation action:", e);
      }
      return; 
  }
  
  if (manualFilter.isMild) {
      await message.delete().catch(() => {});
      const log = client.channels.cache.get(LOG_CHANNEL_ID);
      if (log) log.send(`🗑️ **MANUAL Filter Violation (Deleted)**\nUser: <@${message.author.id}>\nReason: Mild word match: ${manualFilter.matchedWord}\nContent: ||${message.content}||`);
      return;
  }
  // --- END MANUAL WORD FILTER CHECK ---


  // --- AI TOXICITY CHECK (SECOND LAYER DEFENSE) ---
  const { isToxic, blockCategory } = await checkMessageToxicity(content);
  // ------------------------------------------------


  // RULE: INAPPROPRIATE RP LOCKDOWN 
  if (message.channel.id === RP_CHANNEL_ID && isToxic) {
      const category = message.guild.channels.cache.get(RP_CATEGORY_ID);
      if (category && category.type === 4) { 
          try {
              const everyoneRole = message.guild.roles.cache.find(r => r.name === '@everyone');
              if (everyoneRole) {
                  await category.permissionOverwrites.edit(everyoneRole, { ViewChannel: false });
              }
              await message.delete().catch(() => {});
              const log = client.channels.cache.get(LOG_CHANNEL_ID);
              if (log) log.send(`🔒 **RP Category Lockdown**\nCategory <#${RP_CATEGORY_ID}> locked down due to inappropriate RP attempt by <@${message.author.id}> in <#${RP_CHANNEL_ID}>.\nHopper AI Reason: ${blockCategory}\nMessage: ||${message.content}||`);
              return; 
          } catch (e) {
              console.error("Failed to lock RP category:", e);
              message.channel.send(`⚠️ WARNING: Inappropriate content detected in <#${RP_CHANNEL_ID}>. Category lockdown failed. Manually review <@${message.author.id}>.`);
          }
      }
  }

  // RULE 5: INAPPROPRIATE USERNAME CHECK (on message send - always runs)
  if (member) {
    await moderateNickname(member);
  }
   
  // --- START GENERAL MODERATION BLOCK ---
  if (message.channel.id !== TARGET_CHANNEL_ID && !isPureGIFLink) {
    
    // --- AI MODERATION ACTION (TIMEOUT FOR GENERAL TOXICITY/SLURS MISSED BY MANUAL FILTER) ---
    if (isToxic) {
      await message.delete().catch(() => {});
      
      try {
        if (member && member.manageable) {
            await member.timeout(30 * 60 * 1000, `Hopper AI Detected Severe Violation: ${blockCategory}`).catch(() => {}); 
        }
        
        const log = client.channels.cache.get(LOG_CHANNEL_ID);
        if (log) log.send(`🚨 **Hopper AI Filter Violation (Timeout 30m)**\nUser: <@${message.author.id}>\nAI Reason: ${blockCategory}\nContent: ||${message.content}||`);
      } catch (e) {
          console.error("Failed to apply AI moderation action:", e);
      }
      return;
    }
    
    // RULE: ANTI-HARASSMENT / ANTI-TROLLING (MUTE) - Legacy Regex
    const explicitTrollHarassRegex = /(^|\s)(mute|ban|harass|troll|bullying)\s+(that|him|her|them)\s+(\S+|$)|(you\s+(are|re)\s+(a|an)?\s+(troll|bully|harasser))/i;

    if (explicitTrollHarassRegex.test(lowerContent)) {
        await message.delete().catch(() => {});

        if (member && member.manageable) {
            try {
                await member.timeout(60 * 60 * 1000, "Trolling/Harassment detected"); 
                
                const log = client.channels.cache.get(LOG_CHANNEL_ID);
                if (log) log.send(`🛑 **Harassment/Trolling Mute**\nUser: <@${message.author.id}> timed out for 60m.\nContent: ||${message.content}||\nReason: Detected explicit command or statement of harassment/trolling/bullying.`);
                
            } catch (e) {
                console.error("Failed to mute/log troll:", e);
            }
        }
        return;
    }
    
    // RULE: SELECTIVE ADVERTISING
    const externalAdRegex = /(subscribe to my|go check out my|new video on|follow my insta|patreon|onlyfans|youtube\b|twitch\b|facebook\b|tiktok\b)/i;
    const allowedAds = /(stormy and hops|stormy & hops)/i; 

    if (externalAdRegex.test(lowerContent) && !allowedAds.test(lowerContent)) {
        await message.delete().catch(() => {});
        const log = client.channels.cache.get(LOG_CHANNEL_ID);
        if (log) log.send(`📢 **Advertising Deleted**\nUser: <@${message.author.id}>\nContent: ||${message.content}||\nReason: External promotion/subscription attempt.`);
        return;
    }
    
    // RULE: POLITICAL CONTENT SOFT FILTER
    const politicalKeywords = ['politics', 'government', 'election', 'congress', 'biden', 'trump', 'conservative', 'liberal', 'democracy', 'republican', 'democrat'];
    let politicalCount = 0;
    for (const keyword of politicalKeywords) {
        if (lowerContent.includes(keyword)) {
            politicalCount++;
        }
    }

    if (politicalCount >= 4) {
        await message.delete().catch(() => {});
        const log = client.channels.cache.get(LOG_CHANNEL_ID);
        if (log) log.send(`🗳️ **Political Content Filter**\nUser: <@${message.author.id}>\nContent: ||${message.content}||\nReason: Excessive political content (Count: ${politicalCount}).`);
        return;
    }


    // RULE 7: UNDERAGE CHECK (Admission of being under 13)
    const underageRegex = /\b(i|i'm|im)\s+(am\s+)?(under\s+13|1[0-2]|[1-9])\b/i;
    if (underageRegex.test(lowerContent)) {
      await message.delete().catch(() => {});
      const log = client.channels.cache.get(LOG_CHANNEL_ID);
      if (log) log.send(`👶 **Underage Admission Detected**\nUser: <@${message.author.id}>\nContent: ||${message.content}||\nAction: Deleted immediately.`);
      return;
    }

    // RULE 4 & 6: Advertising / Scam / Links
    const isAdOrScam = 
      lowerContent.includes('discord.gg/') || 
      lowerContent.includes('free nitro') ||
      lowerContent.includes('steam gift') ||
      lowerContent.includes('crypto') ||
      lowerContent.includes('bitcoin');

    if (isAdOrScam) {
      await message.delete().catch(() => {});
      const log = client.channels.cache.get(LOG_CHANNEL_ID);
      if (log) log.send(`🔗 **Link/Scam Deleted**\nUser: <@${message.author.id}>\nContent: ||${message.content}||`);
      return;
    }

    // RULE 10: No Doxing (Basic IP detection)
    const ipRegex = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;
    if (ipRegex.test(lowerContent)) {
      await message.delete().catch(() => {});
      const log = client.channels.cache.get(LOG_CHANNEL_ID);
      if (log) log.send(`⚠️ **Possible Dox Attempt**\nUser: <@${message.author.id}>\nContent: ||${message.content}||`);
      return;
    }
  } // --- END GENERAL MODERATION BLOCK ---


  // IMAGE ONLY CHANNEL THREAD SYSTEM 
  if (message.channel.id === TARGET_CHANNEL_ID) {
    
    // Check 1: Attachments (images/videos uploaded)
    const hasAttachment = message.attachments.size > 0;

    // Check 2: Valid Media Links
    const isMediaLink = isPureGIFLink || 
        lowerContent.includes('imgur.com') || 
        lowerContent.includes('.png') || 
        lowerContent.includes('.jpe') || 
        lowerContent.includes('.webp') ||
        lowerContent.includes('.mp4') ||
        lowerContent.includes('.mov');

    // If it has NEITHER an attachment NOR a valid media link, it's pure text or an invalid link, so delete it.
    if (!hasAttachment && !isMediaLink) {
      await message.delete().catch(() => {});
      return;
    }

    try { await message.react('✨'); } catch {}

    let thread;
    try {
      // Create a thread on the image message
      thread = await message.startThread({
        name: `Thread: ${message.author.username}`,
        autoArchiveDuration: 60,
        reason: 'Automatic thread creation for image post'
      });
    } catch { return; }

    try {
      // Send thread control buttons
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('archive_thread').setLabel('Archive Thread').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('edit_title').setLabel('Edit Title').setStyle(ButtonStyle.Primary)
      );
      await thread.send({ content: "Thread controls:", components: [row] });
    } catch { }
  }
});

// ================= RULE 11: JOIN/LEAVE TROLLING =================
client.on('guildMemberAdd', async (member) => {
  await moderateNickname(member);

  const userId = member.id;
  const now = Date.now();
   
  const userData = joinTracker.get(userId) || { count: 0, lastJoin: 0 };

  if (now - userData.lastJoin > 15 * 60 * 1000) {
    userData.count = 0;
  }

  userData.count++;
  userData.lastJoin = now;
  joinTracker.set(userId, userData);

  if (userData.count >= 10) {
    try {
      await member.ban({ reason: 'Rule 11: Excessive Join/Leave Trolling' });
      const log = client.channels.cache.get(LOG_CHANNEL_ID);
      if (log) log.send(`🔨 **Auto-Ban (Anti-Troll)**\nUser: ${member.user.tag}\nReason: Joined ${userData.count} times rapidly.`);
      joinTracker.delete(userId);
    } catch (err) {
      console.error('Failed to ban troll:', err);
    }
  } else if (userData.count >= 6) {
    const log = client.channels.cache.get(LOG_CHANNEL_ID);
    if (log) log.send(`⚠️ **Troll Warning**\nUser: ${member.user.tag} has joined ${userData.count} times recently.`);
  }
});

// ================= LOGIN + SERVER (For Render) =================
client.login(process.env.TOKEN);

// This creates a minimal web server required by Render's free tier to keep the bot running.
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running!");
}).listen(PORT, () => console.log(`🌐 Server running on ${PORT}`));
