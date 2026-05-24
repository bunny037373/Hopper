const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    PermissionsBitField,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType
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
const MOD_ROLE_ID = '1506481374637588500'; // The mod team role pinged in tickets

// ====================== DATA STORAGE ======================
const afkStatus = new Map();
let persistentVoiceChannelId = null;

// ====================== AI SETUP ======================
let aiModelInstance;
let AI_ENABLED = !!process.env.GEMINI_API_KEY;
if (AI_ENABLED) {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    aiModelInstance = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
}

// ====================== HELPER FUNCTIONS ======================
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
        new SlashCommandBuilder().setName('say').setDescription('Send a message as the bot').addStringOption(opt => opt.setName('text').setDescription('Text').setRequired(true)),
        new SlashCommandBuilder().setName('ask').setDescription('Ask AI').addStringOption(opt => opt.setName('prompt').setDescription('Prompt').setRequired(true)),
        new SlashCommandBuilder().setName('afk').setDescription('Set AFK status').addStringOption(opt => opt.setName('reason').setDescription('Reason')),
        new SlashCommandBuilder().setName('joinvc').setDescription('Join VC'),
        new SlashCommandBuilder().setName('leavevc').setDescription('Leave VC'),
        new SlashCommandBuilder().setName('clear').setDescription('Delete messages').addIntegerOption(opt => opt.setName('num').setDescription('Amount').setRequired(true)),
        new SlashCommandBuilder().setName('start-ticket').setDescription('Send the ticket creation prompt menu')
    ].map(c => c.toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body: commands });
    } catch (err) { console.error(err); }
});

// ================= INTERACTION HANDLER =================
client.on('interactionCreate', async (interaction) => {
    // --- HANDLING SLASH COMMANDS ---
    if (interaction.isChatInputCommand()) {
        const { commandName, options } = interaction;

        if (commandName === 'start-ticket') {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('create_ticket')
                    .setLabel('Make a Ticket')
                    .setStyle(ButtonStyle.Primary)
            );

            return interaction.reply({
                content: 'Hello there toon! So you probably want to make a ticket!',
                components: [row]
            });
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
        if (commandName === 'afk') {
            const reason = options.getString('reason') || 'AFK';
            afkStatus.set(interaction.user.id, reason);
            return interaction.reply(`You are now AFK: ${reason}`);
        }
        if (commandName === 'clear') {
            const num = options.getInteger('num');
            if (num < 1 || num > 100) return interaction.reply({ content: 'Provide a number between 1 and 100.', ephemeral: true });
            await interaction.channel.bulkDelete(num, true);
            return interaction.reply({ content: `Deleted ${num} messages.`, ephemeral: true });
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
    }

    // --- HANDLING BUTTON INTERACTIONS ---
    if (interaction.isButton()) {
        if (interaction.customId === 'create_ticket') {
            await interaction.deferReply({ ephemeral: true });

            const guild = interaction.guild;
            const member = interaction.member;

            try {
                const ticketChannel = await guild.channels.create({
                    name: `ticket-${member.user.username}`,
                    type: ChannelType.GuildText,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
                            deny: [PermissionsBitField.Flags.ViewChannel],
                        },
                        {
                            id: member.id,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
                        },
                        {
                            id: MOD_ROLE_ID,
                            allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
                        }
                    ],
                });

                const closeRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('close_ticket')
                        .setLabel('Close Ticket')
                        .setStyle(ButtonStyle.Danger)
                );

                await ticketChannel.send({
                    content: `<@&${MOD_ROLE_ID}>\nHello <@${member.id}>, a Mod will be with you in a minute.`,
                    components: [closeRow]
                });

                return interaction.editReply({ content: `Your ticket has been opened here: ${ticketChannel}`, ephemeral: true });

            } catch (error) {
                console.error(error);
                return interaction.editReply({ content: 'Something went wrong while executing this system.', ephemeral: true });
            }
        }

        if (interaction.customId === 'close_ticket') {
            await interaction.reply({ content: 'Closing channel in 5 seconds...' });
            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch (e) {
                    console.error("Failed to delete channel: ", e);
                }
            }, 5000);
        }
    }
});

// ================= MESSAGE HANDLER =================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return; 
    if (!message.guild || message.content.startsWith('/')) return;

    // --- AFK LOGIC ---
    if (afkStatus.has(message.author.id)) {
        afkStatus.delete(message.author.id);
        message.reply("Welcome back! AFK removed.").then(m => setTimeout(() => m.delete(), 3000));
    }
});

// ================= VOICE STATE UPDATES =================
client.on('voiceStateUpdate', (oldState, newState) => {
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
