# CoreView
## Simulador de Planificación de CPU y Paginación de Memoria con Threads, Fork y Multi-Core

**Reporte Técnico — Proyecto Final**
**Materia:** Sistemas Operativos
**Universidad de Monterrey (UDEM)**

**Autor:** Marcelo Villanueva Morcos
**Matrícula:** 666660
**Email:** marcelo.villanuevam@udem.edu

**Repositorio:** github.com/marcelovillanuevam-code/Sistemas-Operativos---CoreView
**Despliegue:** ubiquitous.udem.edu

**Fecha:** mayo 2026

---

## 1. Resumen ejecutivo

CoreView es una aplicación web educativa que permite visualizar y comparar de forma interactiva los algoritmos de planificación de CPU y de reemplazo de páginas de memoria estudiados en el curso de Sistemas Operativos. El simulador implementa **8 algoritmos de scheduling** (FCFS, SJF, SRTF, Priority preemptivo y no preemptivo, Round Robin, HRRN, MLQ y MLFQ) y **5 algoritmos de paginación** (FIFO, LRU, Optimal, Second Chance y Clock).

Adicionalmente, CoreView extiende el modelo básico de procesos con:

- **Threads reales** mediante Web Workers del navegador, con un Worker dedicado por thread schedulable.
- **Fork simulado** con semántica copy-on-write (COW) observable en la pantalla de memoria.
- **Multi-core configurable** (1, 2, 4 u 8 núcleos) que ejecuta threads en paralelo real bajo la política de scheduling seleccionada.
- **Modo GIL** que simula el Global Interpreter Lock de CPython para comparar el comportamiento de threads CPU-bound en JavaScript versus Python.

El stack tecnológico es HTML, CSS y JavaScript ES2020 puro con ES Modules, sin ningún framework ni dependencia de runtime. La aplicación se despliega como archivos estáticos sin paso de compilación. La suite de pruebas unitarias e integración suma **1 601 tests pasando**, ejecutados con Node.js.

---

## 2. Marco teórico

### 2.1 Planificación de procesos

Un **proceso** es la abstracción fundamental del sistema operativo para la ejecución de un programa: combina el código, el contexto de ejecución (registros, puntero de instrucción, pila) y los recursos asignados (memoria, archivos abiertos). Su ciclo de vida atraviesa los estados **NEW → READY → RUNNING → WAITING → TERMINATED**. En cualquier instante, el procesador puede estar ejecutando a lo sumo un proceso por núcleo físico; el planificador (scheduler) decide cuál proceso ocupa la CPU en cada momento.

Los algoritmos de scheduling se clasifican en **no preemptivos**, donde el proceso que toma la CPU la retiene hasta bloquearse o terminar, y **preemptivos**, donde el sistema operativo puede desalojar al proceso en ejecución antes de que termine. Las métricas estándar para evaluar un algoritmo son:

| Métrica | Definición |
|---|---|
| Completion time | Instante en que el proceso termina |
| Turnaround time | Completion time − Arrival time |
| Waiting time | Turnaround time − Burst time |
| Response time | Primer instante de CPU − Arrival time |

CoreView implementa los siguientes algoritmos:

- **FCFS** (First Come First Served): no preemptivo, orden de llegada; simple pero puede producir efecto convoy.
- **SJF** (Shortest Job First): no preemptivo, elige el trabajo más corto disponible; minimiza el turnaround promedio.
- **SRTF** (Shortest Remaining Time First): versión preemptiva de SJF; expulsa al proceso en ejecución si llega uno con menor tiempo restante.
- **Priority Non-Preemptive**: asigna la CPU al proceso de mayor prioridad disponible; no expulsa al proceso en curso.
- **Priority Preemptive**: versión preemptiva; puede desalojar al proceso en ejecución si llega uno de mayor prioridad.
- **Round Robin (RR)**: preemptivo con quantum fijo; garantiza tiempo de respuesta acotado para todos los procesos.
- **HRRN** (Highest Response Ratio Next): no preemptivo; combina tiempo de espera y burst para evitar inanición.
- **MLQ** (Multilevel Queue): múltiples colas con prioridades fijas; cada cola puede usar un algoritmo diferente.
- **MLFQ** (Multilevel Feedback Queue): variante dinámica de MLQ; los procesos se promueven o degradan entre niveles según su comportamiento.

