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
node tests/integration/threads-execution.test.js
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

```

## Arquitectura

El proyecto sigue una separacion en tres capas:

1. Capa de datos (`data.js`): mantiene el estado de la aplicacion.
2. Capa de motor (`engine/`): funciones puras que ejecutan los algoritmos. No tocan el DOM y se pueden probar en Node.
3. Capa de renderizado (`render/`): consume las trazas generadas por el motor y las dibuja en pantalla.

### Threads, Fork y Multi-Core

La pantalla Threads usa un `Dispatcher` que instancia un Web Worker por thread schedulable. El Dispatcher mantiene la politica de scheduling y asigna threads a cores segun el algoritmo seleccionado; los Workers ejecutan ticks reales fuera del hilo principal del navegador.

Fork se simula con `simulatedFork(parentPid)`: crea un proceso hijo schedulable, hereda atributos del padre y marca sus paginas como copy-on-write. La pantalla Memory muestra paginas COW con candado y materializa una copia visual cuando se escribe sobre una pagina compartida.

Limitaciones declaradas: MLQ y MLFQ se ejecutan single-core con warning; COW es una simulacion visual y no altera las metricas de scheduling.

Reporte tecnico completo:

```
docs/reporte-tecnico.md
```

Guia de defensa y captura de Workers:

```
docs/defensa-threads.md
```

## Despliegue

La aplicacion esta pensada para correr en `ubiquitous.udem.edu`. No requiere paso de build ni bundler, solo se sirven los archivos estaticos. Se usan rutas relativas para que funcione desde cualquier subdirectorio del servidor.

Para Web Workers, el servidor debe servir `.js` con MIME JavaScript (`application/javascript` o `text/javascript`). En Apache, si hace falta:

```
AddType application/javascript .js
AddType text/css .css
```

## Requisitos

- Navegador moderno con soporte de ES modules y Canvas 2D.
- Node.js (solo para correr las pruebas).
- Un servidor web local para abrir la aplicacion (ver seccion "Como ejecutar").
