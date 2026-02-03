import dotenv from "dotenv";

dotenv.config();

// Placeholder bootstrap while scaffolding the bot.
async function main() {
  const token = process.env.DISCORD_TOKEN;

  if (!token) {
    console.error("DISCORD_TOKEN manquant dans l'environnement.");
    process.exit(1);
  }

  console.log("Munitorum bot scaffold initialisé. Implémentation à venir.");
}

main().catch((err) => {
  console.error("Erreur au démarrage :", err);
  process.exit(1);
});
