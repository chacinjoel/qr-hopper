# HopperLink ONE · HopperCore 1.2

HopperLink ONE utiliza un único motor óptico adaptativo con tres cuadrantes fullscreen. La modulación es seleccionable antes de preparar el archivo y el receptor la detecta automáticamente.

## Modos ópticos

| Modo | Símbolos | Bits/celda | Carga útil por lane | Teórico a 8–12 fps |
|---|---:|---:|---:|---:|
| Robusto | 4 niveles | 2 | 480 B | 11.3–16.9 KiB/s |
| Color Adaptativo | 8 colores | 3 | 736 B | 17.3–25.9 KiB/s |
| Color Turbo | 16 colores | 4 | 1,000 B | 23.4–35.2 KiB/s |

Cada modo conserva los tres lanes físicos. Los 64 pilotos RGB de cada cuadrante calibran la cámara en el mismo frame, y CRC32 confirma que la clasificación de color y el modo son correctos antes de aceptar un paquete.

## Arquitectura activa

- **TriFrame 3-Lane:** tres paquetes físicos independientes por actualización de pantalla.
- **Fullscreen real:** Fullscreen API, Wake Lock y orientación cuando el navegador lo permite.
- **Geometría constante:** HELLO y DATA mantienen los mismos tres cuadrantes.
- **AutoDock 3:** detecta, ordena y corrige la perspectiva de los tres marcos cian.
- **Color calibration:** genera centroides RGB por lane a partir de cuatro bloques piloto 4×4.
- **Auto-detección:** antes del lock prueba 2, 3 y 4 bits; después del HELLO mantiene el modo de la sesión.
- **Fountain Recovery:** systematic + ecuaciones XOR para recuperar bloques perdidos.
- **Sonic Assist:** ACK y COMPLETE auxiliares; el canal óptico funciona sin audio.
- **Integridad final:** CRC32 por paquete y CRC32 + SHA-256 para el archivo.
- **Flight Recorder:** registra modo, bits, confianza, CRC, locks y cambios de velocidad.

## Uso

### Emisor
1. Selecciona Robusto, Color Adaptativo o Color Turbo.
2. Selecciona el archivo y pulsa **Preparar archivo**.
3. Abre **fullscreen TriFrame** y muestra toda la pantalla al receptor.
4. Inicia DATA manualmente o mediante ACK sónico.

### Receptor
1. Pulsa **Iniciar cámara**.
2. Incluye la pantalla emisora completa.
3. AutoDock 3 encuentra A/B/C y el motor identifica la modulación por pilotos RGB + CRC32.
4. Cuando Fountain Recovery resuelve todos los bloques y la integridad coincide, se habilita **Guardar archivo**.

La cámara y el micrófono requieren HTTPS. Todo el procesamiento se realiza localmente.
