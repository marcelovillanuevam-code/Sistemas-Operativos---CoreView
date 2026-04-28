# CoreView

Simulador de planificacion de procesos (scheduling) y paginacion de memoria para sistemas operativos.

## Descripcion

CoreView es una aplicacion web educativa que permite visualizar y comparar distintos algoritmos de planificacion de CPU y de reemplazo de paginas en memoria. Esta hecha con HTML, CSS y JavaScript puro (sin frameworks) y usa ES modules.

## Algoritmos incluidos

### Planificacion de procesos
- FCFS (First Come First Served)
- SJF (Shortest Job First)
- SRTF (Shortest Remaining Time First)
- Priority (con y sin expropiacion)
- Round Robin
- HRRN (Highest Response Ratio Next)
- MLQ (Multilevel Queue)
- MLFQ (Multilevel Feedback Queue)

### Paginacion de memoria
- FIFO
- LRU (Least Recently Used)
- Optimal
- Second Chance
- Clock

## Como ejecutar

IMPORTANTE: este proyecto usa ES modules (`type="module"`), por lo que NO funciona si se abre el archivo `index.html` directamente con doble clic en el navegador. Se debe servir desde un servidor web local, de lo contrario el navegador bloqueara la carga de los modulos por las reglas de CORS.

### Opciones para levantar un servidor local

Desde la carpeta del proyecto, puedes usar cualquiera de estas opciones:

Con Python 3:
```
python -m http.server 8000
```

Con Node (npx):
```
npx serve
```

Con la extension Live Server de VS Code: clic derecho sobre `index.html` y seleccionar "Open with Live Server".

Despues abrir en el navegador:
```
http://localhost:8000
```

## Como ejecutar las pruebas

Las pruebas estan escritas en JavaScript puro y se corren con Node:

```
node tests/test-scheduling.js
node tests/test-paging.js
node tests/test-threads.js
```

## Estructura del proyecto

```
CoreView/
  index.html              Pagina principal
  app.js                  Punto de entrada de la aplicacion
  data.js                 Estado y datos de la aplicacion
  types.js                Definiciones de tipos (JSDoc)
  style.css               Estilos
  engine/                 Logica pura de los algoritmos
  render/                 Dibujado en Canvas y DOM
  screens/                Pantallas de la interfaz
  tests/                  Pruebas unitarias
  assets/                 Recursos estaticos
  ARCHITECTURE.md         Documentacion de arquitectura
```

## Arquitectura

El proyecto sigue una separacion en tres capas:

1. Capa de datos (`data.js`): mantiene el estado de la aplicacion.
2. Capa de motor (`engine/`): funciones puras que ejecutan los algoritmos. No tocan el DOM y se pueden probar en Node.
3. Capa de renderizado (`render/`): consume las trazas generadas por el motor y las dibuja en pantalla.

Para mas detalle sobre estructuras de datos, contratos y casos de prueba, revisar `ARCHITECTURE.md`.

## Despliegue

La aplicacion esta pensada para correr en `ubiquitous.udem.edu`. No requiere paso de build ni bundler, solo se sirven los archivos estaticos. Se usan rutas relativas para que funcione desde cualquier subdirectorio del servidor.

## Requisitos

- Navegador moderno con soporte de ES modules y Canvas 2D.
- Node.js (solo para correr las pruebas).
- Un servidor web local para abrir la aplicacion (ver seccion "Como ejecutar").