> Tanenbaum, A. S. (2014). *Modern Operating Systems* (4th ed.). Pearson. Capítulo 2 (Processes and Threads), sección 2.4 (Scheduling).

### 2.2 Memoria virtual y paginación

La **memoria virtual** separa el espacio de direcciones lógico del proceso del espacio físico de la RAM. La unidad de transferencia es la **página** (bloque de tamaño fijo del espacio lógico) que se mapea a un **marco** (bloque equivalente en memoria física). Cuando un proceso accede a una página que no está en RAM se produce un **page fault**, y el sistema operativo debe cargarla desde disco, posiblemente desalojando otra página.

Los **algoritmos de reemplazo de páginas** determinan qué página se desaloja cuando no hay marcos libres:

- **FIFO**: desaloja la página más antigua en memoria; sencillo pero puede producir anomalía de Bélády.
- **LRU** (Least Recently Used): desaloja la página menos recientemente accedida; aproxima al óptimo, costoso de implementar exactamente.
- **Optimal**: desaloja la página que no se usará por más tiempo; irrealizable en la práctica, sirve como cota de comparación.
- **Second Chance (SC)**: variante de FIFO con bit de referencia; una página con bit=1 recibe una segunda oportunidad antes de ser desalojada.
- **Clock**: implementación circular de Second Chance; evita el desplazamiento explícito de la cola FIFO.

> Tanenbaum, A. S. (2014). *Modern Operating Systems* (4th ed.). Pearson. Capítulo 3 (Memory Management), secciones 3.3 y 3.4.

### 2.3 Concurrencia, paralelismo y multi-core

**Concurrencia** es la capacidad de gestionar múltiples actividades en progreso al mismo tiempo mediante intercalado de ejecución, incluso en un solo núcleo. **Paralelismo** es la ejecución simultánea de múltiples actividades en distintos núcleos físicos al mismo tiempo.

Un **thread** (hilo) es la unidad de ejecución dentro de un proceso. A diferencia de dos procesos independientes, los threads de un mismo proceso comparten el espacio de direcciones, los archivos abiertos y las variables globales; cada thread tiene su propio registro de pila e instrucción. Esta compartición facilita la comunicación pero exige sincronización para evitar condiciones de carrera.

En sistemas **multi-core**, el sistema operativo puede asignar threads a distintos núcleos físicos simultáneamente. Las políticas de scheduling multi-core deben considerar **afinidad de caché** (preferir ejecutar un thread en el mismo núcleo que lo ejecutó antes para aprovechar datos en caché) y **load balancing** (distribuir la carga de manera equitativa entre todos los núcleos disponibles).

> Tanenbaum, A. S. (2014). *Modern Operating Systems* (4th ed.). Pearson. Capítulo 8 (Multiple Processor Systems), secciones 8.1 y 8.2.

### 2.4 Fork y copy-on-write

La llamada al sistema **`fork()`** de POSIX crea un proceso hijo que es una copia casi exacta del proceso padre. En las implementaciones modernas (Linux, BSD) se usa **copy-on-write (COW)**: en lugar de copiar físicamente todas las páginas del padre en el momento del fork, ambos procesos comparten los mismos marcos físicos marcados como de sólo lectura. La copia física de una página ocurre únicamente cuando uno de los dos procesos intenta **escribir** sobre ella, momento en que el kernel intercepta el page fault, duplica la página y actualiza la tabla de páginas del escritor para apuntar al nuevo marco privado.

Esta optimización hace que `fork()` sea extremadamente eficiente para patrones del tipo fork-exec (crear un proceso hijo que inmediatamente llama a `execve()`), ya que la mayoría de páginas nunca se copian.

> Tanenbaum, A. S. (2014). *Modern Operating Systems* (4th ed.). Pearson. Capítulo 10 (Case Study 2: Linux), sección sobre gestión de procesos y COW.

---

