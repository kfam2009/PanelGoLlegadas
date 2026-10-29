# PanelGo Llegadas

Gráficos de **llegadas y posiciones** para transmisiones de carreras cronometradas (running, trail, ciclismo,
MTB, natación, triatlón...). Se cargan solos en **vMix** y en **OBS** (también los dos a la vez).
Hecho por **Panel Go**.

## Qué hace

- **Datos de cualquier cronometraje**: se pega un link y el programa detecta solo qué es cada columna
  (puesto, dorsal, nombre, tiempo, distancia, categoría, sexo, club...). Si algo quedó mal, se corrige a mano.
  - **RaceResult** (link del *presenter*): en vivo, al instante.
  - **Cualquier otro**: página de resultados con tabla, planilla de Google (compartida o publicada), CSV, JSON.
    Se revisa cada pocos segundos; cada tiempo nuevo es una llegada.
- **Gráficos** (fondo transparente, 1920×1080):
  - **Llegada**: cartel automático al cruzar (puesto, nombre, tiempo, distancia, categoría, club, logo).
    Si llegan 3 o más juntos, un solo cartel "LLEGADAS".
  - **Posiciones**: tabla por distancia / categoría / sexo, en páginas que rotan (derecha, izquierda o centro).
  - **Podio**: los 3 primeros.
  - **Reloj** de carrera (largada ahora o a una hora).
  - **Logo** fijo de la productora.
- **Diseño a gusto**: estilos listos, colores, letra, tamaño, márgenes, esquinas, textos; estilos guardados por cliente.
- **Logos**: productora, cronometraje y sponsors que rotan.
- **vMix**: crea el input Browser y lo pone en el overlay elegido (1 a 4). **OBS**: crea la fuente de navegador en la
  escena elegida, arriba de todo y escalada al lienzo.
- Panel en una sola pantalla, también desde el **celular**.

## Uso rápido

1. **Iniciar.cmd** (o el instalador). Se abre el panel en `http://127.0.0.1:5200/`.
2. **Resultados**: pegar el link → **CONECTAR**. Revisar "Columnas detectadas".
3. **vMix / OBS**: **CARGAR EN vMix** (elegir overlay) y/o **CARGAR EN OBS** (elegir escena).
   - vMix: Settings › Web Controller activado. OBS 28+: Herramientas › Ajustes del servidor WebSocket › Habilitar.
4. **Al aire**: LLEGADAS (automático), POSICIONES, PODIO, RELOJ, LOGO.
5. Para probar: **CARGAR TODOS** y **PROBAR** (con un dorsal o vacío para uno al azar).

Direcciones para cargar a mano: `/graficos.html` (todo, se maneja desde el panel) o una capa sola:
`/graficos.html?capa=llegada|posiciones|podio|reloj`.

## Técnico

- `server.mjs` (Node 20.6+, sin dependencias), puerto 5200 (`PORT`).
- `lib/detectar.mjs`: lectura de JSON/CSV/HTML/Google Sheets y detección de columnas. `lib/fuentes.mjs`: RaceResult y link genérico.
  `lib/motor.mjs`: corredores, llegadas y tablas. `lib/salidas.mjs`: vMix (API web) y OBS (obs-websocket 5).
- `public/graficos.html`: los gráficos. `public/index.html`: el panel.
- `build/armar-instalador.sh`: instalador de Windows con Node adentro y el código cifrado.
- Tests: `npm test`.
