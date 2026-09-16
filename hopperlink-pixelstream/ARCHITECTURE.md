# HopperLink X v2 — Optical SuperStream + HDP v1

`archivo → compresión adaptativa → SuperStream → SuperBlocks → RS-FEC → HDP → símbolos ópticos → cámara → HDP lock → demodulación → FEC → SHA-256`

## HDP: HopperLink Discovery Protocol

La localización de la pantalla es una capa independiente del color del payload.

### Área emisora

- Quiet zone negra exterior de 4 celdas.
- Guard rail blanco continuo de 2 celdas.
- Cuatro finders monocromáticos 10×10, asimétricos y reservados.
- Ningún header, sync, calibración ni payload puede pintar sobre finders.
- Aspect ratio del canvas = `cols/rows`; nunca se estira el grid.
- Discovery inicial de 1.2 s con firma temporal.
- Recovery beacon cada 30 frames **sin consumir ni saltar un frame de datos**.

### Receptor

1. Estima rango dinámico de luminancia.
2. Busca componentes blancos conectados compatibles con el rail.
3. Refina sus cuatro esquinas mediante gradiente local.
4. Expande el rail detectado para estimar los límites completos del canvas.
5. Mantiene tracking temporal suavizado y confianza de lock.
6. Prueba orientación/rotación y luego header HDP.
7. Solo tras el lock aprende la paleta RGB observada.
8. Decodifica payload, valida CRC32, recupera RS-FEC y finalmente SHA-256.

El receptor inicia captura y recepción en una sola acción: el usuario únicamente necesita incluir la pantalla emisora dentro del preview; no debe hacer coincidir manualmente ningún marco.

## Métrica prioritaria

Antes de aumentar bits/celda o FPS, medir en hardware real: `time-to-lock`, cobertura mínima de pantalla, inclinación máxima, porcentaje de relock, CRC pass rate y throughput útil.