## 3. Diseño del sistema

### 3.1 Arquitectura en tres capas

CoreView sigue una separación estricta en tres capas que permite probar la lógica de los algoritmos sin navegador:

**Capa de datos** (`data.js`, `types.js`)
: Mantiene el estado global de la aplicación, realiza el parsing de archivos de entrada, valida campos con expresiones regulares y define los tipos de datos mediante JSDoc (`Process`, `Thread`, `Trace`, `TimelineEntry`, etc.).

**Capa de motor** (`engine/`)
: Contiene funciones puras que implementan los algoritmos de scheduling y paginación. Estas funciones no tocan el DOM, no importan módulos del navegador y se pueden ejecutar directamente en Node.js. Producen un objeto **Trace** que es una traza determinística de la ejecución: una lista de `TimelineEntry` que describe qué thread corría en cada tick, junto con métricas por thread y métricas agregadas.

**Capa de renderizado** (`render/`, `screens/`)
: Consume el `Trace` producido por el motor y lo dibuja en pantalla mediante Canvas 2D y manipulación del DOM. Las pantallas de Scheduling, Threads, Memory, Paging, Comparison y Multi-Core son consumidoras pasivas de los trazos; no generan lógica de scheduling propia.

La decisión arquitectónica central es el **modelo trace-player**: el algoritmo genera la traza completa de forma determinística antes de que comience la animación o la ejecución con Workers. Esto implica que:

1. Las pruebas unitarias del engine validan el trazo directamente, sin necesidad de simular tiempo ni navegador.
2. El renderizado puede avanzar, pausar o retroceder el trazo independientemente del reloj real.
3. El Dispatcher de Workers usa el trazo como **fuente de verdad** de scheduling: no toma decisiones propias, solo ejecuta las decisiones que ya están en el trazo.

### 3.2 Extensión a ejecución paralela

La pantalla Threads agrega una capa de ejecución real sobre el trace-player. La separación de responsabilidades es:

- El **algoritmo de scheduling** (función pura del engine) decide QUÉ thread debe correr en QUÉ tick.
- El **Dispatcher** (`engine/dispatcher.js`) recibe esa decisión, materializa la ejecución instanciando Workers reales y los asigna a cores disponibles tick a tick.
- Los **Workers** (`engine/thread-worker.js`) ejecutan fuera del hilo principal, en paralelo real cuando hay núcleos físicos disponibles en el equipo del usuario.

Esta separación es deliberada: si el navegador tomara las decisiones de scheduling, no habría diferencia visual observable entre FCFS y Round Robin. El propósito educativo del simulador exige que la **política de scheduling dirija** mientras la **ejecución ocurre en paralelo real**.

### 3.3 Modelo de procesos y threads

Cada `Process` contiene:
- `pid`: identificador único de proceso.
- `arrivalTime`, `burstTime`, `priority`, `sharedPages`, `numPages`.
- `threads[]`: arreglo de uno o más objetos `Thread`.

Cada `Thread` contiene:
- `tid`: identificador único global de thread.
- `pid`: PID del proceso al que pertenece.
- `arrivalTime`, `burstTime`, `priority` (heredada del proceso).
- `stackPages`: páginas privadas del stack del thread.

La memoria total de un proceso se computa como `sharedPages + Σ(stackPages de cada thread)`. Los TIDs son únicos globalmente a través de todos los procesos.

### 3.4 Formato de input y validación

CoreView acepta dos formatos de archivo de texto plano:

**Formato 5 columnas** (proceso de un solo thread):
```
pid,arrival,burst,priority,sharedPages
```

**Formato 9 columnas** (proceso multi-thread, una línea por thread):
```
pid,arrival,procBurst,priority,sharedPages,numThreads,threadArrival,threadBurst,stackPages
```

La validación se realiza campo a campo con expresiones regulares antes del parseo numérico. Si el archivo contiene errores, el simulador reporta exactamente qué línea, qué campo y qué tipo se esperaba.

### 3.5 Modelo de memoria

