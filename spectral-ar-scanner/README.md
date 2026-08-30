# Spectral AR Scanner · Spatial Fusion

Prototipo web móvil que combina cámara, micrófono, orientación, movimiento y contexto del dispositivo en un visor espacial en tiempo real.

## Flujo V2
1. **Preparación espacial**: activa permisos y explica límites de medición.
2. **Barrido de sonido**: giro 360°; relaciona rumbo, nivel dBFS y frecuencia dominante para estimar direcciones acústicas.
3. **Barrido de luz**: detecta regiones brillantes en los frames y las consolida por rumbo aproximado.
4. **Calibración de movimiento**: crea una referencia de aceleración y rotación.
5. **Entorno y sensores**: registra disponibilidad de brújula, GPS y capacidades web.
6. **Visor Spatial Fusion**: fusiona el scan almacenado localmente con datos en vivo y proyecta las fuentes recordadas sobre la cámara según el rumbo actual.

## Datos medidos
- Cámara trasera y luminancia relativa.
- Regiones luminosas activas dentro del frame.
- Micrófono con FFT: frecuencia dominante y nivel relativo dBFS.
- Acelerómetro y velocidad de rotación vía DeviceMotion.
- Orientación y rumbo/brújula cuando el navegador los entrega.
- GPS y precisión reportada.

## Datos estimados
- Dirección de fuentes acústicas a partir de un barrido angular con un solo stream de micrófono.
- Asociación espacial de fuentes guardadas con el rumbo actual.
- Clasificación acústica básica por banda de frecuencia.

## Persistencia
La última calibración se guarda localmente en `localStorage` del navegador y puede borrarse o reemplazarse desde el visor.

## Límites importantes
Un HTML en iPhone/Safari no tiene acceso directo al espectro RF de Wi‑Fi/5G/Bluetooth, RSSI Wi‑Fi, canal GHz ni al magnetómetro crudo en µT. Esos datos requieren APIs nativas, permisos/plataformas compatibles o hardware externo. Las visualizaciones son una combinación de mediciones disponibles y estimaciones explícitamente identificadas; no representan una imagen física directa de campos electromagnéticos.

Cámara, micrófono y sensores requieren HTTPS y permisos del usuario.
