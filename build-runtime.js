/* eslint max-len:0 */
//'use strict'
const path = require('path')
const fs = require('fs')

const srcPugPath = require.resolve('pug-runtime')
const srcRuntime = fs.readFileSync(srcPugPath, 'utf8')

// wrap the runtime, honors existing pug and module.exports objects
const runtime = `(function (exports) {
${
  srcRuntime.replace(/^(?=\s*\S)/gm, '  ') // indent
}
})(
  typeof pug == 'object' && pug || typeof module == 'object' && module.exports || (this.pug = {})
);\n`

// make sure the destination directory exists
const dest = path.join(__dirname, 'vendor')
if (!fs.existsSync(dest)) fs.mkdirSync(dest)

// write our custom runtime
const destFile = path.join(dest, 'pug_runtime.js')
fs.writeFileSync(destFile, runtime, 'utf8')

console.log(`${destFile} written.`)     	// eslint-disable-line no-console
