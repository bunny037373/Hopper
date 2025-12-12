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
  ThreadChannel, // Import ThreadChannel for type checking
} = require('discord.js');
const http = require('http');

// --- AI Import ---
const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai');
// -----------------

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

// ====================== CRITICAL CONFIGURATION: REPLACE THESE ======================

// ** CRITICAL: REPLACE THIS WITH THE DIRECT LINK TO STORMY'S RP IMAGE **
const STORMY_IMAGE_URL = 'YOUR_LINK_TO_STORMY_RP_IMAGE.png'; 

// --- DISCORD IDs ---
// GET THESE IDs FROM YOUR SERVER (User Settings > Advanced > Developer Mode)
const GUILD_ID = '1369477266958192720';           // <<--- REPLACE with your Server ID
const TARGET_CHANNEL_ID = '1415134887232540764'; // <<--- REPLACE with your Image-Only Channel ID
const LOG_CHANNEL_ID = '1414286807360602112';    // <<--- REPLACE with your Moderation Log Channel ID
const TRANSCRIPT_CHANNEL_ID = '1414354204079689849';// <<--- REPLACE with your Ticket Transcript Channel ID   
const SETUP_POST_CHANNEL = '1445628128423579660';   // <<--- REPLACE with channel ID where the "Create Ticket" button is posted
const MUTE_ROLE_ID = '1446530920650899536';        // <<--- REPLACE with your Mute Role ID         
const RP_CHANNEL_ID = '1421219064985948346';      // <<--- REPLACE with your Roleplay Channel ID
const RP_CATEGORY_ID = '1446530920650899536';      // <<--- REPLACE with your Roleplay Category ID (for lockdown)

// ====================== END CRITICAL CONFIGURATION ======================


// ** AVATAR URLS (Kept for consistency, but bot's own avatar is used for Hops) **
const STORMY_AVATAR_URL = 'https://i.imgur.com/r62Y0c7.png'; 
const HOPS_AVATAR_URL = 'https://i.imgur.com/r62Y0c7.png';     

// NICKNAME SCAN INTERVAL (5 seconds = 5000 milliseconds)
const NICKNAME_SCAN_INTERVAL = 5 * 1000;

const HELP_MESSAGE = `hello! Do you need help?
Please go to https://discord.com/channels/${GUILD_ID}/1414304297122009099
and for more assistance please use
https://discord.com/channels/${GUILD_ID}/1414352972304879626
channel to create a more helpful environment to tell a mod`;


// --- ADDED CONSTANTS FOR AI ---
// Note: Midnight PT (Gemini API reset time) is 3:00 AM EST.
const RESET_TIME = '3:00 AM EST';

// Fandom links + Placeholder for Official Links for AI context
const CONTEXT_LINKS = `
Use the following external links and information as knowledge resources:

- https://youtube.com/@stormyandhops
- https://youtube.com/@bunnytoonsstudios
- https://stormyandhops.netlify.app/episode
- https://stormyandhops.netlify.app/credits
- https://stormyandhops.netlify.app/qna
- https://stormyandhops.netlify.app/characters
- https://stormy-and-hops.fandom.com/wiki/Stormy_Bunny
- https://stormy-and-hops.fandom.com/wiki/Hops_Bunny
- https://stormy-and-hops.fandom.com/wiki/Scarlet_bunny
- https://stormy-and-hops.fandom.com/wiki/Oscar_the_crazy_scientist
- https://stormy-and-hops.fandom.com/wiki/Preston_(The_Big_Dumb_Rock)
- https://stormy-and-hops.fandom.com/wiki/Mr._Luck
- https://stormy-and-hops.fandom.com/wiki/Mrs._diamond
- https://stormy-and-hops.fandom.com/wiki/Scout_Bunny
- https://stormy-and-hops.fandom.com/wiki/Katie_The_Deer
- https://stormy-and-hops.fandom.com/wiki/Paul_The_Hyper_Cat
- https://stormy-and-hops.fandom.com/wiki/Cloudy_Kitty
- https://stormy-and-hops.fandom.com/wiki/Jin_the_panda
`;
// ------------------------------

// ====================== STATIC MODERATION LISTS ======================

