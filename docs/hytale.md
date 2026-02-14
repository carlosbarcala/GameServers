# Guía Completa: Administración de Servidor Dedicado de Hytale (Linux)

> **Objetivo:** Este documento contiene toda la información técnica necesaria para que una IA (o desarrollador) pueda crear un gestor de instancias de servidores Hytale en Linux: descarga, instalación, configuración, arranque, autenticación, permisos, comandos y mantenimiento.

---

## 1. Requisitos del Sistema

- **SO:** Linux (x64 o arm64)
- **Java:** Java 25 obligatorio (recomendado: Adoptium Temurin 25)
- **RAM mínima:** 4 GB (recomendado 8 GB+ para servidores públicos)
- **Protocolo de red:** QUIC sobre **UDP** (NO TCP)
- **Puerto por defecto:** 5520/UDP
- **Verificar Java:**

```bash
java --version
# Esperado: openjdk 25.x.x
```

---

## 2. Descarga de Archivos del Servidor

### Método recomendado: Hytale Downloader CLI

```bash
# 1. Crear directorio del servidor
mkdir -p /opt/hytale && cd /opt/hytale

# 2. Descargar el downloader oficial
wget https://downloader.hytale.com/hytale-downloader.zip
unzip hytale-downloader.zip
chmod +x hytale-downloader-linux-amd64

# 3. Ejecutar (requiere autenticación OAuth2 la primera vez)
./hytale-downloader-linux-amd64
# Mostrará una URL + código → abrir en navegador → iniciar sesión con cuenta Hytale
# Tras autenticar: "Authentication successful! Mode: OAUTH_DEVICE"
# Las credenciales se guardan para futuras ejecuciones

# 4. Se descarga un zip (ej: 2026.01.13-50e69c385.zip)
unzip 2026.01.13-*.zip -d /opt/hytale
```

### Comandos útiles del Downloader

```bash
./hytale-downloader-linux-amd64 -print-version       # Ver versión disponible sin descargar
./hytale-downloader-linux-amd64 -check-update         # Comprobar si hay actualización
./hytale-downloader-linux-amd64 -patchline pre-release # Descargar versión experimental
./hytale-downloader-linux-amd64 -download-path custom.zip # Ruta personalizada de descarga
```

### Método alternativo: Copiar desde el launcher

Los archivos están en: `$XDG_DATA_HOME/Hytale/install/release/package/game/latest/`

Se necesitan:
- Carpeta `Server/` (contiene `HytaleServer.jar` y `HytaleServer.aot`)
- Archivo `Assets.zip`

---

## 3. Estructura de Archivos del Servidor

```
/opt/hytale/
├── Server/
│   ├── HytaleServer.jar       # Ejecutable principal del servidor
│   └── HytaleServer.aot       # Caché AOT (arranque más rápido)
├── Assets.zip                 # Assets del juego (obligatorio)
├── config.json                # Configuración global del servidor
├── permissions.json           # Permisos de usuarios y grupos
├── whitelist.json             # Lista blanca de jugadores
├── bans.json                  # Jugadores baneados
├── logs/                      # Logs del servidor
├── mods/                      # Plugins y mods (.jar o .zip)
└── universe/
    ├── players/               # Datos de jugadores
    └── worlds/
        └── <nombre_mundo>/
            └── config.json    # Configuración específica del mundo
```

---

## 4. Arranque del Servidor

### Comando básico

```bash
java -jar Server/HytaleServer.jar --assets Assets.zip
```

### Con parámetros de memoria y bind

```bash
java -Xms4G -Xmx4G -jar Server/HytaleServer.jar --assets Assets.zip --bind 0.0.0.0:5520
```

### Todos los argumentos de arranque disponibles

| Argumento | Descripción | Default |
|---|---|---|
| `--assets <Path>` | Directorio/archivo de assets | `../HytaleAssets` |
| `-b, --bind <addr:port>` | Dirección y puerto de escucha | `0.0.0.0:5520` |
| `--auth-mode <modo>` | `authenticated` o `offline` | `AUTHENTICATED` |
| `--allow-op` | Habilita el comando `/op self` | desactivado |
| `--backup` | Activa backups automáticos | desactivado |
| `--backup-dir <Path>` | Carpeta de backups | - |
| `--backup-frequency <min>` | Intervalo de backup en minutos | 30 |
| `--accept-early-plugins` | Permite cargar early plugins (inestable) | desactivado |

