# HDP v2 Lighthouse

Rediseño de adquisición óptica motivado por pruebas reales de teléfono-a-teléfono.

Principio: el receptor ya no intenta descubrir el área de emisión por el borde del teléfono ni por un rail exterior. La adquisición usa cuatro balizas grandes, cromáticamente distintas y geométricamente conocidas, sobre fondo negro. Durante DATA permanecen pilotos pequeños en las mismas posiciones y el receptor busca esos pilotos alrededor de su posición esperada.

Secuencia:
1. Emisor entra en modo de emisión de pantalla completa/fallback fixed viewport.
2. Durante ~1.8 s muestra LIGHTHOUSE: 4 balizas gigantes TL magenta, TR cian, BR amarillo, BL verde.
3. El receptor busca componentes cromáticos grandes y conectados, valida su geometría y obtiene una homografía a partir de los centros de las 4 balizas.
4. DATA usa pilotos persistentes más pequeños en las mismas coordenadas.
5. Cada ~18 frames se mantiene un beacon de reacquisición ~120 ms para que una cámara no sincronizada tenga alta probabilidad de verlo.
6. Header/payload nunca pisan las zonas reservadas de pilotos.
7. El área óptica toma todo el viewport aunque Fullscreen API no esté disponible.

La prioridad es lock rápido y estable. La densidad óptica se incrementará después de medir time-to-lock, CRC pass rate y throughput real.
