# Calibra — web preview

Mockup **estático** de la demo funcional de **Calibra** (Calibra by Carpathya):
clasificación de envases retornables.

Este repo es **solo el preview publicado**. El código fuente vive en el monorepo
`calibra`, carpeta `mockup/` — acá se copia el contenido para publicarlo.

## Contenido

- `index.html` — la demo (vistas Trabajador / Operador / Administrador).
- `app.js`, `state.js`, `data.js` — lógica, estado y datos de la demo.
- `styles.css` — estilos.
- `lib/panzoom.min.js` — pan & zoom del mapa.

**Sin build ni dependencias**: son scripts clásicos en orden. Se puede abrir
`index.html` con doble clic (`file://`) y funciona igual.

## Publicación (GitHub Pages)

Se sirve desde la rama `master`, carpeta raíz. El archivo `.nojekyll` desactiva
el procesamiento de Jekyll para que todo se entregue tal cual.

Para actualizar el preview: copiar el contenido de `mockup/` del repo `calibra`
acá, commitear y pushear.

URL: <https://carpathya.github.io/calibra-web-preview/>
