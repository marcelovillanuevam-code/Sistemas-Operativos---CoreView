# CoreView samples

Los archivos de esta carpeta son CSV de texto plano. Las lineas vacias y las
lineas que empiezan con `#` se ignoran.

## Formato 5 columnas

`pid,arrival,burst,priority,sharedPages`

- `pid`: entero positivo. Identifica el proceso.
- `arrival`: entero no negativo. Tick de llegada del proceso.
- `burst`: entero no negativo en archivo; la validacion de modelo exige burst
  efectivo mayor que 0 antes de simular.
- `priority`: entero de 1 a 9. Menor numero significa mayor prioridad.
- `sharedPages`: entero positivo. Paginas compartidas por el proceso.

Ejemplo valido:

```txt
1,0,5,2,1
2,1,3,1,1
```

## Formato 9 columnas

`pid,arrival,procBurst,priority,sharedPages,numThreads,threadArrival,threadBurst,stackPages`

- `pid`: entero positivo. Varias filas pueden compartir PID para representar
  threads del mismo proceso.
- `arrival`: entero no negativo. Llegada del proceso.
- `procBurst`: entero no negativo. Se acepta por compatibilidad; CoreView usa
  la suma de los bursts de threads.
- `priority`: entero de 1 a 9.
- `sharedPages`: entero positivo.
- `numThreads`: entero positivo informativo.
- `threadArrival`: entero no negativo. Llegada del thread.
- `threadBurst`: entero no negativo en archivo; la validacion de modelo exige
  burst efectivo mayor que 0 antes de simular.
- `stackPages`: entero positivo. Paginas privadas del stack del thread.

Ejemplo valido:

```txt
1,0,8,2,1,2,0,5,1
1,0,8,2,1,2,0,3,1
```

## Ejemplos invalidos

```txt
abc,0,5,2,1   # PID no numerico
3,-1,5,2,1    # arrival negativo
4,0,5,99,1    # priority fuera de 1..9
5,0,5,2,0     # sharedPages debe ser positivo
```
