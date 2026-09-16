# HopperLink Adaptive 1.0.0

## Qué incluye

`index.html` abre la versión adaptativa. Ambos teléfonos deben usar Adaptive 1. La versión HDP 2.1 anterior sigue disponible en `legacy.html`, con sus métricas, rescates y retorno experimental por flash. Los cinco módulos originales de óptica, FEC, compresión y CRC se conservan sin modificaciones y las pruebas verifican sus hashes.

Esta versión utiliza un protocolo negociado nuevo, HAP1. No interpreta silenciosamente un paquete HDP anterior como HAP1. Se conserva la convención Lighthouse de cuatro balizas, pero se añaden separación respecto al payload, referencias cromáticas distribuidas y cabeceras con CRC propio.

## Calibración de la sesión

A = emisor: pantalla para datos y micrófono para escuchar respuestas. B = receptor: cámara trasera para leer y altavoz para devolver resultados. El archivo no viaja por audio, red, Bluetooth ni servidor.

1. A anuncia una sesión en un perfil monocromático fijo con celdas grandes.
2. B reproduce paquetes conocidos en tres familias de frecuencias. A mide cuáles decodificó correctamente y su separación espectral; devuelve la banda elegida por pantalla.
3. A transmite tres grupos FEC de datos conocidos por candidato. Modo rápido: cuatro candidatos, más una sugerencia previa si existe. Modo completo: diez candidatos.
4. B cuenta todos los frames esperados, incluidos los que nunca pudo leer, y compara bytes conocidos. Ejecuta el decodificador Reed-Solomon real para medir datos recuperados. Los duplicados no inflan el resultado.
5. B devuelve un informe compacto mediante sonido o QR. Se comparan perfiles por velocidad útil medida, margen estadístico y movimiento; no por el máximo número de colores.
6. Los dos mejores candidatos se validan con otra semilla y una ronda diferente.
7. Se hace una tercera prueba, nuevamente distinta, del perfil elegido. Después se intercambian OFFER y READY con sesión, época, perfil y huella del informe.
8. Solo entonces se segmenta y habilita el envío del archivo usando el perfil acordado.

El catálogo incluye blanco/negro, dos paletas de cuatro colores, ocho y dieciséis colores; matrices 64×96, 72×112 y 84×132; cadencias de 15/20/25 por segundo y RS 6+3, 8+2 y 10+2. Es la mejor configuración entre las evaluadas, no una optimización ilimitada ni una garantía universal. No se crea todavía una paleta arbitraria a partir de todos los colores posibles.

Las pruebas usan celdas y patrones reales, con vecinos y referencias distribuidas. Se conservan matrices de confusión durante cada prueba y se exportan los resultados agregados. El rendimiento se calcula con bytes de fuente reconstruidos y duración observada, no FPS solicitados. Si ningún candidato supera los criterios, se pide repetir la calibración, sin inventar un ganador.

Una prueba corta no demuestra ausencia de errores futuros. La calibración rápida también consume decenas de segundos; la completa puede costar más que enviar un archivo pequeño. Un perfil previamente usado solo ordena candidatos y siempre se vuelve a evaluar. No se usa un resultado antiguo como garantía para otros teléfonos.

## Sonido y QR

4-FSK, símbolos de 20 ms, transiciones suaves de 2 ms, preámbulo de 20 símbolos, Hamming(12,8) y CRC16. Paquete fijo de 20 bytes: aproximadamente **2,84 segundos**, incluidos 40 ms de silencio de guarda. No es un sonido inaudible ni instantáneo.

Bandas candidatas, en Hz:
- 1400, 1800, 2200, 2600.
- 2300, 2700, 3100, 3500.
- 3500, 3900, 4300, 4700.

Un AudioWorklet del emisor procesa ventanas de 10 ms cada 5 ms. Web Audio programa la reproducción usando su reloj de audio. El micrófono solo se abre con permiso del usuario, no se guarda ni se sube audio. Las condiciones del dispositivo pueden impedir la captura o reproducción; en ese caso se ofrece QR. Evitar auriculares y usar volumen moderado. No se promete fiabilidad a cualquier volumen, ruido o modelo de teléfono.

REPORT devuelve perfil y huella; READY confirma acuerdo. COMPLETE solo se emite después de reconstrucción y SHA-256 completo correctos, e incluye sesión, época, perfil y una huella de 32 bits del archivo. A valida el paquete y detiene las repeticiones pendientes. A muestra CLOSED ópticamente. Sesión y CRC previenen confusiones accidentales, pero **no autentican criptográficamente al otro teléfono**.

