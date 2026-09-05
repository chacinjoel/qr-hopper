# HopperLink ONE · HopperCore 1.5.0 · H7 Static Guide

Build 1500, protocol 5. La adquisición vuelve al flujo simple inspirado en HPS7: **guía óptica estática → validación del archivo → ACK sónico → DATA TriFrame**.

## Flujo

1. El emisor prepara el archivo y abre fullscreen.
2. Aparece una guía gris fija con las cuatro referencias HPS7 grandes. Los tres sectores contienen tres partes fijas del mismo descriptor rápido; no hay carrusel ni cambios cada 400 ms.
3. El receptor acumula esas tres partes, valida CRC32 y obtiene nombre, tamaño, modo, número de bloques y tamaño de bloque.
4. Solo después crea la sesión y emite ACK por sonido.
5. El emisor escucha ACK y cambia a DATA tras la demora de seguridad existente.
6. Durante DATA se siguen enviando fragmentos de metadata completa de baja frecuencia para actualizar nombre completo/SHA-256 sin bloquear el arranque.

La guía rápida admite hasta 36 bytes UTF-8 del nombre para el primer reconocimiento. Si el nombre real es más largo, la metadata completa transmitida durante DATA actualiza el nombre. El CRC32 del archivo está en la guía; SHA-256 se conserva en la metadata completa.

Los modos DATA siguen siendo 2-bit/3-bit/4-bit y las capacidades por lane no cambian. Sonic Assist continúa siendo ACK/COMPLETE básico.
