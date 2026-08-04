'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Extracts a top-level `const NAME = <value>;` from a source file and
 * evaluates just that literal — no DOM, no jsdom, no side effects. Used to
 * compare data (e.g. the SURAHS table) duplicated across HTML files without
 * loading either page.
 * @param {string} filename - relative to the repo root.
 * @param {string} constName
 * @returns {*} The evaluated value.
 */
function extractConst(filename, constName) {
  const source = fs.readFileSync(path.join(ROOT, filename), 'utf8');
  const marker = `const ${constName} = `;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`${marker} not found in ${filename}`);
  const valueStart = start + marker.length;
  const end = source.indexOf(';\n', valueStart);
  if (end === -1) throw new Error(`No terminating ";" found for ${constName} in ${filename}`);
  const literal = source.slice(valueStart, end);
  return new Function(`return (${literal});`)();
}

module.exports = { extractConst };
