# Nova Pop — Flow Lab

Prototipo funcional independiente para evaluar **compuertas en una fila interior, suministro por segmentos, portales y Seeker**. No es una exportación de Unity y no modifica el proyecto del juego ni partidas reales.

## Abrir y jugar

Abrir `index.html` con sus archivos vecinos, o la publicación de GitHub Pages:

https://chacinjoel.github.io/qr-hopper/novapop-flow-lab/

No requiere instalación, librerías externas, login, red para la simulación, anuncios ni compras. El sonido opcional se sintetiza localmente al activarlo.

Toca grupos conectados de al menos 2 tiles normales del mismo color. Toca un especial para activarlo. Usa **Sugerencia**, **Deshacer**, **Reiniciar** y **Ver flujo**. La demo guarda el estado completo de tu partida y lo restaura al salir, incluso si se interrumpe.

## Recorrido predeterminado

Grid 6 columnas × 8 filas. Segmento A = filas 1–4. Segmento B = filas 5–8. Gravedad descendente.

Por cada carril:

`Incoming → compuerta en fila 5 → 6 → 7 → 8 → portal → 1 → 2 → 3 → 4 (fin)`

No existe arista de caída desde fila 4 a fila 5. El segmento A no recibe relleno superior independiente. El portal transfiere la misma pieza, con su ID, color y tipo; no fabrica ni consume incoming. Si no hay espacio, el flujo espera. Todos los movimientos son por ocupación, nunca por un temporizador que haga circular un tablero lleno.

Se puede elegir entrada en fila 4, 5 o 6. La interfaz recalcula la división y comienza un nivel nuevo. El grafo sigue siendo acíclico.

## Suministro

Tres próximas piezas **por carril** visibles. G2 y G5 tienen perfil mixto activado inicialmente; el interruptor permite pasar a suministro normal y reinicia el nivel.

Ciclo mixto de 16 entregas: Seeker en posiciones 1 y 9, Burst (G2) o Beam (G5) en 5, Prism en 13. Resto: normales. Prism recibe un color de origen. La pieza visible en incoming es la misma que aparece por la compuerta. El contador avanza solo por una entrega nueva confirmada. El tablero inicial está precolocado y no consume el ciclo. El tránsito por portales no lo avanza.

## Recetas

| Grupo | Resultado |
|---|---|
|2–3|Eliminación normal|
|4|Seeker|
|5|Slash: fila|
|6|Beam: columna|
|7–8|Burst: 3×3|
|9+|Prism: normales de su color de origen|

La receta usa el tamaño de un solo grupo normal, nunca destrucciones acumuladas. Crear no activa automáticamente el especial. La pieza nueva se coloca en la celda tocada y después participa en la caída. Las activaciones encadenadas no consumen taps adicionales.

## Reglas específicas del prototipo

- No hay adyacencia de grupos ni de combos a través de la separación entre segmentos. El portal no conecta grupos.
- **Burst se recorta al borde de su segmento**, decisión explícita de esta prueba. Beam sí afecta su columna en ambos segmentos.
- Dos especiales de línea adyacentes producen una cruz de fila y columna. Burst + Burst produce tres filas y tres columnas. Prism + otro especial convierte los normales de su color en ese especial; Prism + Prism alcanza todos los elementos impactables. El compañero se elige por orden arriba/derecha/abajo/izquierda y se muestra en el resaltado.
- Seeker no tiene un combo de pareja nuevo. Puede activar otros especiales con su impacto, o ser activado por ellos.
- Los bloqueos son fijos. Un grupo adyacente o un efecto les aplica un golpe. Los dos bloqueos superiores tienen 2 puntos de resistencia; los dos inferiores, 1.
- Las reliquias son inmunes a impactos; se extraen solo al alcanzar el final del segmento A. Los tiles normales permanecen allí.
- Objetivos: 16 cian, 14 rosa, 4 bloqueos, 2 reliquias; 26 taps. El grupo convertido en especial cuenta como tiles normales recogidos. Puntuación de demostración: 20 por normal, 100 por bloqueo destruido, 300 por reliquia.
- No se implementan Fog, Frozen, Gravity Core, fases Arena, todos los combos posibles, poderes externos, bonus de taps restantes ni balance de campaña. No hay barajado automático: ante un tablero sin jugadas se puede deshacer o reiniciar.

## Seeker

Evaluador determinista local de un impacto. Compara candidatos válidos usando objetivos pendientes, resistencia, liberación de rutas de reliquias, especiales alcanzados, caída, portales y las tres piezas visibles de cada incoming. No consulta piezas futuras ocultas ni el siguiente resultado aleatorio.

Simula efectos y estabilización en una copia. Para Seekers secundarios dentro de las simulaciones utiliza una selección simplificada para acotar el coste; no es un solver óptimo. El lanzamiento real reevalúa el estado vigente. La telemetría explica la elección. La salida del dron deja su celda vacía y ese hueco se incluye en la evaluación. Respeta la inmunidad de las reliquias y los golpes de resistencia.

## Diseño y archivos

`engine.js`: estado puro, suministro determinista, grafo, reglas, simulación, Seeker e inspector de configuración. Compatible con Node para tests.

`app.js`: representación SVG, animaciones, input, demo, audio opcional y exportación. No hay conexión a cuentas, analítica o guardados de Nova Pop.

`style.css`: layout adaptable para escritorio y móvil. Arte original SVG/CSS inspirado en la dirección visual discutida; no se copiaron assets de Unity.

`tests.cjs`: ejecutar `node tests.cjs`.

**Exportar configuración** descarga un JSON explicativo del prototipo. No es todavía un formato de importación de Unity.

## Verificación realizada

14 tests de motor: recetas, rutas, ocupación estable, identidad de portal, entregas únicas, creación, límites de segmento, evaluación sin mutación, inmunidad de reliquias, extracción única, especiales del incoming, Prism, 861 acciones aleatorias en tres distribuciones y una partida ganadora mediante sugerencias en 17 taps.

Prueba de navegador local en Chromium: render de 48 celdas, demo/restauración idéntica de estado, grupo de 4, undo exacto, activación de Seeker, vista táctil 390×844, ayuda y ausencia de excepciones JavaScript en las interacciones comprobadas. La vista móvil es emulada: no equivale a pruebas físicas en Safari/iOS o Android.

Los tests no demuestran balance de producción ni paridad con las reglas completas de Unity. La validación del despliegue de Pages se registra por separado al publicar.

## Seguridad y privacidad

Sin dependencias de CDN, sin secrets, sin envío de datos, sin cambios a otros prototipos. La instalación es solo esta carpeta. Para retirarlo basta revertir el commit que añade `novapop-flow-lab/`.