La pantalla Memory modela la memoria física como un arreglo de marcos enumerados (`totalMemory / pageSize`). La cadena de referencias (reference string) se genera por interleaving de las páginas de cada proceso, simulando accesos secuenciales. Las páginas marcadas como COW (`cowPages[]`) incluyen metadatos: `pageNumber`, `groupId`, `originalOwnerPid` y `sharedWithPids`.

---

## 4. Implementación

### 4.1 Stack tecnológico

| Componente | Tecnología |
|---|---|
| Lenguaje | JavaScript ES2020 |
| Módulos | ES Modules (`type="module"`) |
| Renderizado 2D | Canvas API |
| Threads reales | Web Workers API |
| Servidor | Archivos estáticos (ningún build) |
| Pruebas | Node.js (sin framework de testing) |

No se usa ningún framework (React, Vue, Angular) ni bundler (Webpack, Vite). Esta decisión permite que el despliegue en `ubiquitous.udem.edu` sea simplemente copiar los archivos estáticos. El único requisito del servidor es que los archivos `.js` se sirvan con MIME `application/javascript` para que los Workers carguen correctamente.

### 4.2 Engine de scheduling

Cada algoritmo es una **función pura** que recibe un arreglo de procesos y devuelve un objeto `Trace`:

```javascript
// Firma representativa de cada algoritmo
export function runFCFS(processes)       { /* ... */ }
export function runSJF(processes)        { /* ... */ }
export function runRoundRobin(processes, quantum) { /* ... */ }
export function runSRTF(processes)       { /* ... */ }
export function runHRRN(processes)       { /* ... */ }
export function runPriorityPreemptive(processes)  { /* ... */ }
export function runMLQ(processes, config)         { /* ... */ }
export function runMLFQ(processes, config)        { /* ... */ }
```

El objeto `Trace` contiene:

- `timeline`: arreglo de `TimelineEntry` (tick, thread corriendo, cola de listos, estados de proceso).
- `threadMetrics`: métricas por thread (arrival, burst, completion, turnaround, waiting, response).
- `processMetrics`: métricas agregadas por proceso.
- `aggregateMetrics`: promedios globales, CPU utilization, throughput, context switches.

Al ser funciones puras sin efectos secundarios, se pueden importar directamente en Node.js y probar sin navegador. Los 777 tests de scheduling operan sobre estas funciones.

### 4.3 Dispatcher y Web Workers

La clase `Dispatcher` (`engine/dispatcher.js`) es el componente central del modo Threads:

```javascript
export class Dispatcher {
  constructor({ processes, numCores, algorithm, quantum, simSpeedMs }) { /* ... */ }

  async start()  { /* Crea Workers, inicia tick timer */ }
  pause()        { /* Preempta Workers activos, detiene timer */ }
  resume()       { /* Reactiva Workers, reinicia timer */ }
  stop()         { /* Termina todos los Workers, emite métricas finales */ }

  onCoreUpdate(cb)   { /* Callback: estado de cores en cada tick */ }
  onThreadDone(cb)   { /* Callback: métricas de thread al terminar */ }
  onComplete(cb)     { /* Callback: métricas finales cuando todos terminan */ }
  onError(cb)        { /* Callback: error en Worker o lógica */ }
}
```

**Flujo de ejecución:**

1. El constructor calcula el trazo determinístico llamando a la función pura correspondiente.
2. `start()` crea un `Worker` por thread (usando `new Worker('./engine/thread-worker.js')`), inicializa cada Worker con `postMessage({ type: 'init', tid, pid, totalBurst, simSpeedMs })` y espera confirmación `ready`.
3. Un `setInterval` avanza `simTime` cada `simSpeedMs` milisegundos.
4. En cada tick, el Dispatcher consulta el trazo para saber qué threads deben correr en cada core y envía `{ type: 'run' }` o `{ type: 'preempt' }` según corresponda.
5. Cada Worker responde con `tick` (progreso), `done` (terminado) o `preempted` (pausado).
6. Al terminar todos los threads, el Dispatcher llama a `terminate()` en cada Worker y emite las métricas finales.

Multi-core es soportado para FCFS, SJF, HRRN, RR, SRTF y Priority Preemptive. MLQ y MLFQ se ejecutan en single-core (ver §6.3).