// 0. ALLOWED WORDS (WHITELIST)
const ALLOWED_WORDS = [
  "assist", "assistance", "assistant", "associat",
  "class", "classic", "glass", "grass", "pass", "bass", "compass",
  "hello", "shell", "peacock", "cocktail", "babcock"
];

// 1. WORDS THAT TRIGGER MESSAGE DELETION ONLY (Common swearing)
const MILD_BAD_WORDS = [
  "fuck", "f*ck", "f**k", "f-ck", "fck", "fu-", "f-", "f*cking", "fucking",
  "shit", "s*it", "s**t", "sh!t",
  "ass", "bitch", "hoe", "whore", "slut", "cunt",
  "dick", "pussy", "cock", "bastard", "sexy",
];

// 2. WORDS THAT TRIGGER A TIMEOUT (Slurs, threats, hate speech, extreme trolling)
const SEVERE_WORDS = [
  "nigger", "nigga", "niga", "faggot", "fag", "dyke", "tranny", "chink", "kike", "paki", "gook", "spic", "beaner", "coon",
  "retard", "spastic", "mong", "autist",
  "kys", "kill yourself", "suicide", "rape", "molest",
  "hitler", "nazi", "kkk",
  "joke about harassing", "troll joke", "harassment funny", "trolling funny", "trollin", "troller"
];

// Combine both lists for the general filter used for nicknames and /say checks
const BAD_WORDS = [...MILD_BAD_WORDS, ...SEVERE_WORDS];

// Map for detecting Leetspeak bypasses
const LEET_MAP = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's', '!': 'i', '(': 'c', '+': 't'
};
// ===================================================================

/**
 * Normalizes text by applying the LEET_MAP and removing non-alphanumeric characters.
 * @param {string} text The input text.
 * @returns {string} The normalized text.
 */
function processTextForFilter(text) {
    let normalized = text.toLowerCase();

    // 1. Apply Leetspeak map
    for (const [leetChar, trueChar] of Object.entries(LEET_MAP)) {
        normalized = normalized.split(leetChar).join(trueChar);
    }

    // 2. Remove all remaining non-alphanumeric characters (keeps letters and numbers)
    // This is crucial for catching "f.u.c.k" or "f*u*c*k"
    normalized = normalized.replace(/[^a-z0-9]/g, '');

    return normalized;
}

/**
 * Checks a string against the MILD_BAD_WORDS and SEVERE_WORDS lists,
 * considering the ALLOWED_WORDS (whitelist) and Leetspeak.
 * @param {string} text The message text to check.
 * @returns {{isBlocked: boolean, severity: 'mild' | 'severe' | 'none', word: string}}
 */
function checkStaticFilter(text) {
    if (!text) return { isBlocked: false, severity: 'none', word: '' };
    
    // Process the text once (lowercase + leetspeak substitution + removal of special chars)
    const processedText = processTextForFilter(text);
    
    // --- 1. Check for SEVERE words (Highest Priority) ---
    for (const severeWord of SEVERE_WORDS) {
        // We only check if the processed text *contains* the severe word
        if (processedText.includes(severeWord)) {
            // Check if it's NOT part of an explicitly ALLOWED word
            let isAllowed = false;
            for (const allowedWord of ALLOWED_WORDS) {
                if (processedText.includes(allowedWord) && allowedWord.includes(severeWord)) {
                    isAllowed = true;
                    break;
                }
            }
            if (!isAllowed) {
                return { isBlocked: true, severity: 'severe', word: severeWord };
            }
        }
    }

    // --- 2. Check for MILD words ---
    for (const mildWord of MILD_BAD_WORDS) {
        if (processedText.includes(mildWord)) {
            // Check if it's NOT part of an explicitly ALLOWED word
            let isAllowed = false;
            for (const allowedWord of ALLOWED_WORDS) {
                if (processedText.includes(allowedWord) && allowedWord.includes(mildWord)) {
                    isAllowed = true;
                    break;
                }
            }
            if (!isAllowed) {
                return { isBlocked: true, severity: 'mild', word: mildWord };
            }
        }
    }

    return { isBlocked: false, severity: 'none', word: '' };
}

// ================= AI INITIALIZATION & CONFIGURATION =================

// Configure Safety Settings: This is the key to AI-based content moderation.
// We set a very strict threshold (BLOCK_LOW_AND_ABOVE) for Hate Speech and Harassment
// to ensure the bot catches slurs and toxic language with high sensitivity.
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

