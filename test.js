const http = require('http');
const https = require('https');
const fs = require('fs');
const afs = require('fs/promises');
const {Buffer} = require('buffer');
const ws = require('ws');
const crypto = require('crypto');
const querystring = require('querystring');

/**
 * 
 * @param {string} fileName 
 */
async function loadEdf(fileName) {

}

class EdfHeader {
  constructor() {
    this.version = ''
    this.patient = ''
    this.recording = ''
    this.start = new Date()
    this.numRecords = 0
    this.duration = 0
    this.numSignals = 0
  }
}

class EdfSignal {
  constructor() {
    this.label = ''
    this.transducer = ''
    this.dimension = ''
    this.physicalMinimum = 0
    this.physicalMaximum = 0
    this.digitalMinimum = 0
    this.digitalMaximum = 0
    this.prefiltering = ''
    this.numSamples = 0
  }
}

const q = new EdfHeader()

class EdfFile {
  /**
   * @param {FileHandle} file 
   */
  constructor(file) {
    /** @type {fs.promises.FileHandle} */
    this.file = file
    this.header = new EdfHeader()
    /** @type {EdfSignal[]} */
    this.signals = []
    /** @type {Buffer} */
    this.buffer = Buffer.alloc(256, 0)
    /** @type {number} */
    this.recordSize = 0
  }

  async loadHeader() {
    await this.file.read(this.buffer, 0, 256, 0)

    let offset = 0
    const ascii = (count) => {
      const result = this.buffer.slice(offset, offset+count).toString()
      offset += count
      return result
    }
    this.header.version = ascii(8)
    this.header.patient = ascii(80)
    this.header.recording = ascii(80)

    const startDate = ascii(8)
    const dateTokens = startDate.split('.')
    const day = parseInt(dateTokens[0], 10)
    const month = parseInt(dateTokens[1], 10)
    const year2Digit = parseInt(dateTokens[2], 10)
    const year = (year2Digit < 50 ? 2000 : 1900) + year2Digit

    const startTime = ascii(8)
    const timeTokens = startTime.split('.')
    const hour = parseInt(timeTokens[0], 10)
    const minute = parseInt(timeTokens[1], 10)
    const second = parseInt(timeTokens[2], 10)

    this.header.start.setFullYear(year, month, day)
    this.header.start.setHours(hour, minute, second)

    this.header.numBytes = parseInt(ascii(8), 10)
    this.reserved = ascii(44)
    this.header.numRecords = parseInt(ascii(8), 10)
    this.header.duration = parseFloat(ascii(8))
    this.header.numSignals = parseInt(ascii(4), 10)

    this.signals = []
    for(let i = 0;i < numSignals;++i) {
      signals.push(new EdfSignal()) 
    }

    let fileOffset = 256
    /**
     * @typedef {function(EdfSignal, string): void} FieldCallback
     * @type {function(number, FieldCallback): void}
     */
    const readField = async (count, callback) => {
      const length = count*this.header.numSignals
      if(this.buffer.length < length) {
        this.buffer = Buffer.alloc(length, 0)
      }
      await file.read(this.buffer, 0, length, fileOffset)
      fileOffset += length
      this.signals.forEach((signal, i) => {
        const text = this.buffer.toString('utf8', i*count, (i+1)*count)
        callback(signal, text)
      })
    }

    readField(16, (signal, text) => {signal.label = text})
    readField(80, (signal, text) => {signal.transducer = text})
    readField(8, (signal, text) => {signal.dimension = text})
    readField(8, (signal, text) => {signal.physicalMinimum = parseFloat(text)})
    readField(8, (signal, text) => {signal.physicalMaximum = parseFloat(text)})
    readField(8, (signal, text) => {signal.digitalMinimum = parseInt(text, 10)})
    readField(8, (signal, text) => {signal.digitalMaximum = parseInt(text, 10)})
    readField(80, (signal, text) => {signal.prefiltering = text})
    readField(8, (signal, text) => {signal.numSamples = parseInt(text, 10)})

    this.recordBytes = this.signals.reduce((accum, signal) => accum + 2*signal.numSamples, 0)
    this.buffer = Buffer.alloc(this.recordBytes, 0)
  }

