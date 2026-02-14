# Guía de Uso - Game Servers Manager

## 🚀 Inicio Rápido

### Modo Desarrollo
```bash
npm run dev
```

El servidor se iniciará en `http://localhost:3000` con:
- ✅ Directorio de datos: `./game-data`
- ✅ Sin restricciones de usuario o directorio
- ✅ Mensajes informativos en consola

### Modo Producción
```bash
npm start
```

Requiere:
- Usuario: `games`
- Directorio: `/home/games/`

## 🔐 Autenticación

Todas las peticiones requieren autenticación HTTP Basic:

**Usuarios permitidos:**
- `wnzero:barcosyfrutas`
- `barcalator:barcosyfrutas`

**Ejemplo con curl:**
```bash
curl -u wnzero:barcosyfrutas http://localhost:3000/health
```

## 📡 Endpoints de la API

### 1. Health Check
```bash
GET /health
```

**Respuesta:**
```json
{
  "ok": true
}
```

---

### 2. Información del Servidor
```bash
GET /server-info
```

**Respuesta:**
```json
{
  "ok": true,
  "data": {
    "ips": ["10.158.35.218", "172.20.0.1", "172.18.0.1"],
    "port": 3000
  }
}
```

---

### 3. Estado de los Juegos
```bash
GET /games
```

**Respuesta:**
```json
{
  "ok": true,
  "data": {
    "minecraft_java": {
      "name": "Minecraft Java",
      "installed": true,
      "running": false,
      "pid": null
    },
    "minecraft_bedrock": {
      "name": "Minecraft Bedrock",
      "installed": false,
      "running": false,
      "pid": null
    },
    "hytale": {
      "name": "Hytale",
      "installed": false,
      "running": false,
      "pid": null
    }
  }
}
```

---

### 4. Instalar un Juego
```bash
POST /games/{game_id}
```

**IDs disponibles:**
- `minecraft_java`
- `minecraft_bedrock`
- `hytale`

**Ejemplo:**
```bash
curl -X POST -u wnzero:barcosyfrutas http://localhost:3000/games/minecraft_java
```

**Respuesta:**
```json
{
  "ok": true,
  "game": "minecraft_java",
  "message": "Instalado e iniciado: Minecraft Java.",
  "pid": 12345
}
```

**Nota:** El juego se descarga, instala e inicia automáticamente.

---

### 5. Reiniciar un Juego
```bash
POST /games/{game_id}/restart
```

**Ejemplo:**
```bash
curl -X POST -u wnzero:barcosyfrutas http://localhost:3000/games/minecraft_java/restart
```

**Respuesta:**
```json
{
  "ok": true,
  "message": "Servidor iniciado.",
  "pid": 12346
}
```

---

### 6. Eliminar un Juego
```bash
DELETE /games/{game_id}
```

**Ejemplo:**
```bash
curl -X DELETE -u wnzero:barcosyfrutas http://localhost:3000/games/minecraft_java
```

**Respuesta:**
```json
{
  "ok": true,
  "game": "minecraft_java",
  "message": "Instancia eliminada por completo."
}
```

**Nota:** Esto detiene el servidor y elimina todos los archivos de la instancia.

---

## 🎮 Interfaz Web

Abre en tu navegador: `http://localhost:3000`

La interfaz web proporciona:
- Estado visual de todos los servidores
- Botones para instalar/reiniciar/eliminar
- Información de IPs del servidor

## 📁 Estructura de Directorios

### Modo Desarrollo
```
GameServers/
└── game-data/
    ├── instances/
    │   ├── minecraft-java/
    │   ├── minecraft-bedrock/
    │   └── hytale/
    ├── downloads/
    │   └── [archivos descargados]
    └── .games-manager-state.json
```

### Modo Producción
```
/home/games/
├── instances/
├── downloads/
└── .games-manager-state.json
```

## 🔧 Logs de los Servidores

Cada servidor genera logs en su directorio de instancia:

```bash
# Minecraft Java
cat game-data/instances/minecraft-java/stdout.log
cat game-data/instances/minecraft-java/stderr.log
```

## ⚠️ Solución de Problemas

### Error: "address already in use"
El puerto 3000 ya está en uso. Detén el proceso anterior:
```bash
pkill -f "node src/index.js"
```

### Error: "spawn java ENOENT"
Java no está instalado. Instala OpenJDK:
```bash
sudo apt install openjdk-25-jdk
```

### Error: "Unexpected end of JSON input"
El archivo de estado está corrupto. Reinicialízalo:
```bash
echo '{}' > game-data/.games-manager-state.json
```

## 🎯 Ejemplo Completo

```bash
# 1. Iniciar el servidor
npm run dev

# 2. Verificar estado
curl -u wnzero:barcosyfrutas http://localhost:3000/games

# 3. Instalar Minecraft Java
curl -X POST -u wnzero:barcosyfrutas http://localhost:3000/games/minecraft_java

# 4. Ver logs
tail -f game-data/instances/minecraft-java/stdout.log

# 5. Reiniciar servidor
curl -X POST -u wnzero:barcosyfrutas http://localhost:3000/games/minecraft_java/restart

# 6. Eliminar servidor
curl -X DELETE -u wnzero:barcosyfrutas http://localhost:3000/games/minecraft_java
```
