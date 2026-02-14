# Configurar servicio en Debian 13 (systemd)

Esta guía deja `Game Servers Manager` como servicio de sistema en Debian 13.

## 1) Preparar usuario y carpetas

```bash
sudo adduser --disabled-password --gecos "" games
sudo mkdir -p /home/games
sudo chown -R games:games /home/games
```

## 2) Copiar el proyecto a `/home/games`

Ejemplo:

```bash
sudo -u games mkdir -p /home/games/apps
sudo cp -R /ruta/a/GameServers /home/games/apps/GameServers
sudo chown -R games:games /home/games/apps/GameServers
```

## 3) Instalar dependencias del sistema

```bash
sudo apt update
sudo apt install -y nodejs npm openjdk-25-jdk unzip tar curl
```

## 4) Instalar dependencias Node de la app

```bash
sudo -u games bash -lc 'cd /home/games/apps/GameServers && npm install --omit=dev'
```

## 5) Crear servicio systemd

Crear `/etc/systemd/system/game-servers-manager.service`:

```ini
[Unit]
Description=Game Servers Manager API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=games
Group=games
WorkingDirectory=/home/games/apps/GameServers
Environment=PORT=3000
ExecStart=/usr/bin/node /home/games/apps/GameServers/src/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Nota: La app valida que se ejecute como usuario `games` y desde `/home/games` o un subdirectorio.

## 6) Activar y arrancar

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now game-servers-manager.service
```

## 7) Verificar estado y logs

```bash
sudo systemctl status game-servers-manager.service
sudo journalctl -u game-servers-manager.service -f
```

## 8) Operaciones del servicio

```bash
sudo systemctl restart game-servers-manager.service
sudo systemctl stop game-servers-manager.service
sudo systemctl start game-servers-manager.service
```

