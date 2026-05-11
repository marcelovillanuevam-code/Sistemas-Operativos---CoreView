# Reporte tecnico: CoreView

## Threads, Fork y Multi-Core

### Arquitectura: Workers + Dispatcher + trace como decisor

La pantalla Threads ejecuta procesos mediante un `Dispatcher`. El Dispatcher
recibe la lista de procesos, algoritmo, quantum, numero de cores y velocidad de
simulacion. A partir de eso construye una traza deterministica y la usa como
decisor de scheduling.

Cada thread schedulable tiene un Web Worker dedicado (`engine/thread-worker.js`).
El Worker ejecuta ticks de CPU simulados y responde al hilo principal con
mensajes `ready`, `tick`, `done` y `preempted`. El Dispatcher mantiene el estado
global, asigna threads a cores, aplica preempciones y emite `onCoreUpdate` para
que la pantalla dibuje el Gantt en tiempo real.

La pantalla no redibuja el Gantt en cada evento directamente. Los eventos de
core actualizan un buffer y el render consume ese buffer con
`requestAnimationFrame`, evitando jank visible durante ejecucion.

### Justificacion de Workers como threads reales

MDN documenta que Web Workers permiten ejecutar scripts en un thread de fondo
separado del hilo principal de la aplicacion web:

- https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
- https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers

MDN tambien describe `Worker` como la interfaz que representa una tarea en
segundo plano creada por script y que se comunica con su creador por mensajes:

- https://developer.mozilla.org/en-US/docs/Web/API/Worker

En CoreView, cada instancia de `Worker` carga `engine/thread-worker.js`; por eso
la defensa puede mostrar workers activos en DevTools mientras el Dispatcher esta
corriendo.

### Dispatcher y proposito educativo

El dispatcher orquesta los Workers segun el algoritmo seleccionado. El proposito
educativo es visualizar diferentes politicas de scheduling, no que el navegador
decida. Los Workers ejecutan paralelo real bajo direccion del dispatcher.

Esto permite separar dos conceptos:

- Paralelismo real del runtime: los Workers ejecutan fuera del main thread.
- Politica de scheduling: CoreView decide que thread corre en que core segun
  FCFS, SJF, HRRN, RR, SRTF o Priority preemptive.

### Fork simulado

`simulatedFork(parentPid)` replica el comportamiento observable de `fork()` para
fines educativos:

- Asigna un PID nuevo.
- Crea un proceso hijo schedulable como cualquier otro proceso.
- Hereda burst, prioridad, paginas compartidas y threads.
- Marca las paginas del padre y del hijo como copy-on-write (COW).
- Al escribir una pagina COW, esa pagina se materializa como copia privada y se
  remueve el indicador COW de esa pagina en ambos procesos.

No se invoca una syscall real. CoreView corre en navegador, donde JavaScript no
tiene acceso a primitivas del kernel como `sys_fork`, tablas reales de paginas,
file descriptors o signal handlers.

### Visualizacion COW

La pantalla Memory renderiza paginas COW con borde doble y candado. Cada pagina
tiene un boton `Write to page X`:

- Si la pagina es COW, se simula duplicacion de pagina, se asigna un nuevo frame
  fisico al escritor y desaparece el indicador COW de esa pagina.
- Si la pagina no es COW, se actualiza la version de contenido con una animacion
  leve, sin duplicar frame.

Esta simulacion es visual. No modifica las metricas de CPU ni el resultado del
scheduler.

### Limitaciones declaradas

- MLQ y MLFQ corren single-core cuando se solicita multi-core. La razon es que
  requieren coordinacion de colas multinivel entre cores; para esta entrega se
  preserva la correccion educativa single-core con un warning claro.
- COW solo se simula a nivel visual y de modelo educativo de paginas.
- El tiempo wall-clock depende de timers del navegador, carga del equipo y
  throttling de pestañas. Las metricas defendibles son las de tiempo simulado.
- Web Workers no pueden manipular el DOM directamente; todo cambio visual vuelve
  al main thread mediante mensajes.

### Verificacion

Suite nueva:

```powershell
node tests/integration/threads-execution.test.js
```

Resultado local:

```text
Result: 502 passed, 0 failed
```

Verificacion HTTP local:

```text
GET http://127.0.0.1:8765/engine/thread-worker.js
Status: 200
Content-Type: text/javascript
```

Cobertura:

- Appendix C.2 FCFS, C.3 RR(q=2), C.4 P3/FCFS.
- Tolerancia de metricas observadas vs trace deterministico menor o igual a
  10%.
- Multi-core con 2 y 4 cores para Appendix C.
- Multi-core para FCFS, SJF, HRRN, RR, SRTF y Priority preemptive.
- Fork + COW: hijo schedulable, ejecucion paralela y duplicacion COW.
- Stress RR(q=1) con 10 procesos y 4 cores, sin leaks de Workers.

### Deploy

La app no requiere build; se sirve como archivos estaticos. Para
`ubiquitous.udem.edu`, el servidor debe entregar `.js` como JavaScript:

```apache
AddType application/javascript .js
AddType text/css .css
```

Tambien debe preservar rutas relativas para que el Worker cargue:

```text
engine/thread-worker.js
```

El deploy real no fue verificable desde este workspace porque no hay credenciales
ni navegador disponible. La guia de verificacion manual esta en:

```text
docs/defensa-threads.md
```
