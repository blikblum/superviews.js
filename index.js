'use strict'

var nanoid = require('nanoid')
var htmlparser = require('htmlparser2')
var indentString = require('indent-string')
var hoist = require('./hoistBuilder')

var buffer = []
var indent = 0
var endBraces = {}
var literal = false
var hoistedLiteral = false
var meta = null
var treeContext = {}
var tagLevel = 0

var specialTags = {
  each: 'each',
  if: 'if',
  elseif: 'elseif',
  else: 'else',
  skip: 'skip'
}

function flush () {
  buffer.length = 0
  hoist.clear()
  indent = 0
  endBraces = {}
  literal = false
  hoistedLiteral = false
  meta = null
  treeContext = {}
  tagLevel = 0
}

function strify (str) {
  return '"' + (str || '') + '"'
}

function write (line) {
  var str = indentString(line, indent * 2)
  buffer.push(str)
  return line
}

function writeln (command, tag, key, spvp, pvp) {
  var str = command

  str += '(' + strify(tag)

  if (command === 'elementOpen') {
    if (key) {
      str += ', ' + key
    } else if (spvp && spvp.length) {
      str += ', ' + strify(nanoid())
    } else {
      str += ', null'
    }

    if (spvp && spvp.length) {
      var statics = '[' + spvp.map(function (item) {
        return strify(item.name) + ', ' + strify(item.value)
      }).join(', ') + ']'

      var varName = hoist.addStatics(statics)
      str += ', ' + varName
    } else {
      str += ', null'
    }

    str += pvp && pvp.length ? ', ' + pvp.map(function (item, index) {
      return index % 2 ? item : strify(item)
    }).join(', ') : ', null'
  }

  str += ')'

  str = str.replace(', null, null, null)', ')')
  str = str.replace(', null, null)', ')')
  str = str.replace(', null)', ')')

  return write(str)
}

function interpolate (text) {
  text = text.replace(/\{/g, '" + (')
  text = text.replace(/\}/g, ') + "')
  text = text.replace(/\n/g, ' \\\n')
  text = text.replace(/\r/g, '')
  return strify(text)
}

function getAttrs (attribs, nostatics) {
  var specials = {}
  var statics = []
  var properties = []
  var token = '{'
  var attrib

  for (var key in attribs) {
    attrib = attribs[key]

    if (key in specialTags) {
      specials[key] = attrib
    } else if (attrib.charAt(0) === token) {
      if (key === 'style') {
        properties.push(key)
        properties.push(attrib)
      } else {
        if (key.substr(0, 2) === 'on') {
          properties.push(key)
          properties.push(attrib.replace(token, 'function ($event) {\n  var $element = this;\n'))
        } else {
          properties.push(key)
          properties.push(attrib.substring(1, attrib.length - 1))
        }
      }
    } else if (attrib.indexOf(token) > 0) {
      properties.push(key)
      properties.push(interpolate(attrib))
    } else {
      if (nostatics) {
        properties.push(key)
        properties.push(strify(attrib))
      } else {
        statics.push({name: key, value: attrib})
      }
    }
  }
  // sort by attribute name
  statics.sort(function (attrib1, attrib2) {
    if (attrib1.name === attrib2.name) {
      return 0
    } else if (attrib1.name < attrib2.name) {
      return -1
    } else {
      return 1
    }
  })

  return {
    specials: specials,
    statics: statics,
    properties: properties
  }
}

function writeEach (name, eachProp, isElement) {
  var key = strify(nanoid() + '_')
  var idxComma = eachProp.indexOf(',')
  var idxIn = eachProp.indexOf(' in')

  if (typeof treeContext['each' + (tagLevel - 1)] !== 'undefined') {
    key += ' + __iterationKey' + (tagLevel - 1)
  }

  if (~idxComma && idxComma < idxIn) {
    key += ' + ' + eachProp.substring(idxComma + 2, idxIn)
    eachProp = eachProp.substring(0, idxComma) + eachProp.substr(idxIn)
  } else {
    key += ' + $item'
  }

  var eachParts = eachProp.split(' in ')
  var target = eachParts[1]
  write('__target = ' + target)
  write('if (__target) {')
  ++indent
  if (!isElement) {
    endBraces[name + '_each_' + indent] = '}, this)'
  }
  write(';(__target.forEach ? __target : Object.keys(__target)).forEach(function($value, $item, $target) {')
  ++indent
  if (isElement) {
    write('var __iterationKey' + tagLevel + ' = $item + "_"')
  }
  write('var ' + eachParts[0] + ' = $value')
  write('var $key = ' + key)
}

