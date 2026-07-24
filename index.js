const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");

const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus } = require("@discordjs/voice");
const ytdl = require("ytdl-core");
const ytSearch = require("yt-search");
const SpotifyWebApi = require("spotify-web-api-node");

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
  TOKEN: process.env.TOKEN,
  GUILD_ID: "1328161058837495901",
  SUPPORT_PANEL_CHANNEL: "1513938432068419584",
  TICKET_CATEGORY: "1525269860777463990",
  STAFF_ROLE_ID: "1467715972608819314",
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID,
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
};
// ───────────────────────────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Channel],
});

// ─── SLURS LIST ────────────────────────────────────────────────────────────────
const SLURS = [
  "nigger", "nigga", "faggot", "fag", "chink", "spic", "kike", "wetback",
  "cracker", "honky", "gook", "raghead", "towelhead", "beaner", "coon",
  "retard", "tranny", "dyke",
];

// ─── TICKET CATEGORIES ─────────────────────────────────────────────────────────
const TICKET_CATEGORIES = [
  { value: "make_a_purchase", label: "Make a Purchase", description: "Buy products & complete your order", emoji: "🛒" },
  { value: "tweak_issue", label: "Tweak Issue", description: "Problems or disputes with your tweak order", emoji: "🔧" },
  { value: "report_member", label: "Report Member", description: "Report misconduct or rule violations", emoji: "🚨" },
  { value: "general_support", label: "General Support", description: "All other enquiries & questions", emoji: "💬" },
];

// ─── MUSIC QUEUE ───────────────────────────────────────────────────────────────
const musicQueues = new Map();
const inviteCache = new Map();
const inviteCounts = new Map();
const awaitingInput = new Map();

// ─── SPOTIFY ───────────────────────────────────────────────────────────────────
const spotifyApi = new SpotifyWebApi({
  clientId: CONFIG.SPOTIFY_CLIENT_ID,
  clientSecret: CONFIG.SPOTIFY_CLIENT_SECRET,
});

async function refreshSpotifyToken() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    spotifyApi.setAccessToken(data.body["access_token"]);
  } catch (err) {
    console.error("Spotify token error:", err);
  }
}

// ─── READY ─────────────────────────────────────────────────────────────────────
client.once("clientReady", async () => {
  console.log(`✅ Volt is online as ${client.user.tag}`);
  await refreshSpotifyToken();
  setInterval(refreshSpotifyToken, 3600000);

  for (const guild of client.guilds.cache.values()) {
    const invites = await guild.invites.fetch().catch(() => new Map());
    inviteCache.set(guild.id, new Map([...invites.values()].map((inv) => [inv.code, inv.uses])));
  }
});

// ─── INVITE TRACKING ───────────────────────────────────────────────────────────
client.on("inviteCreate", (invite) => {
  const guildInvites = inviteCache.get(invite.guild.id) || new Map();
  guildInvites.set(invite.code, invite.uses);
  inviteCache.set(invite.guild.id, guildInvites);
});

client.on("inviteDelete", (invite) => {
  const guildInvites = inviteCache.get(invite.guild.id);
  if (guildInvites) guildInvites.delete(invite.code);
});

client.on("guildMemberAdd", async (member) => {
  const guild = member.guild;
  const cachedInvites = inviteCache.get(guild.id) || new Map();
  try {
    const newInvites = await guild.invites.fetch();
    const usedInvite = newInvites.find((inv) => (cachedInvites.get(inv.code) || 0) < inv.uses);
    inviteCache.set(guild.id, new Map(newInvites.map((inv) => [inv.code, inv.uses])));
    if (usedInvite) {
      const guildKey = `${guild.id}-${usedInvite.inviter.id}`;
      inviteCounts.set(guildKey, (inviteCounts.get(guildKey) || 0) + 1);
    }
  } catch (err) {
    console.error("Invite tracking error:", err);
  }
});