### Script de arranque recomendado (start.sh)

```bash
#!/bin/bash
cd /opt/hytale
java -Xms4G -Xmx4G \
  -jar Server/HytaleServer.jar \
  --assets Assets.zip \
  --bind 0.0.0.0:5520 \
  --backup \
  --backup-dir ./backups \
  --backup-frequency 30
```

### Recomendaciones de RAM según hardware

```
# 4 GB host  → -Xms3G -Xmx3G
# 6 GB host  → -Xms5G -Xmx5G
# 8 GB host  → -Xms7G -Xmx7G
# Dejar siempre ~1 GB para el SO
# Síntoma de falta de RAM: CPU alta por garbage collection
```

---

## 5. Autenticación del Servidor (Obligatoria)

Sin autenticación, los jugadores NO pueden conectarse.

```
# En la consola del servidor (primera vez):
> /auth login device

=================================================================
DEVICE AUTHORIZATION
=================================================================
Visit: https://accounts.hytale.com/device
Enter code: ABCD-1234
Or visit: https://accounts.hytale.com/device?user_code=ABCD-1234
=================================================================
Waiting for authorization (expires in 900 seconds)...
```

- Abrir la URL en un navegador
- Iniciar sesión con la cuenta de Hytale
- Introducir el código
- La consola confirmará: "Authentication successful!"
- Se debe re-autenticar si los tokens expiran o tras actualizaciones

### Comandos de autenticación

```
/auth login device    # Iniciar autenticación
/auth logout          # Cerrar sesión
/auth status          # Ver estado de autenticación
```

### Límites

- Máximo 100 servidores por licencia de Hytale
- Para más, comprar licencias adicionales o solicitar cuenta de Server Provider

---

## 6. Firewall y Red

```bash
# UFW
sudo ufw allow 5520/udp

# iptables
sudo iptables -A INPUT -p udp --dport 5520 -j ACCEPT

# IMPORTANTE: Es UDP, NO TCP. Hytale usa QUIC sobre UDP.
```

- Si estás detrás de un router, hacer port forwarding del puerto 5520 UDP
- Jugadores detrás de CGNAT (ISP móviles) pueden conectarse como clientes pero no hostear
- NAT simétrico puede causar problemas → considerar VPS o servidor dedicado

---

## 7. Configuración Global (config.json)

Archivo raíz del servidor. Se lee al arrancar. **Siempre parar el servidor antes de editar.**

```json
{
  "Version": 3,
  "ServerName": "Mi Servidor Hytale",
  "MOTD": "Bienvenido al servidor",
  "Password": "",
  "MaxPlayers": 100,
  "MaxViewRadius": 32,
  "LocalCompressionEnabled": false,
  "DisplayTmpTagsInStrings": false,
  "PlayerStorage": {
    "Type": "Hytale"
  }
}
```

| Campo | Descripción |
|---|---|
| `ServerName` | Nombre visible del servidor |
| `MOTD` | Mensaje al conectarse (vacío = sin mensaje) |
| `Password` | Contraseña del servidor (vacío = público) |
| `MaxPlayers` | Máximo de jugadores simultáneos |
| `MaxViewRadius` | Distancia de visión en chunks (default ~12 chunks = 384 bloques, muy alto, ajustar según recursos) |

---

## 8. Configuración por Mundo (universe/worlds/<nombre>/config.json)

Cada mundo tiene su propia configuración independiente:

```json
{
  "Version": 4,
  "Seed": 1767292261384,
  "WorldGen": { "Type": "Hytale", "Name": "Default" },
  "WorldMap": { "Type": "WorldGen" },
  "ChunkStorage": { "Type": "Hytale" },
  "IsTicking": true,
  "IsBlockTicking": true,
  "IsPvpEnabled": false,
  "IsFallDamageEnabled": true,
  "IsGameTimePaused": false,
  "IsSpawningNPC": true,
  "IsSpawnMarkersEnabled": true,
  "IsAllNPCFrozen": false,
  "GameplayConfig": "Default",
  "IsSavingPlayers": true,
  "IsSavingChunks": true,
  "IsUnloadingChunks": true,
  "DeleteOnUniverseStart": false
}
```

