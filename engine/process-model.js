// process-model.js - Process table helpers that are independent from the DOM.

import { makeProcess, makeThread } from '../types.js';

let processTable = [];

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensureMemoryModel(process) {
  if (!process.memory) process.memory = {};
  if (!Array.isArray(process.memory.cowPages)) process.memory.cowPages = [];
  if (!process.memory.pageVersions) process.memory.pageVersions = {};
  if (!Array.isArray(process.memory.materializedCowPages)) {
    process.memory.materializedCowPages = [];
  }
  return process.memory;
}

function nextPid(processes) {
  return Math.max(0, ...processes.map(process => Number(process.pid) || 0)) + 1;
}

function nextTid(processes) {
  let maxTid = 0;
  for (const process of processes) {
    for (const thread of process.threads || []) {
      maxTid = Math.max(maxTid, Number(thread.tid) || 0);
    }
  }
  return maxTid + 1;
}

function forkOrdinal(parentPid) {
  return processTable.filter(process => process.forkParentPid === parentPid).length + 1;
}

function forkLabel(parent, ordinal) {
  const parentLabel = parent.forkLabel || `P${parent.pid}`;
  return `${parentLabel}.${ordinal}`;
}

function removeCowGroup(groupId) {
  for (const process of processTable) {
    if (!process.memory || !Array.isArray(process.memory.cowPages)) continue;
    process.memory.cowPages = process.memory.cowPages.filter(entry => entry.groupId !== groupId);
  }
}

/**
 * Replaces the process table used by simulated process-model operations.
 * The array reference is kept so callers can observe mutations.
 *
 * @param {import('../types.js').Process[]} processes
 */
export function setProcessTable(processes) {
  processTable = Array.isArray(processes) ? processes : [];
}

/**
 * @returns {import('../types.js').Process[]}
 */
export function getProcessTable() {
  return processTable;
}

/**
 * Simulación de la syscall fork() de POSIX.
 *
 * En un sistema operativo real, fork() invoca sys_fork (Linux) o
 * equivalente, que duplica el proceso llamante creando un hijo con:
 *   - PID nuevo asignado por el kernel
 *   - Espacio de direcciones idéntico al padre, compartido vía
 *     copy-on-write (COW). Las páginas físicas son compartidas hasta
 *     que ocurre una escritura, momento en que el kernel duplica
 *     la página específica.
 *   - Atributos heredados: prioridad, file descriptors, signal
 *     handlers, working directory, etc.
 *
 * Como CoreView corre en un navegador, no podemos invocar la syscall
 * real (no hay acceso a primitivas del kernel desde JavaScript en
 * browser). Esta función replica el comportamiento OBSERVABLE para
 * fines educativos:
 *   - Asigna PID nuevo (siguiente disponible en la tabla de procesos)
 *   - Marca todas las páginas del padre como COW (compartidas)
 *   - Cuando ocurre escritura en página COW, dispara duplicación
 *     visible en la pantalla de Memory
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
export function simulatedFork(parentPid) {
  const parent = processTable.find(process => process.pid === parentPid);
  if (!parent) {
    throw new Error(`No existe P${parentPid} para fork().`);
  }

  const childPid = nextPid(processTable);
  let tid = nextTid(processTable);
  const childThreads = (parent.threads || []).map(thread => makeThread({
    tid: tid++,
    parentPid: childPid,
    arrivalTime: thread.arrivalTime,
    burstTime: thread.burstTime,
    priority: thread.priority ?? parent.priority,
    state: 'NEW',
    remainingTime: thread.burstTime,
    stackPages: thread.stackPages,
  }));

  const ordinal = forkOrdinal(parent.pid);
  const child = makeProcess({
    pid: childPid,
    arrivalTime: parent.arrivalTime,
    burstTime: parent.burstTime,
    priority: parent.priority,
    sharedPages: parent.sharedPages,
    numPages: parent.numPages,
    threads: childThreads,
  });

  child.isForkChild = true;
  child.forkParentPid = parent.pid;
  child.forkLabel = forkLabel(parent, ordinal);

  const parentMemory = ensureMemoryModel(parent);
  const childMemory = ensureMemoryModel(child);
  parent.forkChildrenPids = Array.isArray(parent.forkChildrenPids)
    ? parent.forkChildrenPids
    : [];
  parent.forkChildrenPids.push(child.pid);

  for (let pageNumber = 0; pageNumber < parent.numPages; pageNumber += 1) {
    const groupId = `cow-${parent.pid}-${child.pid}-${pageNumber}`;
    parentMemory.cowPages.push({
      pageNumber,
      groupId,
      originalOwnerPid: parent.pid,
      sharedWithPids: [child.pid],
      createdByForkPid: child.pid,
    });
    childMemory.cowPages.push({
      pageNumber,
      groupId,
      originalOwnerPid: parent.pid,
      sharedWithPids: [parent.pid],
      createdByForkPid: child.pid,
    });
  }

  processTable.push(child);
  return child;
}

/**
 * Simulates a write to a process page. COW pages are materialized by removing
 * the COW group and marking the writing process page as a private copy.
 *
 * @param {import('../types.js').Process[]} processes
 * @param {number} writerPid
 * @param {number} pageNumber
 * @returns {{ duplicated: boolean, writerPid: number, pageNumber: number, sharedWithPids?: number[] }}
 */
export function writeProcessPage(processes, writerPid, pageNumber) {
  setProcessTable(processes);
  const writer = processTable.find(process => process.pid === writerPid);
  if (!writer) {
    throw new Error(`No existe P${writerPid}.`);
  }
  if (!Number.isInteger(pageNumber) || pageNumber < 0 || pageNumber >= writer.numPages) {
    throw new Error(`Página ${pageNumber} fuera de rango para P${writerPid}.`);
  }

  const memory = ensureMemoryModel(writer);
  const cowEntries = memory.cowPages.filter(entry => entry.pageNumber === pageNumber);

  if (cowEntries.length === 0) {
    const currentVersion = Number(memory.pageVersions[pageNumber] || 0);
    memory.pageVersions[pageNumber] = currentVersion + 1;
    return { duplicated: false, writerPid, pageNumber };
  }

  const sharedWithPids = new Set();
  for (const entry of cowEntries) {
    for (const pid of entry.sharedWithPids || []) sharedWithPids.add(pid);
    removeCowGroup(entry.groupId);
  }

  if (!memory.materializedCowPages.includes(pageNumber)) {
    memory.materializedCowPages.push(pageNumber);
  }
  const currentVersion = Number(memory.pageVersions[pageNumber] || 0);
  memory.pageVersions[pageNumber] = currentVersion + 1;

  return {
    duplicated: true,
    writerPid,
    pageNumber,
    sharedWithPids: [...sharedWithPids],
  };
}

export function cloneProcessMetadata(process) {
  return {
    isForkChild: Boolean(process.isForkChild),
    forkParentPid: process.forkParentPid ?? null,
    forkLabel: process.forkLabel || null,
    forkChildrenPids: Array.isArray(process.forkChildrenPids)
      ? process.forkChildrenPids.slice()
      : [],
    memory: process.memory ? cloneJson(process.memory) : null,
  };
}
