# Game Servers Manager

Aplicación Node.js para gestionar una sola instancia por juego:
- Minecraft Java
- Minecraft Bedrock
- Hytale

Permite:
- Instalar y arrancar la instancia
- Reiniciar el servidor
- Eliminar la instancia completa para reinstalar desde cero

## Requisitos

- Ejecutar como usuario `games`
- Ejecutar desde `/home/games` (o un subdirectorio dentro de `/home/games`)
- Node.js 18+
- Binarios del sistema:
  - `java` (para Minecraft Java)
  - `unzip` (para Bedrock)
  - `tar` (para Hytale)

## Instalación

```bash
npm install
```

## Ejecución

Desde `/home/games`:

```bash
node /ruta/al/proyecto/src/index.js
```

Por defecto escucha en `:3000`. Puedes cambiarlo con `PORT`.

Frontend web disponible en:

- `GET /` -> panel visual para gestionar servidores

## Acceso

La aplicación usa autenticación básica HTTP.

- Usuarios permitidos: `wnzero`, `barcalator`
- Contraseña: `barcosyfrutas`

## Endpoints

`GET /health`

`GET /games`

`GET /server-info`
- Devuelve IPs locales IPv4 detectadas del servidor y el puerto de la app.

`POST /games/:id`
- Instala + inicia la instancia del juego.
- IDs válidos: `minecraft_java`, `minecraft_bedrock`, `hytale`

`POST /games/:id/restart`
- Reinicia el proceso del juego.

`DELETE /games/:id`
- Detiene el proceso y borra la instancia completa.

## Ejemplos

```bash
# Estado general
curl -u wnzero:barcosyfrutas http://127.0.0.1:3000/games

# Ver IP del servidor
curl -u wnzero:barcosyfrutas http://127.0.0.1:3000/server-info

# Instalar Minecraft Java
curl -u wnzero:barcosyfrutas -X POST http://127.0.0.1:3000/games/minecraft_java

# Reiniciar Bedrock
curl -u barcalator:barcosyfrutas -X POST http://127.0.0.1:3000/games/minecraft_bedrock/restart

# Borrar Hytale
curl -u wnzero:barcosyfrutas -X DELETE http://127.0.0.1:3000/games/hytale
```