### 4.4 Fork simulado y COW

`engine/process-model.js` implementa `simulatedFork(parentPid)`. El JSDoc de la función documenta explícitamente qué se simula y qué no:

```javascript
/**
 * Simulación de la syscall fork() de POSIX.
 *
 * En un sistema operativo real, fork() invoca sys_fork (Linux) que duplica el
 * proceso llamante creando un hijo con PID nuevo, espacio de direcciones idéntico
 * compartido vía copy-on-write, y atributos heredados (prioridad, file descriptors,
 * signal handlers, working directory, etc.).
 *
 * Como CoreView corre en un navegador, no podemos invocar la syscall real
 * (no hay acceso a primitivas del kernel desde JavaScript en browser).
 * Esta función replica el comportamiento OBSERVABLE para fines educativos:
 *   - Asigna PID nuevo (siguiente disponible en la tabla de procesos)
 *   - Marca todas las páginas del padre como COW (compartidas)
 *   - Cuando ocurre escritura en página COW, dispara duplicación visible
 *   - Hereda atributos del padre (burst, prioridad)
 *
 * Comportamiento NO simulado (fuera del alcance educativo):
 *   - File descriptors
 *   - Signal handlers
 *   - Variables de entorno
 *   - Namespaces (mount, network, PID, etc.)
 *
 * @param {number} parentPid - PID del proceso padre
 * @returns {Process} - Nuevo proceso hijo con páginas COW
 */
export function simulatedFork(parentPid) { /* ... */ }
```

La función `writeProcessPage(processes, writerPid, pageNumber)` simula la escritura: si la página es COW, elimina el grupo COW compartido, agrega la página a `materializedCowPages` del escritor y devuelve `{ duplicated: true, sharedWithPids }`.

### 4.5 Validación regex

`data.js` define cuatro expresiones regulares documentadas para validación de campos:

```javascript
// Identificador de proceso o thread: entero positivo
const RE_PID = /^[1-9]\d*$/;

// Tiempo en ticks: entero no negativo (incluye 0 para arrival en t=0)
const RE_TIME = /^\d+$/;

// Prioridad: entero entre 1 y 9
const RE_PRIORITY = /^[1-9]$/;

// Conteo de páginas: entero positivo
const RE_PAGE_COUNT = /^[1-9]\d*$/;
```

La función `validateProcessFileFormat(content)` aplica estas regex línea por línea. Si un campo falla, reporta `{ line, field, value, expectedType }` para que la interfaz pueda mostrar un panel de errores específicos con número de línea y descripción del problema. El archivo `samples/sample-malformado.txt` está incluido en el repositorio para demostrar este comportamiento.

### 4.6 Exportación CSV

`engine/csv-export.js` genera archivos CSV con:

```
PID,TID,Arrival,Burst,Completion,Turnaround,Waiting,Response
1,1,0,5,5,5,0,0
2,2,1,3,8,7,4,4
...
Algorithm,FCFS
Cores,2
Avg Turnaround,4.50
Avg Waiting,2.25
Generated,2026-05-09T17:30:00Z
```

La pantalla Comparison exporta un CSV con métricas de varios algoritmos en columnas paralelas, útil para análisis comparativo en hojas de cálculo.

---

## 5. Evidencias y resultados

### 5.1 Suite de pruebas

| Suite | Archivo | Tests | Cobertura |
|---|---|---|---|
| Datos e input | `tests/test-data.js` | 138 | Parsing, validación regex, detección de errores por línea |
| Scheduling | `tests/test-scheduling.js` | 777 | 8 algoritmos, métricas, casos borde |
| Paginación | `tests/test-paging.js` | 67 | 5 algoritmos, page faults, hit ratio |
| Threads | `tests/test-threads.js` | 117 | Expansión a threads, estados, TIDs únicos |
| Integración Dispatcher | `tests/integration/threads-execution.test.js` | 502 | Dispatcher con Workers mockeados, multi-core |
| **Total** | | **1 601** | |

Comando para ejecutar la suite completa:

