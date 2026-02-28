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
curl -u user:pass http://127.0.0.1:3000/games

# Ver IP del servidor
curl -u user:pass http://127.0.0.1:3000/server-info

# Instalar Minecraft Java
curl -u user:pass -X POST http://127.0.0.1:3000/games/minecraft_java

# Reiniciar Bedrock
curl -u user:pass -X POST http://127.0.0.1:3000/games/minecraft_bedrock/restart

# Borrar Hytale
curl -u user:pass -X DELETE http://127.0.0.1:3000/games/hytale
```

## Asistente de IA en el chat

El servidor incluye dos asistentes de IA que participan en el chat del juego.

### God

Deidad errática y perturbada que rige el servidor. Los jugadores lo invocan con `@god`.

- Lee el historial reciente del chat (últimos 20 mensajes) para dar respuestas con contexto.
- Lanza comentarios espontáneos cada 3-15 minutos si hay conversación activa.
- Las respuestas se trocean en fragmentos de máximo 100 caracteres por palabras y se envían secuencialmente.

### Agent

Asistente útil y neutro. Los jugadores lo invocan con `@agent`.

- Responde únicamente a la pregunta concreta del jugador, sin contexto de conversación.
- Las respuestas también se trocean en fragmentos de máximo 100 caracteres.

### Configuración de la IA

Desde el panel web se puede configurar:
- Proveedor y clave de API (OpenAI, Gemini, Claude, Ollama)
- Prompt de God (global y por juego)
- Prompt de Agent
