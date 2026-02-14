const path = require("node:path");

const isDev = process.env.NODE_ENV === "development";
const BASE_DIR = isDev ? path.join(__dirname, "..", "game-data") : "/home/games";
const INSTANCES_DIR = path.join(BASE_DIR, "instances");
const DOWNLOADS_DIR = path.join(BASE_DIR, "downloads");
const STATE_FILE = path.join(BASE_DIR, ".games-manager-state.json");
const LOG_FILE = path.join(BASE_DIR, "app.log");

const GAMES = {
  minecraft_java: {
    id: "minecraft_java",
    name: "Minecraft Java",
    port: 25565,
    protocol: "TCP",
    instanceDir: path.join(INSTANCES_DIR, "minecraft-java"),
    downloadUrl:
      "https://piston-data.mojang.com/v1/objects/4707d00eb834b446575d89a61a11b5d548d8c001/server.jar",
    downloadFileName: "server.jar",
    launchCommand: {
      bin: "java",
      args: ["-Xms1G", "-Xmx1G", "-jar", "server.jar", "nogui"]
    },
    postInstallFiles: [
      {
        file: "eula.txt",
        content: "eula=true\n"
      }
    ]
  },
  minecraft_bedrock: {
    id: "minecraft_bedrock",
    name: "Minecraft Bedrock",
    port: 19132,
    protocol: "UDP",
    instanceDir: path.join(INSTANCES_DIR, "minecraft-bedrock"),
    downloadUrl:
      "https://www.minecraft.net/bedrockdedicatedserver/bin-linux/bedrock-server-1.21.60.10.zip",
    downloadFileName: "bedrock-server.zip",
    launchCommand: {
      bin: "./bedrock_server",
      args: []
    },
    postInstallFiles: []
  },
  hytale: {
    id: "hytale",
    name: "Hytale",
    port: 5520,
    protocol: "UDP",
    instanceDir: path.join(INSTANCES_DIR, "hytale"),
    // Hytale usa un downloader especial, no URL directa
    downloadUrl: "https://downloader.hytale.com/hytale-downloader.zip",
    downloadFileName: "hytale-downloader.zip",
    downloaderBin: "hytale-downloader-linux-amd64",
    requiresAuth: true, // Requiere autenticación OAuth2
    launchCommand: {
      bin: "java",
      args: [
        "-Xms4G",
        "-Xmx4G",
        "-jar",
        "Server/HytaleServer.jar",
        "--assets",
        "Assets.zip",
        "--bind",
        "0.0.0.0:5520"
      ]
    },
    postInstallFiles: [
      {
        file: "config.json",
        content: JSON.stringify({
          Version: 3,
          ServerName: "Servidor Hytale",
          MOTD: "Bienvenido al servidor",
          Password: "",
          MaxPlayers: 100,
          MaxViewRadius: 12,
          LocalCompressionEnabled: false,
          DisplayTmpTagsInStrings: false,
          PlayerStorage: {
            Type: "Hytale"
          }
        }, null, 2) + "\n"
      }
    ]
  }
};

module.exports = {
  BASE_DIR,
  DOWNLOADS_DIR,
  GAMES,
  INSTANCES_DIR,
  STATE_FILE,
  LOG_FILE
};
