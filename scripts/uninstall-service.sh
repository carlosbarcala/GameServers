#!/bin/bash
set -e

# Script de desinstalación del servicio Game Servers Manager para Debian 13
# Debe ejecutarse como root
# NO borra datos de juegos ni configuraciones

if [ "$EUID" -ne 0 ]; then 
  echo "❌ Este script debe ejecutarse como root (sudo)"
  exit 1
fi

echo "🗑️  Desinstalando servicio Game Servers Manager..."

# Verificar si el servicio existe
if [ ! -f "/etc/systemd/system/game-servers-manager.service" ]; then
  echo "⚠️  El servicio no está instalado"
  exit 0
fi

# Detener el servicio si está corriendo
echo "⏹️  Deteniendo servicio..."
systemctl stop game-servers-manager.service 2>/dev/null || true

# Deshabilitar el servicio
echo "🔓 Deshabilitando servicio..."
systemctl disable game-servers-manager.service 2>/dev/null || true

# Eliminar archivo de servicio
echo "🗑️  Eliminando archivo de servicio..."
rm -f /etc/systemd/system/game-servers-manager.service

# Recargar systemd
echo "🔄 Recargando systemd..."
systemctl daemon-reload
systemctl reset-failed 2>/dev/null || true

echo ""
echo "✅ Servicio desinstalado correctamente"
echo ""
echo "ℹ️  NOTA: Los siguientes elementos NO han sido eliminados:"
echo "  - Usuario 'games' (/home/games)"
echo "  - Datos de juegos instalados"
echo "  - Archivos del proyecto"
echo "  - Dependencias de Node.js"
echo ""
echo "Para eliminar completamente:"
echo "  - Usuario games:        sudo userdel -r games"
echo "  - Datos de juegos:      sudo rm -rf /home/games"
echo "  - Proyecto:             rm -rf <directorio-del-proyecto>"