/**
 * Uses Gemini to analyze a message for toxic content (slurs, harassment).
 * * @param {string} text The message content to check.
 * @returns {Promise<{isToxic: boolean, blockCategory: string}>}
 */
async function checkMessageToxicity(text) {
  if (text.length === 0) return { isToxic: false, blockCategory: 'None' };
  
  try {
    const response = await ai.models.generateContent({
      model: aiModel,
      contents: [{ role: "user", parts: [{ text: `Analyze the following user message for hate speech, slurs, harassment, or other inappropriate content: "${text}"` }] }],
      safetySettings: safetySettings,
    });

    // The Gemini API response will be blocked if any of the custom safety 
    // settings (like BLOCK_LOW_AND_ABOVE for Hate Speech) are triggered.
    if (response.candidates && response.candidates.length > 0) {
        const candidate = response.candidates[0];
        
        if (candidate.finishReason === 'SAFETY') {
            const blockedCategory = candidate.safetyRatings.map(r => {
                // Check if the rating shows the content was blocked for this category
                if (r.probability === 'MEDIUM' || r.probability === 'HIGH' || r.probability === 'LOW') {
                    // This is a simple way to approximate which filter caused the block
                    return r.category;
                }
                return null;
            }).filter(Boolean).join(' & ');

            return { isToxic: true, blockCategory: blockedCategory || 'Unknown' };
        }
    }
    // If the response is not blocked and content is generated, it's considered safe.
    return { isToxic: false, blockCategory: 'None' };

  } catch (error) {
    // This catches API errors (like rate limits or key issues)
    console.error('Gemini Moderation API Error:', error);
    // If there is an error, default to SAFE to avoid false positives and
    // keep the bot running, but log the issue.
    return { isToxic: false, blockCategory: 'API_Error' }; 
  }
}

// ================= END AI INITIALIZATION & CONFIGURATION =================

// ================= JOIN/LEAVE TRACKER =================
const joinTracker = new Map(); 

// Helper: Moderate Nickname
async function moderateNickname(member) {
  // Use the combined BAD_WORDS list for a clean nickname environment.
  const displayName = member.displayName;
  // Note: For nicknames, we only check for a block, as the intention is always to remove bad words from display.
  const { isBlocked, word } = checkStaticFilter(displayName); 

  if (isBlocked) {
    try {
      if (member.manageable) {
        await member.setNickname("[moderated nickname by hopper]");
        
        const log = member.guild.channels.cache.get(LOG_CHANNEL_ID);
        if (log) log.send(`🛡️ **Nickname Moderated**\nUser: <@${member.id}>\nOld Name: ||${member.user.username}||\nReason: Inappropriate Username (Static Filter: ${word})`);
        return true; 
      }
    } catch (err) {
      console.error(`Failed to moderate nickname for ${member.user.tag}:`, err);
      return false;
    }
  }
  return false; 
}


/**
 * RECURRING FUNCTION: Checks all nicknames in the guild repeatedly.
 */
async function runAutomatedNicknameScan(guild) {
    if (!guild) return; 
    let moderatedCount = 0;
    
    try {
        const members = await guild.members.fetch(); 
        
        for (const [id, member] of members) {
            // Skip bots
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

/**
 * Starts the recurring nickname scan.
 */
function startAutomatedNicknameScan(guild) {
    // Run once immediately
    runAutomatedNicknameScan(guild); 
    
    // Set up interval for recurring runs
    setInterval(() => {
        runAutomatedNicknameScan(guild);
    }, NICKNAME_SCAN_INTERVAL);

    console.log(`Automated nickname scan started, running every ${NICKNAME_SCAN_INTERVAL / 1000} seconds.`);
}


// ================= READY =================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
    ]
});