  /**
   * 
   * @param {number} i 
   * @returns {Int16Array[]}
   */
  async readRecord(i) {
    await this.file.read(this.buffer, this.recordBytes, 256*(1+this.signals.length) + this.recordBytes*i)
    let offset = 0
    return this.signals.transform(signal => {
      const array = new Int16Array(signal.numSamples)
      for(let i = 0;i < signal.numSamples;++i) {
        array[i] = this.buffer.readInt16LE(2*offset)
      }
      return array
    })
  }

  /**
   * 
   * @param {Date} start 
   * @param {Date} end 
   */
  async readSignals(start, end) {
    const offsetMs = start - this.header.start
    const offsetS = offsetMs/1000
    const startRecord = Math.floor(offsetS/this.header.duration)

    const endOffsetMs = start - this.header.start
    const endOffsetS = offsetMs/1000
    const endRecord = Math.floor(endOffsetS/this.header.duration)+1

    for(let i = startRecord;i < endRecord;++i) {
      const record = await this.readRecord(i)
    }
  }
  /**
   * 
   * @param {string} filename 
   */
  static async load(filename) {
    const file = await afs.open(filename)
    const result = new EdfFile(file)
    await result.loadHeader()
  }
}

async function readEdf(filename) {
  const file = await afs.open(filename)
  console.log(file)
  const header = Buffer.alloc(256, 0)
  console.log(header)
  await file.read(header, 0, 256, 0)
  console.log(header)

  let offset = 0
  const ascii = (count) => {
    const result = header.slice(offset, offset+count).toString()
    offset += count
    return result
  }
  const version = ascii(8)
  const patient = ascii(80)
  const recording = ascii(80)
  const startDate = ascii(8)
  const startTime = ascii(8)
  const numBytes = ascii(8)
  const reserved = ascii(44)
  const numRecords = ascii(8)
  const duration = ascii(8)
  const numSignals = ascii(4)
  console.log('version ' + version)
  console.log('patient ' + patient)
  console.log('recording ' + recording)
  console.log('startDate ' + startDate)
  console.log('startTime ' + startTime)
  console.log('numBytes ' + numBytes)
  console.log('reserved ' + reserved)
  console.log('numRecords ' + numRecords)
  console.log('duration ' + duration)
  console.log('numSignals ' + numSignals)

  const signals = []
  for(let i = 0;i < numSignals;++i) {
    signals.push({}) 
  }

  let fileOffset = 256
  const readSignalField = async (field, count, transformer) => {
    for(let i = 0;i < numSignals;++i) {
      await file.read(header, 0, count, fileOffset)
      fileOffset += count
      signals[i][field] = header.toString('utf8', 0, count)
    }
  }
  await readSignalField('label', 16, a => a)
  await readSignalField('transducer', 80, a => a)
  await readSignalField('dimension', 8, a => a)
  await readSignalField('physicalMinimum', 8, parseInt)
  await readSignalField('physicalMaximum', 8, parseInt)
  await readSignalField('digitalMinimum', 8, parseInt)
  await readSignalField('digitalMaximum', 8, parseInt)
  await readSignalField('prefiltering', 80, parseInt)
  await readSignalField('numSamples', 8, parseInt)
  await readSignalField('reserved', 32, a => a)
  console.log(signals)

  const recordSize = signals.reduce((a, b) => a + b.numSamples*2, 0)

  const sampleBuffer = Buffer.alloc(2*signals[0].numSamples, 0)
  const outputFile = fs.createWriteStream('data.csv')
  for(let i = 0;i < numRecords;++i) {
    const z = await file.read(sampleBuffer, 0, 2*signals[0].numSamples, 256*(numSignals+1)+i*recordSize)
    //console.log(z)
    for(let j = 0;j < signals[0].numSamples;++j) {
      const sample = sampleBuffer.readInt16LE(2*j)
      //console.log(sample)
      outputFile.write(sample + '\n')
    }
  }
  outputFile.close()
}
readEdf('dist/visualize-test-3.edf')