// ─── SLUR DETECTION ────────────────────────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.toLowerCase();
  const hasSlur = SLURS.some((slur) => content.includes(slur));

  if (hasSlur) {
    try {
      await message.delete();
      await message.member.timeout(60000, "Used a slur");
      const warn = await message.channel.send(`⚠️ ${message.author} has been timed out for 1 minute for using inappropriate language.`);
      setTimeout(() => warn.delete().catch(() => {}), 5000);
    } catch (err) {
      console.error("Slur timeout error:", err);
    }
    return;
  }

  // ─── COMMANDS ───────────────────────────────────────────────────────────────
  const args = message.content.split(" ");
  const cmd = args[0].toLowerCase();

  // ── !sendpanel ──
  if (cmd === "!sendpanel") {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) return message.reply("❌ You need Administrator permission.");
    await message.delete().catch(() => {});
    await sendSupportPanel(message.channel);
    return;
  }

  // ── !purge ──
  if (cmd === "!purge") {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return message.reply("❌ You need Manage Messages permission.");
    const validAmounts = [100, 200, 300, 400, 500];
    const amount = parseInt(args[1]);
    if (!validAmounts.includes(amount)) return message.reply("❌ Please use: `!purge 100`, `!purge 200`, `!purge 300`, `!purge 400`, or `!purge 500`");

    let deleted = 0;
    while (deleted < amount) {
      const toDelete = Math.min(amount - deleted, 100);
      const msgs = await message.channel.bulkDelete(toDelete, true).catch(() => null);
      if (!msgs || msgs.size === 0) break;
      deleted += msgs.size;
    }

    const reply = await message.channel.send(`✅ Deleted **${deleted}** messages.`);
    setTimeout(() => reply.delete().catch(() => {}), 3000);
    return;
  }

  // ── !embed ──
  if (cmd === "!embed") {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return message.reply("❌ You need Manage Messages permission.");
    awaitingInput.set(message.author.id, { channelId: message.channel.id, step: "title" });
    await message.reply("📝 **Embed Creator**\n\nWhat should the **title** be?\n*(Type `skip` to leave blank)*");
    return;
  }

  if (awaitingInput.has(message.author.id)) {
    const session = awaitingInput.get(message.author.id);
    if (message.channel.id !== session.channelId) return;

    if (session.step === "title") {
      session.title = message.content === "skip" ? null : message.content;
      session.step = "description";
      awaitingInput.set(message.author.id, session);
      await message.reply("✏️ Now type the **description** of your embed:");
      return;
    }

    if (session.step === "description") {
      session.description = message.content;
      const embed = new EmbedBuilder().setColor(0xe74c3c);
      if (session.title) embed.setTitle(session.title);
      if (session.description) embed.setDescription(session.description);
      embed.setTimestamp();
      await message.channel.send({ embeds: [embed] });
      await message.reply("✅ Red embed sent!");
      awaitingInput.delete(message.author.id);
      return;
    }
  }

  // ── !cancel ──
  if (cmd === "!cancel" && awaitingInput.has(message.author.id)) {
    awaitingInput.delete(message.author.id);
    await message.reply("❌ Cancelled.");
    return;
  }

  // ── !invites ──
  if (cmd === "!invites" && !args[1]) {
    const leaderboard = [];
    for (const [key, count] of inviteCounts.entries()) {
      if (key.startsWith(message.guild.id)) {
        const userId = key.split("-")[1];
        leaderboard.push({ userId, count });
      }
    }
    leaderboard.sort((a, b) => b.count - a.count);
    if (leaderboard.length === 0) return message.reply("📊 No invites tracked yet!");
    const top10 = leaderboard.slice(0, 10);
    let description = "";
    for (let i = 0; i < top10.length; i++) {
      const { userId, count } = top10[i];
      const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `**${i + 1}.**`;
      description += `${medal} <@${userId}> — **${count}** invite${count !== 1 ? "s" : ""}\n`;
    }
    const embed = new EmbedBuilder().setTitle("📨 Invite Leaderboard").setDescription(description).setColor(0xe74c3c).setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ── !myinvites ──
  if (cmd === "!myinvites") {
    const count = inviteCounts.get(`${message.guild.id}-${message.author.id}`) || 0;
    const embed = new EmbedBuilder().setTitle("📨 Your Invites").setDescription(`${message.author}, you have invited **${count}** member${count !== 1 ? "s" : ""}!`).setColor(0xe74c3c).setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ── !invites @user ──
  if (cmd === "!invites" && message.mentions.users.size > 0) {
    const user = message.mentions.users.first();
    const count = inviteCounts.get(`${message.guild.id}-${user.id}`) || 0;
    const embed = new EmbedBuilder().setTitle("📨 Invite Count").setDescription(`${user} has invited **${count}** member${count !== 1 ? "s" : ""}!`).setColor(0xe74c3c).setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  // ── !play ──
  if (cmd === "!play") {
    const voiceChannel = message.member.voice.channel;
    if (!voiceChannel) return message.reply("❌ You need to be in a voice channel!");

    const query = args.slice(1).join(" ");
    if (!query) return message.reply("❌ Please provide a song name, YouTube link, or Spotify link!");

    await message.reply("🔍 Searching...");

    try {
      let videoUrl;

      if (query.includes("spotify.com/track")) {
        // Spotify track
        const trackId = query.split("track/")[1].split("?")[0];
        const track = await spotifyApi.getTrack(trackId);
        const songName = `${track.body.name} ${track.body.artists[0].name}`;
        const results = await ytSearch(songName);
        videoUrl = results.videos[0]?.url;
      } else if (query.includes("youtube.com") || query.includes("youtu.be")) {
        videoUrl = query;
      } else {
        const results = await ytSearch(query);
        videoUrl = results.videos[0]?.url;
      }

      if (!videoUrl) return message.channel.send("❌ Could not find that song!");

      const videoInfo = await ytdl.getInfo(videoUrl);
      const title = videoInfo.videoDetails.title;

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
      });

      const stream = ytdl(videoUrl, { filter: "audioonly", quality: "highestaudio" });
      const resource = createAudioResource(stream);
      const player = createAudioPlayer();

      player.play(resource);
      connection.subscribe(player);

      musicQueues.set(message.guild.id, { connection, player });

      const embed = new EmbedBuilder()
        .setTitle("🎵 Now Playing")
        .setDescription(`**[${title}](${videoUrl})**`)
        .setColor(0xe74c3c)
        .setFooter({ text: `Requested by ${message.author.tag}` })
        .setTimestamp();

      await message.channel.send({ embeds: [embed] });

      player.on(AudioPlayerStatus.Idle, () => {
        connection.destroy();
        musicQueues.delete(message.guild.id);
      });

    } catch (err) {
      console.error("Music error:", err);
      message.channel.send("❌ Error playing that song. Try a different link or search term!");
    }
    return;
  }

  // ── !stop ──
  if (cmd === "!stop") {
    const queue = musicQueues.get(message.guild.id);
    if (!queue) return message.reply("❌ No music is playing!");
    queue.connection.destroy();
    musicQueues.delete(message.guild.id);
    await message.reply("⏹️ Music stopped!");
    return;
  }

  // ── !pause ──
  if (cmd === "!pause") {
    const queue = musicQueues.get(message.guild.id);
    if (!queue) return message.reply("❌ No music is playing!");
    queue.player.pause();
    await message.reply("⏸️ Music paused!");
    return;
  }

  // ── !resume ──
  if (cmd === "!resume") {
    const queue = musicQueues.get(message.guild.id);
    if (!queue) return message.reply("❌ No music is playing!");
    queue.player.unpause();
    await message.reply("▶️ Music resumed!");
    return;
  }

  // ── !timeout ──
  if (cmd === "!timeout") {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply("❌ You need Moderate Members permission.");
    const target = message.mentions.members.first();
    if (!target) return message.reply("❌ Please mention a user to timeout!");
    const minutes = parseInt(args[2]) || 1;
    await target.timeout(minutes * 60000, `Timed out by ${message.author.tag}`);
    await message.reply(`✅ ${target} has been timed out for **${minutes}** minute${minutes !== 1 ? "s" : ""}!`);
    return;
  }
});