// Cache for cooldown tracking
const userCooldowns = new Map();
const COOLDOWN_SECONDS = 60; 

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // --- ANTI-INVITE PROTECTION (ON BOOT) ---
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
  // ----------------------------------------

  // Set bot presence
  client.user.setPresence({
    activities: [{ name: 'hopping all around Toon Springs', type: 0 }],
    status: 'online'
  });

  // START RECURRING NICKNAME CHECK
  const guild = client.guilds.cache.get(GUILD_ID);
  if (guild) {
      startAutomatedNicknameScan(guild); 
  }


  // Register slash commands
  const commands = [
    new SlashCommandBuilder()
      .setName('say')
      .setDescription('Make the bot say something anonymously')
      .addStringOption(opt => opt.setName('text').setDescription('Text for the bot to say').setRequired(true)),

    // --- NEW AI COMMAND (/ask) ---
    new SlashCommandBuilder()
      .setName('ask')
      .setDescription('search for anything Stormy and hops questions you want to know')
      .addStringOption(opt => opt.setName('prompt').setDescription('Your question for the AI').setRequired(true)),
    // ----------------------
      
    new SlashCommandBuilder()
      .setName('sayrp')
      .setDescription('Speak as a character (uses bot to send message)')
      .addStringOption(opt => 
        opt.setName('character')
          .setDescription('The character to speak as (Stormy or Hops)')
          .setRequired(true)
          .addChoices(
            { name: 'Stormy', value: 'stormy' },
            { name: 'Hops', value: 'hops' }
          ))
      .addStringOption(opt => 
        opt.setName('message')
          .setDescription('The message to send')
          .setRequired(true)),

    new SlashCommandBuilder().setName('help').setDescription('Get help'),
    new SlashCommandBuilder().setName('serverinfo').setDescription('Get server information'),

    // Mod Commands
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
    // Register commands globally for this specific guild
    await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    console.log('✅ Slash commands registered.');
  } catch (err) {
    console.error('Failed to register commands:', err);
  }
});

