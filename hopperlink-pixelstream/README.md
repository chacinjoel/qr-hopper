# HopperLink X — Optical SuperStream v2

Reinicio arquitectónico de HopperLink. La implementación anterior basada en “archivo → frame → imagen” fue reemplazada por un transporte de **bitstream óptico**:

`archivo → análisis → compresión adaptativa → SuperStream → SuperBlocks → Reed-Solomon FEC → símbolos ópticos → pantalla`.

## Principios

- **SuperStream**: el archivo deja de estar atado 1:1 a frames visuales. Se empaqueta como un flujo continuo autocontenido con metadata, SHA-256 y compresión adaptativa.
- **SuperBlocks**: el flujo se corta según la capacidad real del frame óptico. Si la compresión permite representar el equivalente de varios frames lógicos dentro de uno físico, el sistema lo hace automáticamente.
- **Compresión adaptativa**: gzip nativo cuando aporta una mejora real; pass-through para formatos ya comprimidos o alta entropía.
- **FEC real**: Reed-Solomon sistemático sobre GF(256), configurable por perfil (`6+3`, `8+2`, `10+2`).
- **Modulación adaptativa**: perfiles de 2, 3 o 4 bits por celda con grids variables y cadencia configurable.
- **Fiduciales ópticos**: cuatro anclas de color grandes para lock geométrico y futura homografía/demodulación.
- **Separación de capas**: codec, FEC, transporte óptico y cámara están desacoplados para poder mejorar cada capa sin reescribir las demás.

## Estado de esta versión

El **transmisor** ya ejecuta el nuevo pipeline completo hasta el render óptico y muestra métricas de compresión, colapso de frames equivalentes, capacidad y FEC. El **receptor** ya incluye cámara, detector de los cuatro fiduciales y el ensamblador SuperStream/Reed-Solomon. La siguiente iteración debe completar la demodulación física de las celdas desde cámara (calibración de paleta + homografía + header + payload) y luego cerrar el loop adaptativo bidireccional.

## Perfiles

| Perfil | Bits/celda | FEC | Objetivo |
|---|---:|---:|---|
| Robusto | 2 | RS 6+3 | movimiento/ruido |
| Balanceado | 3 | RS 8+2 | uso general |
| Turbo | 4 | RS 10+2 | teléfonos/cámaras de alta calidad |

## Ejecución

Sitio estático sin servidor ni librerías externas. Requiere HTTPS para cámara (`getUserMedia`).
