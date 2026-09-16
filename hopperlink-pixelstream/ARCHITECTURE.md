# HopperLink X v2 — Architecture

## 1. Nuevo modelo mental

No existe una relación obligatoria entre “frame de archivo” y “frame óptico”. HopperLink X trata el archivo como un bitstream continuo y usa cada intervalo de pantalla como un contenedor de símbolos de canal.

## 2. Pipeline

1. **Content analyzer** estima entropía y detecta formatos precomprimidos.
2. **Adaptive compressor** usa gzip sólo si reduce al menos ~1.5%; de lo contrario usa RAW.
3. **Envelope HXS2** agrega nombre, MIME, tamaño, codec, SHA-256 y payload.
4. **SuperBlock splitter** corta por `payloadBytes` derivados de grid × bits/celda.
5. **Reed-Solomon erasure FEC** genera paridad por grupos.
6. **Optical frame builder** añade header fijo, calibración y payload multicolor.
7. **Renderer** pinta anclas, cabecera binaria, banda de calibración y símbolos.
8. **Receiver tracker** detecta cuatro anclas y produce lock geométrico.
9. **Demodulator** (siguiente iteración) corrige perspectiva, aprende la paleta observada y reconstruye bytes.
10. **FEC + assembler** recupera bloques faltantes, recompone HXS2, descomprime y verifica SHA-256.

## 3. Por qué “3 frames en 1” sí tiene sentido

La capa no comprime imágenes ópticas ya codificadas. Comprime **antes** de segmentar. Si 3 bloques lógicos de 2 KB contienen 6 KB originales y el codec los reduce a 1.9 KB, el resultado entra en un solo frame físico de ~2 KB. La interfaz muestra esta ganancia como `Frames equivalentes: baseline → systematic`.

## 4. Fórmula de capacidad

`gross_Bps = usableCells × bitsPerCell × symbolsPerSecond / 8`

La tasa útil descuenta FEC, cabecera, sincronización y eficiencia óptica real.

## 5. Reglas v2

- No re-comprimir datos de alta entropía por costumbre.
- No usar frames lógicos como unidad de transporte.
- FEC antes que retransmisión fina.
- Modulación adaptativa por calidad del canal.
- Fiduciales y calibración ocupan espacio fijo y pequeño.
- El receptor debe validar integridad de extremo a extremo con SHA-256.