// ================= ANTI-INVITE PROTECTION (EVENT) =================
client.on('guildCreate', async (guild) => {
    // If the bot is invited to a server that is NOT the GUILD_ID, leave it.
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

// ================= SLASH COMMANDS =================
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    // Check if the user is a moderator based on permissions
    const isMod = interaction.member.permissions.has(PermissionsBitField.Flags.ModerateMembers) || interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages);

    // --- MOD ONLY COMMANDS CHECK ---
    if (['kick','ban','unban','timeout','setup'].includes(interaction.commandName) && !isMod) {
      return interaction.reply({ content: '❌ Mods only', ephemeral: true });
    }
    
    // --- COMMAND LOGIC ---

    if (interaction.commandName === 'say') {
      const text = interaction.options.getString('text');
      
      // --- STATIC BAD WORD CHECK (NEW LOGIC) ---
      const { isBlocked, severity, word } = checkStaticFilter(text);
      if (isBlocked) {
          const log = client.channels.cache.get(LOG_CHANNEL_ID);
          if (log) log.send(`🚨 **Static Filter Violation (/say)**\nUser: <@${interaction.user.id}>\nContent: ||${text}||\nReason: Static bad word detected (Severity: ${severity}, Word: ${word}).`);
          return interaction.reply({ content: `❌ That message violates the static bad word filter (word: ${word}).`, ephemeral: true });
      }
      // --- END STATIC BAD WORD CHECK ---
      
      // Use AI for filter check before sending
      const { isToxic } = await checkMessageToxicity(text);
      if (isToxic) return interaction.reply({ content: "❌ That message violates the AI content filter.", ephemeral: true });
      
      await interaction.channel.send(text);
      return interaction.reply({ content: "✅ Sent anonymously", ephemeral: true });
    }
    
    // --- AI COMMAND LOGIC ---
    if (interaction.commandName === 'ask') {
        const userId = interaction.user.id;
        const now = Date.now();
        const lastUsed = userCooldowns.get(userId);
        
        // --- COOLDOWN CHECK ---
        if (lastUsed && now < lastUsed + COOLDOWN_SECONDS * 1000) {
            const remainingSeconds = Math.ceil((lastUsed + COOLDOWN_SECONDS * 1000 - now) / 1000);
            
            // --- CUSTOM COOLDOWN MESSAGE with EMOJIS ---
            return interaction.reply({ 
                content: `<:scaredcloudy:1448751027950977117> uh-oh. The search Toon is about to expire and reset until ${RESET_TIME} and after that you can use it again. You must wait **${remainingSeconds} seconds** before using \`/ask\` again.`, 
                ephemeral: true 
            });
            // ---------------------------------------------
        }
        
        // Set cooldown before deferring
        userCooldowns.set(userId, now);

        // Defer the reply as AI generation can take a moment
        await interaction.deferReply(); 
        const prompt = interaction.options.getString('prompt');
        
        // --- STATIC BAD WORD CHECK (NEW LOGIC) ---
        const { isBlocked: promptIsBlocked, severity: promptSeverity, word: promptWord } = checkStaticFilter(prompt);
        if (promptIsBlocked) {
            const log = client.channels.cache.get(LOG_CHANNEL_ID);
            if (log) log.send(`🚨 **Static Filter Violation (/ask)**\nUser: <@${interaction.user.id}>\nPrompt: ||${prompt}||\nReason: Static bad word detected (Severity: ${promptSeverity}, Word: ${promptWord}).`);
            return interaction.editReply(`❌ Your request was blocked by the static bad word filter (word: ${promptWord}).`);
        }
        // --- END STATIC BAD WORD CHECK ---

        // Check the prompt for AI toxicity before processing it
        const { isToxic: promptIsToxic } = await checkMessageToxicity(prompt);
        if (promptIsToxic) {
             return interaction.editReply('❌ Your request was blocked by the safety filter. Please rephrase your question.');
        }

        try {
            const result = await ai.models.generateContent({
                model: aiModel,
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                // The safety settings here will block the *output* if it's unsafe.
                safetySettings: safetySettings, 
                // ADDED: Configuration to include the CONTEXT_LINKS in the system instruction
                config: {
                    systemInstruction: `You are a helpful assistant. ${CONTEXT_LINKS}`,
                },
            });

            const responseText = result.text.trim();

            // Discord has a 2000 character limit
            if (responseText.length > 2000) {
                // Split the response and send in multiple messages or trim
                const shortenedResponse = responseText.substring(0, 1900) + '... (truncated)';
                await interaction.editReply(`🤖 **AI Response (Truncated):**\n\n${shortenedResponse}`);
            } else {
                await interaction.editReply(`🤖 **AI Response:**\n\n${responseText}`);
            }
        } catch (error) {
            // Check if the error is due to an output block
            if (error.message && error.message.includes('SAFETY')) {
                await interaction.editReply('❌ My generated response was blocked by the safety filter. Please try a different prompt.');
            } else {
                console.error('Gemini API Error:', error);
                // CUSTOM ERROR MESSAGE with EMOJIS
                const customErrorMessage = `<:scaredcloudy:1448751027950977117> I had trouble connecting to information please wait until ${RESET_TIME} until I fully reset and you can get more information <:heartkatie:1448751305756639372>`;
                await interaction.editReply(customErrorMessage);
            }
        }
        return;
    }
    // -----------------------------

    if (interaction.commandName === 'sayrp') {
      const character = interaction.options.getString('character');
      const message = interaction.options.getString('message');
      
      // --- STATIC BAD WORD CHECK (NEW LOGIC) ---
      const { isBlocked, severity, word } = checkStaticFilter(message);
      if (isBlocked) {
          const log = client.channels.cache.get(LOG_CHANNEL_ID);
          if (log) log.send(`🚨 **Static Filter Violation (/sayrp)**\nUser: <@${interaction.user.id}>\nContent: ||${message}||\nReason: Static bad word detected (Severity: ${severity}, Word: ${word}).`);
          return interaction.reply({ content: `❌ That message violates the static bad word filter (word: ${word}) and cannot be sent.`, ephemeral: true });
      }
      // --- END STATIC BAD WORD CHECK ---

      // Use AI for filter check before sending
      const { isToxic } = await checkMessageToxicity(message);
      if (isToxic) return interaction.reply({ content: "❌ That message violates the AI content filter and cannot be sent.", ephemeral: true });
      
      if (interaction.channel.id !== RP_CHANNEL_ID) return interaction.reply({ content: `❌ This command can only be used in the <#${RP_CHANNEL_ID}> channel.`, ephemeral: true });


      let contentToSend = '';
      let replyContent = '';
      let fileAttachment = null; 

      if (character === 'stormy') {
        contentToSend = `**Stormy Bunny:** ${message}`;
        replyContent = `✅ Message sent as **Stormy**!`;
        
        // Attach image only if the URL is set correctly
        if (STORMY_IMAGE_URL && !STORMY_IMAGE_URL.includes('YOUR_LINK')) {
            fileAttachment = [{ attachment: STORMY_IMAGE_URL, name: 'stormy_rp_image.png' }];
        } else {
            replyContent += "\n⚠️ **NOTE:** Stormy's image URL placeholder is still set. The image will not be attached until you replace 'YOUR_LINK_TO_STORMY_RP_IMAGE.png' with a real URL in the CONFIG.";
        }

      } else if (character === 'hops') {
        contentToSend = `**Hops (Bot):** ${message}`;
        replyContent = `✅ Message sent as **Hops**!`;
      } else {
        return interaction.reply({ content: "Invalid character selected.", ephemeral: true });
      }

      try {
        await interaction.channel.send({
          content: contentToSend,
          files: fileAttachment ? fileAttachment : [],
          // Disable mentions in the message
          allowedMentions: { parse: [] }
        });
        
        // Reply privately to the user
        await interaction.reply({ content: replyContent, ephemeral: true });

      } catch (error) {
        console.error('Failed to send RP message:', error);
        await interaction.reply({ content: '❌ Failed to send RP message. Check bot permissions.', ephemeral: true });
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
    
    // --- TICKET CREATION, CLAIM, CLOSE LOGIC (omitted for brevity) ---
    // ... [Your existing ticket logic] ...

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
          // Deny everyone from viewing
          { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          // Allow ticket creator to view/send
          { id: member.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
          // Allow bot to manage
          { id: client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageChannels, PermissionsBitField.Flags.ReadMessageHistory] }
        ];

        // Allow mod roles to view/manage
        modRoles.forEach(role => {
          overwrites.push({ id: role.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageMessages] });
        });

        // Try to set the category to the same as the setup channel
        let parent = null;
        try {
          const setupChan = await client.channels.fetch(SETUP_POST_CHANNEL);
          parent = setupChan.parentId || null;
        } catch {}

        const ticketChannel = await interaction.guild.channels.create({
          name: chanName,
          type: 0, // Text channel
          permissionOverwrites: overwrites,
          parent: parent,
          reason: `Ticket created by ${member.user.tag}`
        });

        await interaction.editReply({ content: `Ticket created: ${ticketChannel}`, ephemeral: true });

        // Send a notification to the setup channel
        try {
          const setupChan = await client.channels.fetch(SETUP_POST_CHANNEL);
          await setupChan.send(`Ticket created ${ticketChannel} — added to Tickets catalog`);
        } catch {}

        // Mention up to 5 mod roles
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
        // Use channel topic to mark as claimed
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
        // Fetch last 100 messages for transcript
        const fetched = await ch.messages.fetch({ limit: 100 });
        const msgs = Array.from(fetched.values()).reverse(); // Reverse for chronological order

        let transcript = `Transcript for ${ch.name} (closed by ${interaction.user.tag})\n\n`;
        for (const m of msgs) {
          const time = m.createdAt.toISOString();
          const author = `${m.author.tag}`;
          const content = m.content || '';
          const atts = m.attachments.map(a => a.url).join(' ');
          transcript += `[${time}] ${author}: ${content} ${atts}\n`;
        }

        // Send transcript to the dedicated channel
        const tChan = await client.channels.fetch(TRANSCRIPT_CHANNEL_ID);
        if (tChan) {
          const MAX = 1900;
          if (transcript.length <= MAX) {
            await tChan.send({ content: `📄 **Ticket closed**: ${ch.name}\nClosed by ${interaction.user.tag}\n\n${transcript}` });
          } else {
            // Split long transcripts
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
  }
});

// ================= AUTO MODERATION + RULES =================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const content = message.content;
  const lowerContent = content.toLowerCase();
  const member = message.member;

  // Global Check: Identify a pure GIF link
  const isPureGIFLink = content.trim().length > 0 && 
                        (lowerContent.startsWith('http://') || lowerContent.startsWith('https://')) &&
                        (lowerContent.includes('tenor.com') || lowerContent.includes('giphy.com') || lowerContent.endsWith('.gif')) &&
                        message.attachments.size === 0; 

  // --- STATIC BAD WORD FILTER (FIRST LINE OF DEFENSE - NEW LOGIC) ---
  const { isBlocked, severity, word } = checkStaticFilter(content);

  if (isBlocked) {
      await message.delete().catch(() => {});
      const log = client.channels.cache.get(LOG_CHANNEL_ID);
      
      if (severity === 'severe') {
          // SEVERE: Timeout for 60 minutes
          if (member && member.manageable) {
              await member.timeout(60 * 60 * 1000, `Severe Static Bad Word Filter Violation: ${word}`).catch(() => {}); 
          }
          if (log) log.send(`🚨 **Static Filter Violation (SEVERE: Timeout 60m)**\nUser: <@${message.author.id}>\nWord: ||${word}||\nContent: ||${message.content}||\nReason: Severe bad word detected by static filter.`);
      } else if (severity === 'mild') {
          // MILD: Delete only
          if (log) log.send(`⚠️ **Static Filter Violation (MILD: Deleted)**\nUser: <@${message.author.id}>\nWord: ||${word}||\nContent: ||${message.content}||\nReason: Mild bad word detected by static filter.`);
      }
      return; // Stop processing after static block
  }
  // --- END STATIC BAD WORD FILTER ---


  // --- AI TOXICITY CHECK (Second line of defense) ---
  const { isToxic, blockCategory } = await checkMessageToxicity(content);
  // --------------------------------------------------


  // RULE: INAPPROPRIATE RP LOCKDOWN 
  if (message.channel.id === RP_CHANNEL_ID && isToxic) {
      const category = message.guild.channels.cache.get(RP_CATEGORY_ID);
      // Check if it's actually a category (type 4)
      if (category && category.type === 4) { 
          try {
              const everyoneRole = message.guild.roles.cache.find(r => r.name === '@everyone');
              if (everyoneRole) {
                  // Deny @everyone view access
                  await category.permissionOverwrites.edit(everyoneRole, { ViewChannel: false });
              }
              await message.delete().catch(() => {});
              const log = client.channels.cache.get(LOG_CHANNEL_ID);
              if (log) log.send(`🔒 **RP Category Lockdown**\nCategory <#${RP_CATEGORY_ID}> locked down due to inappropriate RP attempt by <@${message.author.id}> in <#${RP_CHANNEL_ID}>.\nAI Reason: ${blockCategory}\nMessage: ||${message.content}||`);
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
    
    // --- AI MODERATION ACTION ---
    if (isToxic) {
      await message.delete().catch(() => {});
      
      try {
        // If the message is flagged by the AI, we treat it as a Severe Violation (Slur/Harassment)
        if (member && member.manageable) {
            // Timeout for 30 minutes
            await member.timeout(30 * 60 * 1000, `AI Detected Severe Violation: ${blockCategory}`).catch(() => {}); 
        }
        
        const log = client.channels.cache.get(LOG_CHANNEL_ID);
        if (log) log.send(`🚨 **AI Filter Violation (Timeout 30m)**\nUser: <@${message.author.id}>\nAI Reason: ${blockCategory}\nContent: ||${message.content}||`);
      } catch (e) {
          console.error("Failed to apply AI moderation action:", e);
      }
      return;
    }
    // --- END AI MODERATION ACTION ---


    // RULE: ANTI-HARASSMENT / ANTI-TROLLING (MUTE) - KEPT FOR EXPLICIT COMMANDS
    const explicitTrollHarassRegex = /(^|\s)(mute|ban|harass|troll|bullying)\s+(that|him|her|them)\s+(\S+|$)|(you\s+(are|re)\s+(a|an)?\s+(troll|bully|harasser))/i;

    if (explicitTrollHarassRegex.test(lowerContent)) {
        await message.delete().catch(() => {});

        const muteRole = message.guild.roles.cache.get(MUTE_ROLE_ID);
        if (member && member.manageable) {
            try {
                // Timeout for 60 minutes
                await member.timeout(60 * 60 * 1000, "Trolling/Harassment detected"); 
                
                const log = client.channels.cache.get(LOG_CHANNEL_ID);
                if (log) log.send(`🛑 **Harassment/Trolling Mute**\nUser: <@${message.author.id}> timed out for 60m.\nContent: ||${message.content}||\nReason: Detected explicit command or statement of harassment/trolling/bullying.`);
                
            } catch (e) {
                console.error("Failed to mute/log troll:", e);
            }
        }
        return;
    }
    
    // RULE: SELECTIVE ADVERTISING (Keep static check, as AI is focused on toxicity)
    const externalAdRegex = /(subscribe to my|go check out my|new video on|follow my insta|patreon|onlyfans|youtube\b|twitch\b|facebook\b|tiktok\b)/i;
    const allowedAds = /(stormy and hops|stormy & hops)/i; // Bot's own promotion

    if (externalAdRegex.test(lowerContent) && !allowedAds.test(lowerContent)) {
        await message.delete().catch(() => {});
        const log = client.channels.cache.get(LOG_CHANNEL_ID);
        if (log) log.send(`📢 **Advertising Deleted**\nUser: <@${message.author.id}>\nContent: ||${message.content}||\nReason: External promotion/subscription attempt.`);
        return;
    }
    
    // RULE: POLITICAL CONTENT SOFT FILTER (Keep static check)
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


    // RULE 7: UNDERAGE CHECK (Admission of being under 13) (Keep static check)
    const underageRegex = /\b(i|i'm|im)\s+(am\s+)?(under\s+13|1[0-2]|[1-9])\b/i;
    if (underageRegex.test(lowerContent)) {
      await message.delete().catch(() => {});
      const log = client.channels.cache.get(LOG_CHANNEL_ID);
      if (log) log.send(`👶 **Underage Admission Detected**\nUser: <@${message.author.id}>\nContent: ||${message.content}||\nAction: Deleted immediately.`);
      return;
    }

    // RULE 4 & 6: Advertising / Scam / Links (Keep static check)
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

    // RULE 10: No Doxing (Basic IP detection) (Keep static check)
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

    // Check 2: Valid Media Links (URLs that Discord embeds, including Tenor/Giphy)
    const isMediaLink = isPureGIFLink || // Now uses the global check
        lowerContent.includes('imgur.com') || 
        lowerContent.includes('.png') || 
        lowerContent.includes('.jpe') || // Catches .jpg and .jpeg
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
  // RULE 5: Check Nickname on Join
  await moderateNickname(member);

  const userId = member.id;
  const now = Date.now();
   
  // Get or initialize join data
  const userData = joinTracker.get(userId) || { count: 0, lastJoin: 0 };

  // Reset count if the last join was more than 15 minutes ago
  if (now - userData.lastJoin > 15 * 60 * 1000) {
    userData.count = 0;
  }

  userData.count++;
  userData.lastJoin = now;
  joinTracker.set(userId, userData);

  // If the user has joined 10 times in 15 minutes, ban them
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
    // Warning after 6 rapid joins
    const log = client.channels.cache.get(LOG_CHANNEL_ID);
    if (log) log.send(`⚠️ **Troll Warning**\nUser: ${member.user.tag} has joined ${userData.count} times recently.`);
  }
});

// ================= THREAD BUTTONS =================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'archive_thread' || interaction.customId === 'edit_title') {
    const thread = interaction.channel;
    if (!(thread instanceof ThreadChannel)) {
      return interaction.reply({ content: "❌ Use this command inside a thread.", ephemeral: true });
    }
    
    // Check if user is the thread creator OR a moderator
    const isThreadStarter = thread.ownerId === interaction.user.id;
    const isMod = interaction.member.permissions.has(PermissionsBitField.Flags.ManageMessages);

    if (!isThreadStarter && !isMod) {
        return interaction.reply({ content: "❌ Only the thread creator or a moderator can use these controls.", ephemeral: true });
    }

    if (interaction.customId === 'archive_thread') {
      await thread.setArchived(true);
      return interaction.reply({ content: "✅ Archived", ephemeral: true });
    }

    if (interaction.customId === 'edit_title') {
      await interaction.reply({ content: "Send the new title in the thread. You have 30 seconds.", ephemeral: true });
      // Create a message collector for the next message from the user
      const filter = m => m.author.id === interaction.user.id && m.channelId === thread.id;
      const collector = thread.createMessageCollector({ filter, time: 30000, max: 1 });
      collector.on('collect', async (msg) => {
        try {
            // Set thread name, limited to 100 characters
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
});

// ================= LOGIN + SERVER (For Render) =================
client.login(process.env.TOKEN);

// This creates a minimal web server required by Render's free tier to keep the bot running.
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running!");
}).listen(PORT, () => console.log(`🌐 Server running on ${PORT}`));
