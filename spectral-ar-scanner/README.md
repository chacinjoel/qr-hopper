# Spectral AR Scanner

Prototipo web móvil que superpone datos de sensores sobre la cámara en tiempo real.

## Mide cuando el navegador lo permite
- Cámara trasera y luminancia relativa de la imagen.
- Micrófono con FFT: frecuencia dominante, nota aproximada y nivel relativo dBFS.
- Acelerómetro y velocidad de rotación vía DeviceMotion.
- Orientación y rumbo/brújula vía DeviceOrientation cuando el navegador entrega datos absolutos.
- GPS y precisión reportada.
- Network Information API cuando existe.
- Detección de disponibilidad de Web Bluetooth.

## Límites importantes
Un HTML en iPhone/Safari no tiene acceso directo al espectro RF de Wi‑Fi/5G/Bluetooth, RSSI Wi‑Fi, canal GHz ni al magnetómetro crudo en µT. Esos datos requieren APIs nativas, permisos/plataformas compatibles o hardware externo. Las ondas dibujadas son una visualización de las mediciones disponibles, no una imagen física directa del campo electromagnético.

Cámara, micrófono y sensores requieren HTTPS y permisos del usuario.