```
node tests/test-data.js
node tests/test-scheduling.js
node tests/test-paging.js
node tests/test-threads.js
node tests/integration/threads-execution.test.js
```

Resultado esperado: `0 failed` en cada suite.

### 5.2 Verificación de algoritmos

Los algoritmos fueron verificados manualmente contra casos de referencia del Apéndice C de la guía de arquitectura del proyecto (3 procesos, 6 threads). Las métricas calculadas a mano coinciden 100% con las métricas producidas por el engine para FCFS (Apéndice C.2), RR con quantum=2 (Apéndice C.3) y Priority Preemptive con 3 colas (Apéndice C.4).

**[INSERTAR SCREENSHOT 1: pantalla de scheduling FCFS con tabla de métricas por proceso]**

`docs/screenshots/01-fcfs-metrics.png`

**[INSERTAR SCREENSHOT 2: pantalla de scheduling Round Robin con control de quantum y Gantt]**

`docs/screenshots/02-rr-quantum.png`

### 5.3 Demostración de paralelismo

Caso de prueba: archivo `samples/sample-5col-busy.txt` con 8 procesos, ejecutado con FCFS bajo distintas configuraciones de cores. La mejora observada depende de la carga del equipo y de la distribución de burst times.

| numCores | Comportamiento observado |
|---|---|
| 1 | Ejecución secuencial; un solo thread activo por tick |
| 2 | Dos threads ejecutan simultáneamente; el Gantt muestra dos filas activas en paralelo |
| 4 | Hasta cuatro threads en paralelo; latencia total visible reducida |
| 8 | Ocho threads en paralelo; en cargas pequeñas el límite es la cantidad de threads, no los cores |

> Nota: los valores exactos de tiempo wall-clock dependen del hardware del equipo donde se ejecuta, de la carga del sistema y del throttling de pestañas del navegador. Las métricas defensibles ante evaluación son las de tiempo simulado (ticks), que son determinísticas. Los tiempos wall-clock son ilustrativos.

**[INSERTAR SCREENSHOT 3: pantalla Threads con 4 cores ejecutando, Gantt multi-fila visible]**

`docs/screenshots/03-threads-4cores.png`

**[INSERTAR SCREENSHOT 4: DevTools → Sources → panel Threads mostrando Workers activos coreview-thread-T1, T2, T3...]**

`docs/screenshots/04-devtools-workers.png`

### 5.4 Validación regex en acción

Al cargar `samples/sample-malformado.txt`, el simulador muestra un panel de errores con detalle por línea:

**[INSERTAR SCREENSHOT 5: carga de sample-malformado.txt con panel de errores específicos (número de línea, campo, valor recibido, tipo esperado)]**

`docs/screenshots/05-regex-errors.png`

### 5.5 Exportación CSV

**[INSERTAR SCREENSHOT 6: archivo CSV exportado abierto en LibreOffice Calc / Excel, mostrando headers, filas de datos y sección de metadata al final]**

`docs/screenshots/06-csv-libreoffice.png`

### 5.6 Fork y COW en la pantalla Memory

**[INSERTAR SCREENSHOT 7: pantalla Memory con páginas COW marcadas con borde doble y candado; botón "Write to page X" y resultado de duplicación]**

`docs/screenshots/07-fork-cow.png`

---

## 6. Limitaciones declaradas

### 6.1 Arquitectura

CoreView no implementa un modelo servidor-cliente con eventos pub/sub ni un bus de mensajes distribuido. El alcance del proyecto se acotó deliberadamente a la visualización educativa de algoritmos de scheduling y memoria, y a la demostración de paralelismo mediante Web Workers en el entorno del navegador.

### 6.2 Fork

`simulatedFork()` es una simulación documentada. El entorno browser no permite invocar la syscall `fork()` del sistema operativo; JavaScript en el navegador no tiene acceso a `sys_fork`, tablas reales de páginas, file descriptors ni signal handlers del kernel. La función replica el **comportamiento observable** (PID nuevo, COW, herencia de atributos de proceso) para propósitos educativos. Lo que no se simula: file descriptors, signal handlers, variables de entorno, namespaces de Linux (mount, network, PID).