Permite tener mundos con reglas distintas: uno con PvP, otro sin caída de daño, otro creativo, etc.

---

## 9. Sistema de Permisos (permissions.json)

### Estructura

```json
{
  "groups": {
    "OP": ["*"],
    "Default": [],
    "admin": {
      "permissions": ["*"]
    },
    "moderator": {
      "permissions": [
        "hytale.command.kick",
        "hytale.command.ban",
        "hytale.command.unban",
        "hytale.command.tp",
        "hytale.command.who"
      ]
    },
    "player": {
      "permissions": [
        "hytale.command.home",
        "hytale.command.sethome",
        "hytale.command.spawn"
      ]
    }
  },
  "users": {
    "UUID-DEL-JUGADOR": {
      "groups": ["admin"]
    },
    "UUID-MODERADOR": {
      "groups": ["moderator"]
    }
  }
}
```

### Cómo hacerse OP/Admin

**Método 1 - Editar permissions.json:**
1. Obtener UUID del jugador (con `/uuid` en el juego, o en los logs al conectarse)
2. Añadir el UUID al grupo OP en permissions.json
3. Reiniciar el servidor

**Método 2 - Comando con --allow-op:**
1. Arrancar el servidor con `--allow-op`
2. En la consola: `op add <nombre_jugador>`
3. O in-game: `/op self`
4. Una vez configurado permissions.json, se puede quitar `--allow-op`

### Comandos de permisos

```
/op add <jugador>              # Dar OP
/op remove <jugador>           # Quitar OP
/op self                       # Darte OP (requiere --allow-op)

# Permisos por usuario
/permission user <jugador> list
/permission user <jugador> add <permiso>
/permission user <jugador> remove <permiso>
/permission user <jugador> groups           # Ver grupos del usuario
/permission user <jugador> addgroup <grupo>
/permission user <jugador> removegroup <grupo>

# Permisos por grupo
/permission group <grupo> list
/permission group <grupo> add <permiso>
/permission group <grupo> remove <permiso>
```

- El wildcard `"*"` otorga todos los permisos
- Las negaciones tienen prioridad sobre permisos heredados
- Sin grupos explícitos, el jugador pertenece al grupo "Default"
- También existen grupos virtuales basados en el modo de juego

---

## 10. Comandos Esenciales de Administración

### Moderación

```
/kick <jugador>               # Expulsar jugador
/ban <jugador>                # Banear jugador (se guarda en bans.json)
/unban <jugador>              # Desbanear jugador
```

### Whitelist

```
/whitelist on                 # Activar lista blanca
/whitelist off                # Desactivar lista blanca
/whitelist add <jugador>      # Añadir jugador
/whitelist remove <jugador>   # Quitar jugador
/whitelist list               # Listar jugadores permitidos
/whitelist status             # Ver si está activa
```

Los datos se guardan en `whitelist.json`.

### Información y utilidades

```
/whoami                       # Ver tu info y estado de permisos
/who                          # Ver jugadores conectados
/uuid                         # Ver tu UUID
/help                         # Lista completa de comandos
```

### Teletransporte

```
/tp <jugador>                 # Teletransportarse a un jugador
/tp <jugador> <destino>       # Teletransportar jugador a destino
```

### Servidor

```
/auth login device            # Autenticar servidor
/auth status                  # Estado de autenticación
```

### Contraseña del servidor

No hay comando in-game. Se configura en `config.json` campo `"Password"` y se reinicia.

---

## 11. Plugins y Mods

### Instalación

1. Parar el servidor
2. Colocar archivos `.jar` o `.zip` en la carpeta `mods/`
3. Arrancar el servidor (se cargan automáticamente)
4. Cada plugin genera su propia carpeta de configuración en `mods/<nombre_plugin>/`

