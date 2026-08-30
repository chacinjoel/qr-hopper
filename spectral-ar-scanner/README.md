# Spectral AR Scanner · Spatial Fusion V3

Prototipo web móvil que fusiona cámara, audio, movimiento, orientación y memoria de escaneo espacial.

## Luz premium
Cada fuente luminosa detectada puede incluir intensidad relativa, pico, diferencia frente al ambiente, CCT estimada en kelvin, modulación temporal observada, estabilidad, glare, uniformidad, dirección, confianza y Light Quality Score (LQS). CCT/LQS son estimaciones derivadas de cámara; no sustituyen luxímetro, colorímetro, CRI ni espectrómetro.

## Temperatura
La temperatura ambiental en °C **no está expuesta por Safari/iPhone como sensor web**. El módulo soporta:
- Web Bluetooth Environmental Sensing (0x181A / Temperature 0x2A6E) en navegadores compatibles.
- Puente nativo mediante el evento `spectral-temperature`.
- API de integración `window.SpectralAR.setTemperature(celsius, source)`.

En iPhone Safari, un sensor físico necesita puente nativo u otra vía de datos. El estado térmico del dispositivo de iOS no equivale a temperatura ambiental en °C.

## Otros sensores
- Micrófono con FFT, frecuencia dominante y dBFS relativo.
- Acelerómetro, rotación y orientación.
- Brújula cuando iOS la expone.
- GPS y precisión.
- Detección visual de regiones luminosas y memoria angular de fuentes.

Los datos marcados como ESTIMATED son inferencias; los medidos se muestran por separado. HTTPS y permisos son obligatorios.