# Demo de presentacion - CoreView

Duracion recomendada: 10 a 12 minutos.

Objetivo: demostrar que CoreView no es solo una interfaz grafica, sino un simulador educativo de sistemas operativos con engine testeable, scheduling, paginacion, threads reales con Web Workers, fork simulado con copy-on-write y comparacion multi-core/GIL.

## Preparacion

Desde la raiz del repo:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\demo-presentacion.ps1
```

Si solo quieres levantar la app sin correr pruebas:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\demo-presentacion.ps1 -SkipTests
```

Abrir:

```text
http://localhost:8000
```

Archivos que conviene tener a mano:

- `samples/sample-9col-multithread.txt`
- `samples/sample-5col-busy.txt`
- `samples/sample-malformado.txt`
- `docs/screenshots/`
- DevTools del navegador en `Sources > Threads` o `Application > Workers`

## Resumen del repo escaneado

CoreView esta organizado en tres capas:

- `data.js`: estado, parseo de archivos, validacion regex y generacion de referencias de memoria.
- `engine/`: algoritmos puros de scheduling, paginacion, Dispatcher, Web Worker, GIL y fork/COW.
- `screens/` y `render/`: pantallas, canvas, tablas, diagramas, Gantt, memoria, metricas y comparaciones.

Algoritmos incluidos:

- Scheduling: FCFS, SJF, SRTF, Priority preemptive, Round Robin, HRRN, MLQ y MLFQ.
- Paginacion: FIFO, LRU, Optimal, Second Chance y Clock.
- Threads/multi-core: Dispatcher con Web Workers reales, 1/2/4/8 cores.
- GIL: comparacion didactica entre JavaScript Workers y Python CPU-bound bajo GIL.

Estado verificado localmente:

```text
tests/test-data.js                         138 passed, 0 failed
tests/test-scheduling.js                   777 passed, 0 failed
tests/test-paging.js                        67 passed, 0 failed
tests/test-threads.js                      117 passed, 0 failed
tests/test-gil-scheduler.js                 69 passed, 0 failed
tests/integration/threads-execution.test.js 502 passed, 0 failed
Total                                     1670 passed, 0 failed
```

Nota para defensa: el README menciona 1601 tests porque no incluye la suite nueva de GIL; con GIL incluido son 1670.

## Demo minuto a minuto

### 0:00 - 1:00 Apertura

Accion:

1. Mostrar `http://localhost:8000`.
2. Senalar la barra lateral: Entrada, Scheduling, Memoria, Page Replacement, Threads, Multi-Core Threads, Metricas y Comparison.

Guion:

> CoreView es un simulador educativo de sistemas operativos hecho con HTML, CSS y JavaScript puro. La idea principal es separar la logica del sistema operativo de la visualizacion: los algoritmos producen trazas deterministicas y la interfaz solo las reproduce con canvas y DOM. Eso permite probar la parte importante sin navegador y despues mostrarla visualmente.

### 1:00 - 2:30 Entrada y validacion regex

Accion:

1. Ir a `1. Entrada`.
2. Cargar `samples/sample-malformado.txt`.
3. Mostrar errores por linea y campo.
4. Cargar despues `samples/sample-9col-multithread.txt`.

Guion:

> La entrada soporta dos formatos: 5 columnas para procesos simples y 9 columnas para procesos con varios threads. Antes de convertir a numeros, cada campo pasa por regex: PID positivo, tiempos no negativos, prioridad de 1 a 9 y conteos de paginas positivos. Si un archivo viene mal, la app no falla de forma generica; reporta linea, campo y tipo esperado. Despues cargo el ejemplo multi-thread para usarlo en scheduling y memoria.

### 2:30 - 4:00 Scheduling

Accion:

1. Ir a `2. Scheduling`.
2. Ejecutar `FCFS`.
3. Mostrar Gantt, Ready Queue, estados y tabla de metricas.
4. Cambiar a `Round Robin`, quantum `2`, ejecutar otra vez.

Guion:

> Aqui se ve el modelo trace-player. El algoritmo genera toda la linea de tiempo: que thread corre en cada tick, quien llega, quien termina, la cola de listos y las metricas. FCFS muestra el caso secuencial simple; Round Robin con quantum 2 introduce preemption y mas cambios de contexto. Las metricas clave son completion time, turnaround, waiting y response.

Punto tecnico:

> Los archivos de `engine/scheduling-*.js` son funciones puras. No tocan el DOM; por eso la suite de scheduling puede validar 777 casos directamente en Node.

### 4:00 - 5:30 Memoria, fork y copy-on-write

Accion:

1. Regresar a `Entrada`.
2. En un proceso, pulsar `Fork()`.
3. Ir a `3. Memoria`.
4. Mostrar paginas COW.
5. Pulsar `Escribir` sobre una pagina COW del hijo.

Guion:

> El navegador no permite invocar la syscall real `fork()`, asi que CoreView simula el comportamiento observable: crea un proceso hijo, hereda atributos y marca paginas compartidas como copy-on-write. Mientras nadie escribe, padre e hijo comparten paginas. Cuando escribo sobre una pagina COW, se materializa una copia privada y la pantalla muestra la duplicacion.

Defensa:

> Esto no pretende ser un kernel real. Es una simulacion visual documentada en `engine/process-model.js`. Lo importante para el curso es entender por que `fork()` moderno no copia toda la memoria inmediatamente.

### 5:30 - 6:45 Page Replacement

