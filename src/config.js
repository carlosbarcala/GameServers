const path = require("node:path");

const BASE_DIR = "/home/games";
const INSTANCES_DIR = path.join(BASE_DIR, "instances");
const DOWNLOADS_DIR = path.join(BASE_DIR, "downloads");
const STATE_FILE = path.join(BASE_DIR, ".games-manager-state.json");

const GAMES = {
  minecraft_java: {
    id: "minecraft_java",
    name: "Minecraft Java",
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
    instanceDir: path.join(INSTANCES_DIR, "hytale"),
    downloadUrl: "https://cdn.hytale.com/server/linux/latest/hytale-server.tar.gz",
    downloadFileName: "hytale-server.tar.gz",
    launchCommand: {
      bin: "./hytale_server",
      args: []
    },
    postInstallFiles: []
  }
};

module.exports = {
  BASE_DIR,
  DOWNLOADS_DIR,
  GAMES,
  INSTANCES_DIR,
  STATE_FILE
};