### 6.3 Multi-core en algoritmos por niveles

MLQ y MLFQ se ejecutan en single-core aunque el usuario solicite más cores. La razón está documentada en el código del Dispatcher:

> "MLFQ y MLQ requieren coordinación de queues entre cores que está fuera del alcance educativo de esta entrega. Estos algoritmos se ejecutan en single-core para preservar la corrección de su lógica de promoción/degradación entre niveles."

El Dispatcher emite una advertencia en consola cuando se detecta esta situación: `console.warn(SINGLE_CORE_ONLY_REASON)`.

### 6.4 Copy-on-write

COW es una simulación visual. La duplicación de páginas es disparada manualmente por el usuario (botón "Write to page X") para fines de demostración. No afecta las métricas de scheduling ni el trazo de CPU. En un sistema operativo real, la duplicación la dispara el page fault handler del kernel de forma automática y transparente al proceso.

### 6.5 Tiempo wall-clock

Los timers del navegador (`setInterval`) no son de tiempo real estricto. La velocidad de simulación depende de la carga del equipo, el throttling de pestañas inactivas y la resolución del timer del sistema operativo subyacente. Los Workers no pueden manipular el DOM directamente; toda actualización visual viaja de vuelta al hilo principal mediante `postMessage`.

---

## 7. Conclusiones

CoreView es un simulador educativo completo que cubre los temas centrales del curso de Sistemas Operativos: **8 algoritmos de scheduling de CPU**, **5 algoritmos de reemplazo de páginas**, **threads reales** mediante Web Workers, **fork simulado** con copy-on-write y **multi-core configurable** con hasta 8 cores. La suite de pruebas de **1 601 tests** verifica la corrección de los algoritmos de forma reproducible.

La decisión arquitectónica más importante fue el modelo **trace-player**: separar la generación determinística del trazo de su ejecución o animación. Esta separación hace que los algoritmos sean testeable en Node.js sin navegador, que el renderizado sea un consumidor pasivo del trazo, y que el Dispatcher use el trazo como fuente de verdad en lugar de tomar decisiones de scheduling propias.

El principal aprendizaje de diseño fue entender las **limitaciones del entorno browser** como plataforma para simular primitivas del sistema operativo: no hay acceso a `fork()`, no hay tablas de páginas reales, los timers no son de tiempo real estricto y los Workers no pueden compartir memoria directamente sin `SharedArrayBuffer`. Estas limitaciones son en sí mismas una demostración de los conceptos del curso: la separación entre espacio de usuario y espacio de kernel.

**Trabajo futuro:**
- Migración a arquitectura cliente-servidor (Node.js backend) para habilitar `fork()` real mediante `child_process` y `SharedArrayBuffer` para condiciones de carrera reales con `Atomics`.
- Sincronización entre threads con primitivas reales (mutex simulado, semáforos) para extender la cobertura de los temas de concurrencia.
- Coordinación de colas MLQ/MLFQ entre múltiples cores para completar el soporte multi-core de todos los algoritmos.

---

## Anexo A: Comandos de ejecución

### Levantar servidor local

```bash
# Con Python 3
python -m http.server 8000

# Con Node (npx)
npx serve

# Con VS Code: clic derecho sobre index.html → "Open with Live Server"
```

Abrir en el navegador: `http://localhost:8000`

> IMPORTANTE: este proyecto usa ES Modules (`type="module"`). No funciona abriendo `index.html` directamente con doble clic en el navegador; el navegador bloquea la carga de módulos por las reglas de CORS.

### Ejecutar pruebas

```bash
node tests/test-data.js
node tests/test-scheduling.js
node tests/test-paging.js
node tests/test-threads.js
node tests/integration/threads-execution.test.js
```

---

## Anexo B: Formato de archivos de entrada

### Formato 5 columnas (procesos de un solo thread)

```
pid,arrival,burst,priority,sharedPages
1,0,5,2,1
2,1,3,1,1
3,2,7,3,2
```

### Formato 9 columnas (procesos multi-thread)