Accion:

1. Ir a `4. Page Replacement`.
2. Ejecutar `FIFO`.
3. Cambiar a `Clock`.
4. Mostrar tabla de pasos, frames, hit/fault y bits de referencia.

Guion:

> En paginacion, cada referencia produce un paso de la traza. Si la pagina ya esta cargada es hit; si no, hay page fault y el algoritmo decide a quien desalojar. FIFO es facil de seguir; Clock agrega el bit de referencia y un apuntador circular, que aproxima Second Chance sin mover toda la cola.

### 6:45 - 8:30 Threads reales con Web Workers

Accion:

1. Ir a `5. Threads`.
2. Seleccionar `FCFS`.
3. Seleccionar `4` cores.
4. Usar velocidad media/lenta.
5. Pulsar `Run`.
6. Mostrar `RUNNING`, `Workers activos`, Gantt por core y metricas observadas vs trace.
7. Abrir DevTools y mostrar `engine/thread-worker.js` activo.

Guion:

> Esta es la parte mas importante de ejecucion. El Dispatcher toma la traza deterministica y crea un Web Worker por thread schedulable. El navegador ejecuta esos Workers fuera del hilo principal y el Dispatcher asigna ticks a cores segun la politica elegida. La politica la decide CoreView; la ejecucion real ocurre en Workers del navegador.

Defensa:

> Si el profesor pregunta como se prueba, hay dos evidencias: visualmente aparecen Workers activos en DevTools, y automaticamente `tests/integration/threads-execution.test.js` valida que todos los threads terminan, que 2 y 4 cores reducen el tiempo simulado frente a 1 core y que no quedan Workers vivos al final.

### 8:30 - 9:45 Multi-Core Threads y GIL

Accion:

1. Ir a `6. Multi-Core Threads`.
2. Ejecutar modo JavaScript/Web Workers con 4 cores y 4 threads.
3. Cambiar a modo Python/GIL y ejecutar.
4. Comparar uso total de CPU.

Guion:

> Esta pantalla compara dos modelos. En JavaScript con Web Workers, varios threads CPU-bound pueden avanzar en paralelo y llenar varios cores. En el modo Python/GIL se simula CPython para bytecode CPU-bound: aunque haya 4 cores, solo un thread avanza por tick porque el token GIL serializa la ejecucion. Por eso el uso total queda cerca de 1 dividido entre el numero de cores.

Precision:

> CPython puede liberar el GIL en I/O y puede usar varios cores con multiprocessing o extensiones nativas. Esta pantalla modela especificamente threads CPU-bound bajo GIL.

### 9:45 - 10:45 Comparison, metricas y CSV

Accion:

1. Ir a `8. Comparison`.
2. Ejecutar comparacion.
3. Mostrar mejores algoritmos por metrica.
4. Mostrar boton de exportacion CSV en Scheduling, Threads o Comparison.

Guion:

> La comparacion ejecuta varios algoritmos sobre el mismo input y muestra promedios lado a lado. Esto evita comparar resultados de datasets distintos. Tambien se puede exportar CSV con filas por thread/proceso, metadatos del algoritmo, cores, promedios y timestamp, util para revisar en Excel o LibreOffice.

### 10:45 - 12:00 Cierre

Guion:

> La arquitectura esta pensada para que la demostracion sea defendible: el engine es puro y testeable, el render solo consume trazas, el Dispatcher conecta esas trazas con Workers reales, y fork/COW esta declarado como simulacion por las limitaciones del navegador. La suite completa local tiene 1670 tests pasando. Las limitaciones principales son claras: MLQ y MLFQ caen a single-core, COW es visual y el tiempo de pared depende de timers del navegador.

## Preguntas probables y respuestas cortas

**Es paralelismo real o solo animacion?**

Es paralelismo real en el runtime del navegador mediante Web Workers. La animacion sigue una traza deterministica, pero los workers existen y se pueden ver en DevTools mientras corre la demo.

**El navegador decide el scheduling?**

No. CoreView decide la politica de scheduling en el engine. El Dispatcher usa esa decision para mandar `run` o `preempt` a cada Worker.

**Por que fork es simulado?**

Porque JavaScript en navegador no tiene acceso a syscalls del kernel. Se simula el comportamiento observable: PID hijo, herencia de atributos, paginas COW y duplicacion al escribir.

**Por que MLQ/MLFQ no corren multi-core?**

Porque coordinar varias colas con promocion/degradacion entre cores cambia la semantica y queda fuera del alcance educativo. El Dispatcher cae intencionalmente a single-core y emite advertencia.

**Que significa que el engine sea puro?**

Que los algoritmos reciben procesos y devuelven trazas/metricas sin tocar DOM, canvas ni Workers. Eso los hace reproducibles y testeables en Node.

**Cual es la evidencia automatica mas fuerte?**

`node tests/integration/threads-execution.test.js`: valida Dispatcher, Workers mockeados, multi-core, mejora con 2/4 cores, fork/COW, limpieza de workers y fallback de MLQ/MLFQ.

## Checklist antes de presentar

- Servidor local levantado en `http://localhost:8000`.
- DevTools abierto y listo para mostrar Workers.
- `sample-9col-multithread.txt` cargado.
- `sample-malformado.txt` listo para validar regex.
- Saber decir que el total verificado es `1670 passed, 0 failed`.
- Tener claro que COW y GIL son simulaciones educativas declaradas.
