# Defensa: Threads reales, Dispatcher multi-core y fork/COW

Este documento es la guia operativa para demostrar en defensa que la pantalla
Threads usa Web Workers reales, que el Dispatcher orquesta ejecucion multi-core
y que fork()/COW se visualiza en Process Input y Memory.

## Evidencia automatizada

Comando:

```powershell
node tests/integration/threads-execution.test.js
```

Resultado local del 2026-05-09:

```text
Result: 502 passed, 0 failed
```

Verificacion HTTP local del Worker:

```text
GET http://127.0.0.1:8765/engine/thread-worker.js
Status: 200
Content-Type: text/javascript
```

Cobertura incluida:

- Appendix C.2 FCFS y Appendix C.3 RR(q=2) con `numCores=1`.
- Comparacion de metricas observadas contra trace deterministico con tolerancia
  maxima de 10%.
- Appendix C.4 para P3 bajo FCFS.
- Appendix C con `numCores=2` y `numCores=4`, verificando que todos los
  procesos terminan y que el tiempo total baja contra single-core.
- Multi-core para FCFS, SJF, HRRN, RR, SRTF y Priority preemptive.
- MLQ y MLFQ caen a single-core con warning.
- Caso fork: P1(burst=5), fork a P1.1, ambos se ejecutan en paralelo con
  `numCores=2` y las paginas COW se duplican al escribir.
- Stress test: 10 procesos, RR(q=1), 4 cores, sin leaks de Workers.

## Preparacion de demo

1. Levantar servidor local desde la raiz del proyecto:

   ```powershell
   python -m http.server 8000
   ```

2. Abrir:

   ```text
   http://localhost:8000
   ```

3. En Process Input, cargar el caso multi-threaded del Appendix C:

   ```text
   P1: arrival=0, priority=2, sharedPages=3
       T1 arrival=0 burst=5 stackPages=1
       T2 arrival=0 burst=3 stackPages=1
   P2: arrival=1, priority=1, sharedPages=3
       T1 arrival=1 burst=4 stackPages=1
   P3: arrival=3, priority=3, sharedPages=4
       T1 arrival=3 burst=2 stackPages=1
       T2 arrival=4 burst=3 stackPages=2
       T3 arrival=5 burst=2 stackPages=1
   ```

4. Ir a Threads, seleccionar `FCFS`, `Cores=4`, velocidad lenta/media y pulsar
   `Run`.

## Chrome: Application / Workers

Ruta principal:

1. Abrir DevTools con `F12`.
2. Ir a `Application`.
3. Buscar la seccion de Workers. Segun la version de Chrome, los dedicated
   workers tambien pueden verse en `Sources > Threads` o en
   `chrome://inspect/#workers`.
4. Durante `Run`, verificar que aparecen instancias de:

   ```text
   engine/thread-worker.js
   ```

5. Al terminar la corrida, verificar que desaparecen.

Evidencia esperada para defensa:

```text
docs/evidence/workers-active.png
```

Captura requerida: DevTools abierto durante una corrida activa, mostrando varios
workers `engine/thread-worker.js`. En este workspace no hay Chrome/Firefox/Safari
instalados, por lo que la captura debe tomarse en la maquina de defensa o en una
maquina con navegador disponible.

## Chrome: Performance

1. Abrir DevTools.
2. Ir a `Performance`.
3. Pulsar `Record`.
4. En CoreView, ir a Threads y pulsar `Run` con `Cores=4`.
5. Detener la grabacion cuando haya actividad visible en Gantt.
6. Verificar:
   - Main thread sigue respondiendo mientras los Workers ejecutan ticks.
   - Hay actividad paralela asociada a worker threads.
   - No aparecen long tasks sostenidas causadas por redibujado del Gantt.

Evidencia esperada:

```text
docs/evidence/performance-workers.png
```

## Firefox

1. Abrir DevTools.
2. Usar `about:debugging#/runtime/this-firefox` para inspeccionar workers si la
   vista principal no los muestra.
3. Repetir Appendix C con `FCFS`, `Cores=4`.
4. Confirmar que los workers aparecen durante `Run` y desaparecen al completar.

## Safari

Safari soporta Web Workers, pero la visibilidad en herramientas de desarrollo y
los tiempos de timers pueden variar. Si esta disponible:

1. Activar Develop menu.
2. Abrir Web Inspector.
3. Repetir Appendix C con `FCFS`, `Cores=4`.
4. Confirmar que la ejecucion termina y que las metricas se mantienen dentro del
   margen esperado.

## Verificacion en servidor UDEM

URL esperada:

```text
https://ubiquitous.udem.edu/<ruta-coreview>/
```

Checklist:

1. Abrir la app por HTTPS, no desde `file://`.
2. En Network, confirmar que estos archivos cargan con estado 200:

   ```text
   index.html
   app.js
   engine/dispatcher.js
   engine/thread-worker.js
   render/gantt-realtime.js
   ```

3. Confirmar que `engine/thread-worker.js` se sirve con MIME JavaScript:

   ```text
   application/javascript
   ```

   `text/javascript` tambien es aceptable en navegadores modernos.

4. Si el Worker falla con error de MIME, proponer este fix en Apache:

   ```apache
   AddType application/javascript .js
   AddType text/css .css
   ```

5. Repetir Appendix C.2 en Threads:
   - Algorithm: FCFS
   - Cores: 1
   - Verificar metricas dentro de 10% contra trace.

6. Repetir multi-core:
   - Algorithm: FCFS
   - Cores: 4
   - Verificar varios cores ocupados simultaneamente.

## Guion breve de defensa

1. Mostrar Process Input y el boton `Fork`.
2. Crear fork de P1 y mostrar que aparece como hijo indentado.
3. Ir a Memory y mostrar paginas COW con candado.
4. Pulsar `Write to page 0` en el hijo y mostrar que se materializa copia.
5. Ir a Threads, seleccionar `FCFS`, `Cores=4`, pulsar `Run`.
6. Mostrar Gantt creciendo por core.
7. Abrir DevTools y mostrar Workers activos.
8. Abrir Performance y mostrar actividad paralela.
9. Ejecutar o mostrar resultado de:

   ```powershell
   node tests/integration/threads-execution.test.js
   ```

## Issues conocidos

- MLQ y MLFQ se ejecutan single-core aunque se soliciten mas cores. El warning
  es intencional para preservar la semantica de colas multinivel.
- COW es una simulacion visual/educativa; no altera las metricas de scheduling.
- Las metricas observadas usan tiempo simulado. El wall-clock puede variar por
  timers del navegador y carga del equipo.
- Deploy en `ubiquitous.udem.edu` no fue verificable desde este workspace porque
  no hay credenciales ni navegadores locales disponibles.