// ─── TICKET SUPPORT PANEL ──────────────────────────────────────────────────────
async function sendSupportPanel(channel) {
  const embed = new EmbedBuilder()
    .setTitle("Volt Tweaks — Support")
    .setDescription("Welcome. If you require assistance, please select the appropriate category below to open a private support ticket.\n\nA member of our team will be with you shortly.")
    .addFields(
      { name: "🛒 Make a Purchase", value: "Buy products & complete your order", inline: true },
      { name: "🔧 Tweak Issue", value: "Problems or disputes with your order", inline: true },
      { name: "🚨 Report Member", value: "Report misconduct or rule violations", inline: true },
      { name: "💬 General Support", value: "All other enquiries & questions", inline: true }
    )
    .setFooter({ text: "Volt Tweaks • Support System" })
    .setColor(0xe74c3c)
    .setTimestamp();

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("volt_ticket_select")
    .setPlaceholder("Select a support category...")
    .addOptions(TICKET_CATEGORIES.map((cat) => ({ label: cat.label, description: cat.description, value: cat.value, emoji: cat.emoji })));

  const row = new ActionRowBuilder().addComponents(selectMenu);
  await channel.send({ embeds: [embed], components: [row] });
}

// ─── TICKET INTERACTIONS ───────────────────────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  try {
    if (interaction.isStringSelectMenu() && interaction.customId === "volt_ticket_select") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const selected = TICKET_CATEGORIES.find((c) => c.value === interaction.values[0]);
      const guild = interaction.guild;
      const member = interaction.member;

      const existingChannel = guild.channels.cache.find(
        (ch) => ch.name.startsWith("ticket-") && ch.parentId === CONFIG.TICKET_CATEGORY && ch.permissionOverwrites.cache.has(member.id)
      );
      if (existingChannel) return interaction.editReply({ content: `❌ You already have an open ticket: ${existingChannel}` });

      const ticketChannel = await guild.channels.create({
        name: `ticket-${Math.floor(Math.random() * 9000) + 1000}`,
        type: ChannelType.GuildText,
        parent: CONFIG.TICKET_CATEGORY,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: member.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
          { id: CONFIG.STAFF_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageMessages] },
        ],
      });

      const ticketEmbed = new EmbedBuilder()
        .setTitle(`${selected.emoji} ${selected.label}`)
        .setDescription(`Hello ${member}, thank you for opening a ticket.\n\n**Category:** ${selected.label}\n**Description:** ${selected.description}\n\nA member of our team will be with you shortly.`)
        .setColor(0xe74c3c)
        .setFooter({ text: "Volt Tweaks • Support System" })
        .setTimestamp();

      const closeButton = new ButtonBuilder().setCustomId(`volt_close_${ticketChannel.id}`).setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger);
      const claimButton = new ButtonBuilder().setCustomId(`volt_claim_${ticketChannel.id}`).setLabel("Claim Ticket").setEmoji("✋").setStyle(ButtonStyle.Success);
      const buttonRow = new ActionRowBuilder().addComponents(claimButton, closeButton);

      await ticketChannel.send({ content: `${member} | <@&${CONFIG.STAFF_ROLE_ID}>`, embeds: [ticketEmbed], components: [buttonRow] });
      await interaction.editReply({ content: `✅ Your ticket has been created: ${ticketChannel}` });
    }

    if (interaction.isButton() && interaction.customId.startsWith("volt_close_")) {
      await interaction.deferReply();
      const closeEmbed = new EmbedBuilder().setTitle("🔒 Ticket Closing").setDescription(`Deleted in **5 seconds**.\nClosed by: ${interaction.member}`).setColor(0xe74c3c).setTimestamp();
      await interaction.editReply({ embeds: [closeEmbed] });
      setTimeout(() => interaction.channel.delete().catch(() => {}), 5000);
    }

    if (interaction.isButton() && interaction.customId.startsWith("volt_claim_")) {
      await interaction.reply({ content: `✅ Claimed by ${interaction.member}!` });
      const disabledClaim = new ButtonBuilder().setCustomId(`volt_claimed_${Date.now()}`).setLabel(`Claimed by ${interaction.member.displayName}`).setEmoji("✅").setStyle(ButtonStyle.Secondary).setDisabled(true);
      const closeButton = new ButtonBuilder().setCustomId(interaction.customId.replace("volt_claim_", "volt_close_")).setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger);
      await interaction.message.edit({ components: [new ActionRowBuilder().addComponents(disabledClaim, closeButton)] });
    }
  } catch (error) {
    console.error("Interaction error:", error);
  }
});

client.login(CONFIG.TOKEN);
