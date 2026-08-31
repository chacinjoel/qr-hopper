# HopperLink + PixelStream MVP v0.1

Prototipo offline-first para transferir archivos de una pantalla a otra cámara sin Internet.

## Qué hace
- Selecciona un archivo en el dispositivo emisor.
- Empaqueta metadata + contenido.
- Fragmenta el paquete en frames.
- Cada frame usa un identificador de transferencia, índice, total, longitud y CRC32.
- Convierte bytes en 4 niveles ópticos (2 bits por celda).
- Emite los frames en bucle.
- El receptor usa la cámara, captura la cuadrícula, valida CRC y guarda frames únicos.
- Cuando tiene todos los frames reconstruye y permite guardar el archivo original.

## Importante
- MVP experimental: requiere alinear manualmente el patrón con la guía de la cámara.
- No hay cifrado todavía.
- En iOS/Safari `getUserMedia` requiere HTTPS (o una PWA instalada servida previamente por HTTPS).
- Para archivos grandes, PixelStream no compite con Wi‑Fi; su objetivo es ser un fallback óptico universal.

## Próximas fases sugeridas
1. Marcadores ópticos + homografía para corrección automática de perspectiva.
2. Fountain/Raptor-style erasure coding para no depender de recibir todos los índices exactos.
3. Cifrado X25519 + HKDF + ChaCha20-Poly1305.
4. Handshake QR/NFC y selección automática de transporte HopperLink.
5. Wi‑Fi LAN/P2P para archivos grandes; PixelStream como bootstrap/fallback.
6. AudioBurst como tercer transporte offline.