```
pid,arrival,procBurst,priority,sharedPages,numThreads,threadArrival,threadBurst,stackPages
1,0,8,2,1,2,0,5,1
1,0,8,2,1,2,0,3,1
```

Cuando un proceso tiene N threads, aparecen N líneas con el mismo PID y distintos valores de `threadArrival`/`threadBurst`.

### Validación de campos

| Campo | Regex | Rango aceptado |
|---|---|---|
| PID, TID | `/^[1-9]\d*$/` | Enteros positivos (≥ 1) |
| Arrival, burst | `/^\d+$/` | Enteros no negativos (≥ 0) |
| Priority | `/^[1-9]$/` | Enteros del 1 al 9 |
| sharedPages, stackPages | `/^[1-9]\d*$/` | Enteros positivos (≥ 1) |

### Archivos de muestra incluidos

| Archivo | Descripción |
|---|---|
| `samples/sample-5col-basic.txt` | 3 procesos simples de un thread |
| `samples/sample-5col-busy.txt` | 8 procesos para probar scheduling con carga |
| `samples/sample-9col-multithread.txt` | Procesos con varios threads |
| `samples/sample-malformado.txt` | Mezcla de válido e inválido para probar regex |
| `samples/sample-grande.txt` | 30 procesos para stress test |

---

## Anexo C: Estructura completa del proyecto

```
CoreView/
  index.html              Página principal
  app.js                  Punto de entrada de la aplicación
  data.js                 Estado, parseo y validación regex
  types.js                Definiciones de tipos (JSDoc)
  style.css               Estilos
  engine/
    dispatcher.js         Orquestador de Workers multi-core
    thread-worker.js      Código ejecutado dentro de cada Worker
    csv-export.js         Generación de CSV de resultados
    process-model.js      Modelo de procesos con fork simulado
    gil-scheduler.js      Simulación del GIL de CPython
    scheduling-fcfs.js    Algoritmo FCFS
    scheduling-sjf.js     Algoritmo SJF
    scheduling-srtf.js    Algoritmo SRTF
    scheduling-rr.js      Algoritmo Round Robin
    scheduling-hrrn.js    Algoritmo HRRN
    scheduling-priority.js Algoritmos Priority (preemptivo y no preemptivo)
    scheduling-mlq.js     Algoritmo MLQ
    scheduling-mlfq.js    Algoritmo MLFQ
    paging-*.js           Algoritmos de paginación (5 archivos)
    engine-utils.js       Cálculo de métricas compartido
    thread-utils.js       Expansión de procesos a threads
  render/
    gantt.js              Gráfica de Gantt en Canvas
    memory-grid.js        Cuadrícula de memoria
    ready-queue.js        Visualización de cola de listos
    cpu-cores.js          Visualización de cores activos
    thread-timeline.js    Timeline de threads multi-core
  screens/
    screen-input.js       Pantalla de carga de procesos
    screen-scheduling.js  Pantalla de scheduling
    screen-memory.js      Pantalla de memoria y COW
    screen-paging.js      Pantalla de paginación
    threads-multicore.js  Pantalla de threads y multi-core
  samples/                Archivos de muestra para carga
  tests/
    test-data.js          138 tests de parsing y validación
    test-scheduling.js    777 tests de scheduling
    test-paging.js        67 tests de paginación
    test-threads.js       117 tests de threads
    integration/
      threads-execution.test.js  502 tests del Dispatcher
  docs/
    reporte-tecnico.md    Este documento
    defensa-threads.md    Guía de defensa oral
    screenshots/          Capturas de pantalla para el reporte
```

---

## Anexo D: Referencias

- Tanenbaum, A. S. (2014). *Modern Operating Systems* (4th ed.). Pearson. Capítulos 2 (Processes and Threads), 3 (Memory Management) y 8 (Multiple Processor Systems).
- Mozilla Developer Network. *Web Workers API*. https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API
- Mozilla Developer Network. *Worker (interface)*. https://developer.mozilla.org/en-US/docs/Web/API/Worker
- Mozilla Developer Network. *Canvas API*. https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API
- POSIX.1-2017. *The Open Group Base Specifications Issue 7*. Sección `fork()`.