### Fuentes

- **CurseForge:** https://www.curseforge.com/hytale (plataforma de referencia)
- **GitHub / Discord:** comunidades de modding

### Dependencia Maven (para desarrollo de plugins)

```xml
<repositories>
  <repository>
    <id>hytale-release</id>
    <url>https://maven.hytale.com/release</url>
  </repository>
  <repository>
    <id>hytale-pre-release</id>
    <url>https://maven.hytale.com/pre-release</url>
  </repository>
</repositories>

<dependency>
  <groupId>com.hypixel.hytale</groupId>
  <artifactId>Server</artifactId>
  <version>2026.01.22-6f8bdbdc4</version>
</dependency>
```

---

## 12. Actualización del Servidor

```bash
cd /opt/hytale

# 1. Parar el servidor

# 2. Descargar nueva versión
./hytale-downloader-linux-amd64

# 3. Extraer sobrescribiendo archivos antiguos
unzip -o nueva-version.zip -d /opt/hytale

# 4. Arrancar el servidor
# Puede requerir re-autenticación:
# /auth login device

# IMPORTANTE: Cliente y servidor deben estar en la misma versión exacta.
# Si hay un update, el servidor debe actualizarse inmediatamente
# o los jugadores actualizados no podrán conectarse.
# (Planeada tolerancia ±2 versiones en el futuro)
```

### Script de actualización automatizada

```bash
#!/bin/bash
SERVER_DIR="/opt/hytale"
DOWNLOADER="$SERVER_DIR/hytale-downloader-linux-amd64"

cd "$SERVER_DIR"

# Descargar última versión
LATEST_ARCHIVE=$($DOWNLOADER 2>&1 | grep -oP '\S+\.zip')

if [ -z "$LATEST_ARCHIVE" ]; then
  echo "No se encontró archivo. Abortando."
  exit 1
fi

echo "Extrayendo $LATEST_ARCHIVE..."
unzip -o "$LATEST_ARCHIVE" -d "$SERVER_DIR"

echo "Actualización completa. Reiniciar el servidor."
```

---

## 13. Notas Importantes para el Gestor de Instancias

### Múltiples instancias

- Se pueden ejecutar múltiples instancias en el mismo host usando **puertos diferentes** (`--bind`)
- Cada instancia necesita su **propio directorio** con sus archivos de configuración
- Cada instancia consume su propia RAM (planificar en consecuencia)
- Límite de 100 servidores autenticados por licencia de Hytale

### Archivos de configuración

- Se leen al arrancar y se **sobrescriben** cuando ocurren acciones in-game
- **NUNCA editar con el servidor en marcha** (se pierden los cambios)
- Siempre: parar servidor → editar → arrancar

### Compatibilidad de versiones

- Cliente y servidor deben coincidir **exactamente** en versión de protocolo
- Un hash verifica la compatibilidad; si no coincide, se rechaza la conexión

### Monitorización

- Vigilar uso de RAM y CPU durante el uso
- Síntoma de falta de memoria: CPU alta por garbage collection
- La distancia de visión (`MaxViewRadius`) es el principal factor de consumo de recursos
- El comportamiento de los jugadores influye mucho en el consumo

### Backups

- Usar `--backup --backup-dir ./backups --backup-frequency 30`
- El directorio `universe/` es lo más importante de respaldar
- Recomendado: backups automáticos + copia off-site

### Docker (alternativa)

Existe una imagen Docker mantenida por la comunidad:

```bash
# docker-compose.yml
services:
  hytale:
    image: indifferentbroccoli/hytale-server-docker
    restart: unless-stopped
    container_name: hytale
    stop_grace_period: 30s
    ports:
      - 5520:5520/udp
    env_file:
      - .env
    volumes:
      - ./server-files:/home/hytale/server-files

# Variables de entorno disponibles:
# MAX_PLAYERS, MAX_VIEW_RADIUS, SERVER_NAME, MOTD, PASSWORD
# XMS (heap mínimo), XMX (heap máximo)
# DOWNLOAD_ON_START=true (auto-actualiza al reiniciar)
```