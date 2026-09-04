# HopperLink ONE · HopperCore 1.1

HopperLink ONE reemplaza la selección HPS7/HPS8 por un solo motor óptico adaptativo. La aplicación activa ya no carga módulos HPS7 ni HPS8.

## Arquitectura activa

- **TriFrame 3-Lane:** tres paquetes físicos independientes por frame de pantalla, con matriz 36×60 por lane en horizontal y 60×36 en vertical.
- **Fullscreen real:** usa Fullscreen API, Wake Lock y bloqueo de orientación cuando el navegador lo permite.
- **Geometría constante:** HELLO y DATA utilizan desde el comienzo los mismos tres cuadrantes. No existe una transición cuadrado → 1:2 que obligue al receptor a perder y recuperar la homografía.
- **AutoDock 3:** detecta los tres marcos cian, mide el grosor de sus rieles, calcula la homografía de cada cuadrilátero, los ordena y recorta automáticamente. Cada lane se decodifica por separado.
- **HopperCore packet layer:** sesión, tipo, lane, secuencia, símbolo/seed y CRC32 por paquete.
- **Fountain Recovery:** dos lanes priorizan bloques systematic y el tercero emite ecuaciones XOR; después de la primera cobertura los tres se convierten en Fountain/repair continuo.
- **Sonic Assist:** ACK y COMPLETE auxiliares por audio. El enlace óptico no depende del audio.
- **Integridad final:** CRC32 y SHA-256 antes de habilitar la descarga.
- **Flight Recorder:** línea de tiempo local y exportable en JSON/CSV con estados, métricas, confianza, fallos CRC, locks, cambios de velocidad y señales sónicas.

## Uso

### Emisor
1. Selecciona el archivo y pulsa **Preparar archivo**.
2. Pulsa **Abrir fullscreen TriFrame**.
3. Muestra la pantalla completa al receptor.
4. DATA comienza con el botón visible o automáticamente al detectar el ACK sónico.

### Receptor
1. Pulsa **Iniciar cámara**.
2. Incluye la pantalla emisora completa; no es necesario encuadrar cada cuadrante.
3. AutoDock 3 dibuja A/B/C y procesa todos los paquetes válidos.
4. Cuando Fountain Recovery resuelve los bloques y CRC32/SHA-256 coinciden, aparece **Guardar archivo**.

## Compatibilidad

La aplicación necesita HTTPS para cámara/micrófono. Fullscreen, orientación y Wake Lock dependen de las capacidades del navegador; sus fallos no detienen la transferencia. Todos los datos se procesan localmente.