var handler = {
  onopentag: function (name, attribs) {
    tagLevel++
    if (!indent && (name === 'template') && 'args' in attribs) {
      meta = {
        name: attribs['name'],
        argstr: attribs['args']
      }
      indent++
      return
    }
    if (name === 'script' && !attribs['type']) {
      literal = true
      hoistedLiteral = typeof attribs['hoisted'] !== 'undefined'
      return
    }
    if (name === 'if') {
      write('if (' + (attribs['condition'] || attribs['expression'] || 'true') + ') {')
      ++indent
      return
    }
    if (name === 'elseif') {
      --indent
      write('} else if (' + (attribs['condition'] || attribs['expression'] || 'true') + ') {')
      ++indent
      return
    }
    if (name === 'else') {
      --indent
      write('} else {')
      ++indent
      return
    }

    if (name === 'each') {
      treeContext['each' + tagLevel] = 1
      writeEach(name, attribs['expression'] || '', true)
      return
    }

    var key = attribs['key']
    var nostatics
    if (typeof key !== 'undefined') {
      if (key === '') {
        nostatics = true
      } else {
        key = strify(key)
      }
      delete attribs['key']
    }

    var attrs = getAttrs(attribs, nostatics)
    var specials = attrs.specials

    if (specials.if) {
      endBraces[name + '_if_' + indent] = '}'
      write('if (' + specials.if + ') {')
      ++indent
    }

    if (specials.each) {
      writeEach(name, specials.each, false)
      key = '$key'
    }

    if (!key) {
      var keyIndex = treeContext['each' + (tagLevel - 1)]
      if (typeof keyIndex !== 'undefined') {
        key = '$key + "_' + keyIndex + '"'
        treeContext['each' + (tagLevel - 1)] = keyIndex + 1
      }
    }

    writeln('elementOpen', name, key, attrs.statics, attrs.properties)
    ++indent

    if ('skip' in specials) {
      write('if (' + (specials.skip || 'true') + ') {\n  skip()\n} else {')
      endBraces[name + '_skip_' + indent] = '}'
      ++indent
    }
  },
  ontext: function (text) {
    if (!text || !text.trim()) {
      return
    }

    if (literal) {
      if (hoistedLiteral) {
        hoist.addLiteral(text.trim())
      } else {
        write(text.trim())
      }
    } else {
      write('text(' + interpolate(text) + ')')
    }
  },
  onclosetag: function (name) {
    tagLevel--
    if ((indent === 1 && meta && name === 'template')) {
      return
    }

    if (name === specialTags.elseif || name === specialTags.else) {
      return
    }

    if (name === 'script' && literal) {
      literal = false
      return
    }

    if (name === 'if') {
      --indent
      write('}')
      return
    }

    if (name === 'each') {
      delete treeContext['each' + (tagLevel + 1)]
      --indent
      write('}, this)')
      --indent
      write('}')
      return
    }

    var endBraceKey, end

    // Check end `skip` braces
    endBraceKey = name + '_skip_' + (indent - 1)
    if (endBraces[endBraceKey]) {
      end = endBraces[endBraceKey]
      delete endBraces[endBraceKey]
      --indent
      write(end)
    }

    --indent
    writeln('elementClose', name)

    // Check end `each` braces

    endBraceKey = name + '_each_' + (indent - 1)
    if (endBraces[endBraceKey]) {
      end = endBraces[endBraceKey]
      delete endBraces[endBraceKey]
      --indent
      write(end)
      --indent
      write('}')
    }

    // Check end `if` braces
    endBraceKey = name + '_if_' + (indent - 1)
    if (endBraces[endBraceKey]) {
      end = endBraces[endBraceKey]
      delete endBraces[endBraceKey]
      --indent
      write(end)
    }
  }
}

module.exports = function (tmplstr, name, argstr, mode) {
  flush()

  var parser = new htmlparser.Parser(handler, {
    decodeEntities: false,
    lowerCaseAttributeNames: false,
    lowerCaseTags: false
  })

  parser.write(tmplstr)
  parser.end()

  var result = buffer.join('\n')

  name = (meta && meta.name) || (name || 'description')
  argstr = (meta && meta.argstr) || (argstr || 'data')

  var args = argstr.split(' ').filter(function (item) {
    return item.trim()
  }).join(', ')

  hoist.addLiteral(('var __target'))
  var hoisted = hoist.build()
  var fn = 'function ' + name + ' (' + args + ') {\n' + result + '\n}'

  switch (mode) {
    case 'browser':
      result = hoisted + '\n\n' + 'return ' + fn
      result = 'window.' + name + ' = (function () {' + '\n' + result + '\n' + '})()' + '\n'
      break
    case 'es6':
      result = 'import {patch, elementOpen, elementClose, text, skip, currentElement} from "incremental-dom"\n\n'
      result += hoisted + '\n\n' + 'export ' + fn + '\n'
      break
    case 'cjs':
      result = 'var IncrementalDOM = require(\'incremental-dom\')\n' +
        'var patch = IncrementalDOM.patch\n' +
        'var elementOpen = IncrementalDOM.elementOpen\n' +
        'var elementClose = IncrementalDOM.elementClose\n' +
        'var skip = IncrementalDOM.skip\n' +
        'var currentElement = IncrementalDOM.currentElement\n' +
        'var text = IncrementalDOM.text\n\n'
      result += hoisted + '\n\n'
      result += 'module.exports = ' + fn + '\n'
      break
    case 'amd':
      result = 'define([\'exports\', \'incremental-dom\'], function (exports, IncrementalDOM) {\n' +
        'var patch = IncrementalDOM.patch\n' +
        'var elementOpen = IncrementalDOM.elementOpen\n' +
        'var elementClose = IncrementalDOM.elementClose\n' +
        'var skip = IncrementalDOM.skip\n' +
        'var currentElement = IncrementalDOM.currentElement\n' +
        'var text = IncrementalDOM.text\n\n'
      result += hoisted + '\n\n'
      result += 'exports.' + name + ' = ' + '(function () {' + '\n  return ' + fn + '\n' + '})()' + '\n'
      result += '})\n'
      break
    default:
      result = hoisted + '\n\n' + 'return ' + fn
      result = (mode ? 'var ' + mode + ' = ' : ';') + '(function () {' + '\n' + result + '\n' + '})()' + '\n'
  }

  flush()

  return result
}
