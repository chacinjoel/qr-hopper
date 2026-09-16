# HopperLink X — Optical SuperStream v2 + HDP v1

HopperLink X reemplaza el modelo antiguo `archivo → frame → imagen` por un transporte óptico continuo:

`archivo → análisis → compresión adaptativa → SuperStream → SuperBlocks → Reed-Solomon FEC → HDP → símbolos ópticos → cámara`.

## HDP v1 — HopperLink Discovery Protocol

La adquisición visual y la lectura de datos son capas separadas. El receptor primero encuentra el área de emisión usando una geometría monocromática robusta y solo después intenta demodular color.

- Quiet zone negra exterior.
- Guard rail blanco de alto contraste.
- Cuatro finders B/N protegidos y asimétricos.
- Discovery inicial con firma temporal Barker.
- Aspect ratio exacto según el grid activo.
- Recovery beacon cada 30 frames para relock rápido.
- Header, calibración y payload no pueden sobrescribir los finders.
- Tracking temporal suavizado en el receptor.
- Calibración cromática después del lock, no antes.

## SuperStream

- Compresión adaptativa: comprime solo cuando realmente reduce tamaño.
- Pass-through para formatos ya comprimidos o de alta entropía.
- El archivo no está ligado 1:1 a frames visuales.
- SuperBlocks se dimensionan según la capacidad óptica del perfil.
- Reed-Solomon sistemático GF(256) para recuperación de bloques.
- CRC32 por frame y SHA-256 de extremo a extremo.

## Perfiles

| Perfil | Bits/celda | FEC | Objetivo |
|---|---:|---:|---|
| Robusto | 2 | RS 6+3 | movimiento/ruido |
| Balanceado | 3 | RS 8+2 | uso general |
| Turbo | 4 | RS 10+2 | cámaras/pantallas de alta calidad |

## Estado

El transmisor implementa SuperStream + FEC + HDP. El receptor localiza primero el perímetro monocromático, estabiliza el quad, prueba el header HDP, calibra la paleta y reconstruye el archivo cuando la señal es válida.

Los parámetros de HDP son una base experimental. La siguiente fase es medir lock, BER, distancia, inclinación y cobertura de pantalla en teléfonos reales y ajustar los umbrales automáticamente.