El QR es estático, monocromático, con margen de cuatro módulos y corrección M. Usa paquetes locales qrcode-generator 1.4.4 y jsQR 1.4.0 con atribuciones y SHA-256. No se descarga código de CDN durante el uso. El informe también puede pegarse como texto HAC1 con CRC.

Para escanear el QR, B gira temporalmente su pantalla hacia la cámara de A. Después se recolocan los teléfonos y se pulsa continuar validación. Puede requerirse otro intercambio QR para el resultado de validación. Sin retorno acústico, el usuario confirma manualmente que B muestra LISTO; esa alternativa no se presenta como automática.

## Movimiento y lectura

La búsqueda se realiza a resolución reducida y la lectura llega hasta 1280 píxeles de ancho de la captura. Se usan las posiciones actuales refinadas para decodificar; el suavizado queda exclusivamente para dibujar el marco. Así no se introduce el retraso intencionado del polígono en el muestreo de celdas.

Se utiliza requestVideoFrameCallback cuando existe, con alternativa rAF condicionada a un currentTime nuevo. Cada celda se lee mediante cuatro muestras interiores con interpolación bilineal. Las referencias de paleta se reparten espacialmente y se clasifican usando media y variación por región. Los ajustes manuales de enfoque/exposición/balance se solicitan solo cuando la cámara expone un modo manual y un valor numérico actual; de lo contrario se mantienen automáticos y se registra.

Esta implementación utiliza componentes cromáticos y refinamiento local de centros; **no implementa todavía flujo Lucas–Kanade ni estabilización física del sensor**. No recupera información destruida por desenfoque severo. Los CRC incorrectos se descartan; el progreso ya válido se conserva.

## Carrusel y adaptación durante DATA

Se reutilizan HXS2, selección de compresión, SHA y FEC. Cada bloque sistemático tiene cuatro oportunidades distribuidas en dos recorridos lógicos desfasados y dos inversos con otro punto de inicio; también se emite paridad. Hay una sola matriz física: no se promete el doble de capacidad gratis. Los metadatos tienen prioridad.

El perfil de celdas/paleta/FEC permanece fijo durante el archivo. Si el receptor observa degradación persistente, SLOW reduce la cadencia y agrega un rescate, sin cambiar tamaños de bloque. STATUS puede solicitar grupos faltantes al final; los reintentos están acotados. Cambiar densidad o paleta requiere una sesión nueva. No se sube automáticamente de perfil a mitad de un grupo.

El emisor repite BEGIN durante pausas de referencia para permitir recuperar el descriptor sin reiniciar bloques. Sin COMPLETE válido, finaliza como emisión no confirmada. No confunde vaciar la cola con éxito en el receptor.

El panel conserva nombre, tamaño original, bytes únicos del flujo, porcentaje, velocidad actual/media, tiempo transcurrido, estimación restante y faltantes. El 100 % se reserva para SHA-256 OK. Calibración y duplicados no cuentan como descarga. El diagnóstico exportable permite medir condiciones reales.

## Pruebas y límites de la evidencia

La batería combina las doce pruebas originales con pruebas nuevas de layout, paletas, cabecera CRC, rondas distintas, pérdidas de prueba, FEC real, QR/sesión, cuatro oportunidades, PCM con ruido a 44,1/48 kHz, rechazo de tonos ajenos, negociación y SHA.

La prueba de navegador abre dos páginas reales: canvas de A a vídeo de B; PCM generado por B a MediaStream y AudioWorklet de A. No inyecta un ACK falso ni marca el archivo como recibido sin decodificar. Verifica HTML, óptica, informe acústico, READY, archivo, SHA y parada de la cola. Es una prueba de software con canales sintéticos, **no una medición en teléfonos físicos, bajo sol, con movimiento real o con altavoces/micrófonos de hardware**.

El acceso inicial a una página no almacenada necesita cargar sus archivos. No se afirma que una página nunca abierta pueda arrancar sin Internet. Tras cargarla, los datos se procesan localmente.

Referencias primarias: W3C Web Audio (https://www.w3.org/TR/webaudio/), W3C Image Capture (https://www.w3.org/TR/image-capture/), requestVideoFrameCallback (https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).
