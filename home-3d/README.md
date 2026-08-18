# Home 3D — croquis interactivo

Aplicación web 3D en un solo archivo, creada como subproyecto dentro de `qr-hopper`.

## Distribución fijada

- Casa principal: **8 × 16 m**.
- Porche frontal techado: **8 × 4 m**.
- Porche trasero techado: **8 × 2 m**.
- Lado izquierdo, de frente a fondo:
  - Habitación 1: **4 × 4 m**.
  - Baño 1: **4 × 2 m**, acceso exclusivamente desde Habitación 1.
  - Habitación 2: **4 × 4 m**.
  - Baño 2: **4 × 2 m**, acceso exclusivamente desde Habitación 2.
  - Habitación 3: **4 × 4 m**, sin baño privado.
- Lado derecho:
  - Sala al frente: **4 × 6 m**.
  - Comedor abierto: **4 × 3 m**.
  - Cocina: **4 × 3 m**.
  - Muro con paso alineado y corredor posterior hasta la salida recta al porche trasero.
- Baño anexo: **4 × 2 m**, adosado por fuera del rectángulo principal en el costado derecho trasero, con **una sola puerta desde el corredor interior** y sin puerta exterior.
- Las puertas de las habitaciones abren hacia el interior de cada habitación; las puertas de los baños privados abren desde su habitación hacia el baño; las puertas exterior frontal y trasera abren hacia el interior de la casa.

## Controles

La app permite rotar y hacer zoom, cambiar entre vista 3D/planta/frente/fondo/laterales, mostrar u ocultar etiquetas, mobiliario, cuadrícula y techos de los porches, además de guardar una captura PNG.

## Publicación

Si GitHub Pages del repositorio está configurado para publicar la rama `main` desde la raíz, esta app queda disponible bajo la ruta `/home-3d/` del sitio del repositorio.

> Croquis conceptual: antes de construir debe convertirse en planos técnicos y validarse estructura, instalaciones y normativa local.
