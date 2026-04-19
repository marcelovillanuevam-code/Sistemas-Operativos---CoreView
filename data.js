// data.js — Data layer. Parse and validate user input into Process[] and MemoryConfig.
// No DOM access in pure parse functions. Depends on nothing else.

/**
 * @param {FormData} formData
 * @returns {import('./types.js').Process[]}
 */
export function parseProcessesFromForm(formData) {
  throw new Error('Not implemented');
}

/**
 * @param {string} fileContent
 * @returns {import('./types.js').Process[]}
 */
export function parseProcessesFromFile(fileContent) {
  throw new Error('Not implemented');
}

/**
 * @param {FormData} formData
 * @returns {import('./types.js').MemoryConfig}
 */
export function parseMemoryConfig(formData) {
  throw new Error('Not implemented');
}

/**
 * @param {string} fileContent
 * @returns {import('./types.js').MemoryConfig}
 */
export function parseMemoryConfigFromFile(fileContent) {
  throw new Error('Not implemented');
}

/**
 * @param {import('./types.js').Process[]} processes
 * @param {number} length
 * @returns {import('./types.js').PageRef[]}
 */
export function generateReferenceString(processes, length) {
  throw new Error('Not implemented');
}

/**
 * @param {import('./types.js').Process[]} processes
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateProcesses(processes) {
  throw new Error('Not implemented');
}
