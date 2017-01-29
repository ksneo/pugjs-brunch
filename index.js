'use strict'

const flattenBrunchMap = require('flatten-brunch-map')
const genPugSourceMap = require('gen-pug-source-map')
const sysPath = require('path')
const touch = require('touch')
const pug = require('pug')
const anymatch = require('anymatch')
//const PRECOMP = /\.static\.(?:jade|pug)$/

// used pug options, note this list does not include 'name'
const PUGPROPS = [
  'filename', 'basedir', 'doctype', 'pretty', 'filters', 'self',
  'debug', 'compileDebug', 'globals', 'inlineRuntimeFunctions'
]

const dup = (src) => Object.assign({}, src)

// perform a deep cloning of an object
function clone (obj) {
  if (obj == null || typeof obj != 'object') return obj
  const copy = obj.constructor()
  for (const attr in obj) {
    if (obj.hasOwnProperty(attr)) copy[attr] = clone(obj[attr])
  }
  return copy
}

function cloneProps (src, list) {
  return list.reduce((o, p) => {
    if (p in src) o[p] = clone(src[p])
    return o
  }, {})
}

/*
    THE PLUGIN
*/

class PugCompiler {

  constructor (brunchConf) {

    const defaultBasedir = sysPath.join(brunchConf.paths.root, 'app')

    // shallow copy the options passed by the user mixed with defaults
    const config = Object.assign(
      {
        doctype: 'html',
        basedir: defaultBasedir,
        staticBasedir: sysPath.join(defaultBasedir, 'assets'),
        staticPretty: true,
        inlineRuntimeFunctions: false,
        compileDebug: !brunchConf.optimize,
        sourceMap: !!brunchConf.sourceMaps,
        globals: [],
        partials: ''
      },
      brunchConf.plugins && brunchConf.plugins.pug
    )

    this.config = config

    if (config.pattern) this.pattern = config.pattern

    // The runtime can be excluded by setting pugRuntime:false
    if ('noRuntime' in config) {
      // eslint-disable-next-line no-console
      console.error('pugjs-brunch: `noRuntime` is DEPRECATED, please use `pugRuntime:false`')
      if (config.noRuntime) config.pugRuntime = false
    }

    if (config.preCompile && !config.preCompilePattern) {
      config.pugRuntime = false
    }
    if (config.pugRuntime !== false && !config.inlineRuntimeFunctions) {
      this._addRuntime(config.pugRuntime)
    }

    this._depcache = []
  }

  getDependencies (data, path, cb) {
    const deps = path in this._depcache && this._depcache[path] || []
    return cb(null, deps)
  }

  compile (params) {
    const data = params.data
    const path = params.path

    const partialsMatchers = this.config.partials

    if (anymatch(partialsMatchers, path)) {
      return new Promise((resolve, reject) => {
        try {
          this._updateAddicted(path)
          // if this file in partials directory, return nothing
          resolve('')
        } catch (_error) {
          reject(_error)
        }
      })
    }

    if (this.config.preCompile &&
      (!this.config.preCompilePattern || this.config.preCompilePattern.test(path))
     ) {
      return this._precompile(
        data,
        path,
        this.config
      )
    }

    return new Promise((resolve, reject) => {

      // cloning options is mandatory because Pug changes it
      const options = cloneProps(this.config, PUGPROPS)
      options.filename = path

      try {
        const dbg = options.compileDebug
        if (this.config.sourceMap) options.compileDebug = true

        const res = pug.compileClientWithDependenciesTracked(data, options)
        this._setDeps(path, res)

        let result = this._export(path, res.body)

        if (this.config.sourceMap) {
          const duple = genPugSourceMap(path, result, {
            basedir: options.basedir,
            keepDebugLines: dbg
          })
          result = flattenBrunchMap(params, duple.data, duple.map)
        }

        resolve(result)

      } catch (_error) {

        reject(_error)
      }
    })
  }

  compileStatic (params) {
    return this._precompile(
      params.data,
      params.path,
      this.config,
      true
    )
  }

  _precompile (data, path, config, asset) {
    const locals  = dup(config.locals)
    const options = cloneProps(config, PUGPROPS)
    // by no inlining functions, pug uses own `require('pug-runtime')`
    options.inlineRuntimeFunctions = false

    // set options.filename to the filename, but relative to Brunch root
    options.filename = path

    // now set the staticBasedir only for assets (static html files)
    if (asset) {
      options.basedir = config.staticBasedir
      options.pretty  = 'staticPretty' in config ? config.staticPretty : config.pretty
    }

    return new Promise((resolve, reject) => {
      try {
        const fn = pug.compile(data, options)
        let html = fn(locals)

        if (!asset) {
          html = this._export(null, JSON.stringify(html))
        }
        this._setDeps(path, fn)

        resolve(html)

      } catch (error) {

        reject(error)
      }
    })
  }

  _setDeps (path, res) {
    const src = res.dependencies
    if (src && src.length) {
      const deps = []
      src.forEach(dep => { if (deps.indexOf(dep) < 0) deps.push(dep) })
      this._depcache[path] = deps
    }
  }

  _addRuntime (path) {
    if (!path) {
      path = './runtime.js'
    } else if (path[0] === '.') {
      path = sysPath.resolve('.', path)
    }
    try {
      this.include = [require.resolve(path)]
    } catch (e) {
      throw e
    }
  }

  _export (path, tmpl) {
    return path === null ? `module.exports = ${tmpl};\n` : `${tmpl};\nmodule.exports = template;\n`
  }

  _updateAddicted (path) {
    for (const addicted in this._depcache) {
      if (this._depcache.hasOwnProperty(addicted)) {
        this._depcache[addicted].forEach((dep) => {
          if (sysPath.relative(dep, path) === '') {
            touch(addicted)
          }
        })
      }
    }
  }
}

PugCompiler.prototype.brunchPlugin = true
PugCompiler.prototype.type = 'template'
PugCompiler.prototype.pattern = /\.(?:pug|jade)$/
PugCompiler.prototype.staticTargetExtension = 'html'

module.exports = PugCompiler
