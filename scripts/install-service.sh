#!/bin/bash
set -e

# Script de instalación del servicio Game Servers Manager para Debian 13
# Debe ejecutarse como root

if [ "$EUID" -ne 0 ]; then 
  echo "❌ Este script debe ejecutarse como root (sudo)"
  exit 1
fi

echo "🚀 Instalando Game Servers Manager como servicio systemd..."

# Detectar directorio del proyecto
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "📁 Directorio del proyecto: $PROJECT_DIR"

# Verificar que existe package.json
if [ ! -f "$PROJECT_DIR/package.json" ]; then
  echo "❌ No se encontró package.json en $PROJECT_DIR"
  exit 1
fi

# Verificar que existe src/index.js
if [ ! -f "$PROJECT_DIR/src/index.js" ]; then
  echo "❌ No se encontró src/index.js en $PROJECT_DIR"
  exit 1
fi

# Crear usuario games si no existe
if ! id -u games &>/dev/null; then
  echo "👤 Creando usuario 'games'..."
  useradd -r -m -d /home/games -s /bin/bash games
else
  echo "✓ Usuario 'games' ya existe"
fi

# Crear directorio de datos si no existe
if [ ! -d "/home/games" ]; then
  echo "📁 Creando directorio /home/games..."
  mkdir -p /home/games
  chown games:games /home/games
fi

# Instalar dependencias de Node.js
echo "📦 Instalando dependencias de Node.js..."
cd "$PROJECT_DIR"
sudo -u games npm install

# Crear archivo de servicio systemd
echo "⚙️  Creando servicio systemd..."
cat > /etc/systemd/system/game-servers-manager.service << EOF
[Unit]
Description=Game Servers Manager
After=network.target

[Service]
Type=simple
User=games
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/node $PROJECT_DIR/src/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=game-servers-manager

# Variables de entorno
Environment="NODE_ENV=production"
Environment="PORT=3000"

[Install]
WantedBy=multi-user.target
EOF

# Recargar systemd
echo "🔄 Recargando systemd..."
systemctl daemon-reload

# Habilitar el servicio para que inicie al arrancar
echo "✅ Habilitando servicio..."
systemctl enable game-servers-manager.service

# Iniciar el servicio
echo "▶️  Iniciando servicio..."
systemctl start game-servers-manager.service

# Mostrar estado
echo ""
echo "✅ Instalación completada!"
echo ""
echo "📊 Estado del servicio:"
systemctl status game-servers-manager.service --no-pager

echo ""
echo "📝 Comandos útiles:"
echo "  - Ver estado:    sudo systemctl status game-servers-manager"
echo "  - Iniciar:       sudo systemctl start game-servers-manager"
echo "  - Detener:       sudo systemctl stop game-servers-manager"
echo "  - Reiniciar:     sudo systemctl restart game-servers-manager"
echo "  - Ver logs:      sudo journalctl -u game-servers-manager -f"
echo "  - Deshabilitar:  sudo systemctl disable game-servers-manager"
