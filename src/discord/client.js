// Client Discord : intentions, réception des messages et événement de connexion (la connexion est lancée par index.js).
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { handleMessage } = require('./commands');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.on(Events.MessageCreate, (message) => {
  void handleMessage(message).catch((error) => console.error('Commande impossible :', error.message));
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Connecté en tant que ${readyClient.user.tag}`);
});

module.exports = { client };
