const http = require('http')
const https = require('https')
const fs = require('fs')
const afs = require('fs/promises')
const {Buffer} = require('buffer')
const ws = require('ws')
const crypto = require('crypto')
const querystring = require('querystring')
const Long = require('long')

class Segment {
  constructor() {
    /** @type Int16Array[] */
    this.dataBuffers = []
    /** @type Float64Array */
    this.data = new Float64Array()

    this.startTs = Long.ZERO
    this.source = ''
    this.lastUsed = Long.ZERO
    this.unit = ''
    this.samplePeriod = 0
    this.requestedSamplePeriod = 0
    this.pageStart = Long.ZERO
    this.isMinMax = false
    this.unitM = Long.fromNumber(1000)
    this.segmentType = 'Continuous'
    this.nrPoints = Long.ZERO
    this.pageEnd = Long.ZERO
    this.channelName = ''
  }

  buildData() {
    const total = this.dataBuffers.reduce((a, b) => a + b.length, 0)
    this.data = new Float64Array(total)
    let offset = 0;
    this.dataBuffers.forEach((buffer) => {
      this.data.set(buffer, offset)
      offset += buffer.length
    })
    this.dataBuffers = []
  }
}

class EdfTimeSeriesMessage {
  constructor() {
    this.event = []
    this.segment = new Segment()
    /** @type long.Long */
    this.totalResponses = Long.ONE
  }
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

class EdfFile {
  /**
   * @param {FileHandle} file 
   */
  constructor(file, protobuf) {
    /** @type {fs.promises.FileHandle} */
    this.file = file
    this.protobuf = protobuf
    this.header = new EdfHeader()
    /** @type {EdfSignal[]} */
    this.signals = []
    /** @type {Buffer} */
    this.buffer = Buffer.alloc(256, 0)
    /** @type {number} */
    this.recordBytes = 0
  }

  async loadHeader() {
    await this.file.read(this.buffer, 0, 256, 0)

    let offset = 0
    const ascii = (count) => {
      const result = this.buffer.toString('utf8', offset, offset+count).trimEnd()
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

    this.header.start.setUTCFullYear(year, month-1, day)
    this.header.start.setUTCHours(hour, minute, second)

    this.header.numBytes = parseInt(ascii(8), 10)
    this.reserved = ascii(44)
    this.header.numRecords = parseInt(ascii(8), 10)
    this.header.duration = parseFloat(ascii(8))
    this.header.numSignals = parseInt(ascii(4), 10)

    this.signals = []
    for(let i = 0;i < this.header.numSignals;++i) {
      this.signals.push(new EdfSignal()) 
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
      await this.file.read(this.buffer, 0, length, fileOffset)
      fileOffset += length
      this.signals.forEach((signal, i) => {
        const text = this.buffer.toString('utf8', i*count, (i+1)*count).trimEnd()
        callback(signal, text)
      })
    }

    await readField(16, (signal, text) => {signal.label = text})
    await readField(80, (signal, text) => {signal.transducer = text})
    await readField(8, (signal, text) => {signal.dimension = text})
    await readField(8, (signal, text) => {signal.physicalMinimum = parseFloat(text)})
    await readField(8, (signal, text) => {signal.physicalMaximum = parseFloat(text)})
    await readField(8, (signal, text) => {signal.digitalMinimum = parseInt(text, 10)})
    await readField(8, (signal, text) => {signal.digitalMaximum = parseInt(text, 10)})
    await readField(80, (signal, text) => {signal.prefiltering = text})
    await readField(8, (signal, text) => {signal.numSamples = parseInt(text, 10)})

    this.recordBytes = this.signals.reduce((accum, signal) => accum + 2*signal.numSamples, 0)
    //this.buffer = Buffer.alloc(this.recordBytes, 0)
  }

  /**
   * 
   * @param {number} i 
   * @returns {Int16Array[]}
   */
  async readRecord(i) {
    const buffer = Buffer.alloc(this.recordBytes, 0)
    await this.file.read(buffer, 0, this.recordBytes, 256*(1+this.signals.length) + this.recordBytes*i)
    let offset = 0
    return this.signals.map(signal => {
      const array = new Int16Array(signal.numSamples)
      for(let i = 0;i < signal.numSamples;++i) {
        array[i] = buffer.readInt16LE(2*offset)
        ++offset
      }
      return array
    })
  }

  /**
   * 
   * @param {Date} start 
   * @param {Date} end 
   */
  async read(start, end, minmax = false, samplePeriodUs = 0) {
    const totalDuration = 1000*this.header.duration*this.header.numRecords

    const offsetMs = Math.min(totalDuration, Math.max(0, start - this.header.start))
    const offsetS = offsetMs/1000
    const startRecord = Math.floor(offsetS/this.header.duration)

    const endOffsetMs = Math.min(totalDuration, Math.max(0, end - this.header.start))
    const endOffsetS = endOffsetMs/1000
    const endRecord = Math.floor(endOffsetS/this.header.duration)+1

    /** @type EdfTimeSeriesMessage[] */
    const result = []

    for(let i = startRecord;i < endRecord;++i) {
      let record = await this.readRecord(i)
      if(i === startRecord) {
        const recordStartTimeS = i*this.header.duration
        const skippedS = offsetS - recordStartTimeS
        const skippedFraction = skippedS/this.header.duration
        record = record.map((samples, j) => {
          const signal = this.signals[j]
          const skippedSamplesRaw = signal.numSamples*skippedFraction
          const skippedSamplesFloor = Math.floor(skippedSamplesRaw)
          let skippedSamples = skippedSamplesFloor
          if(skippedSamplesRaw !== skippedSamplesFloor) {
            ++skippedSamples
          }
          return samples.slice(skippedSamples)
        })
      } else if(i === endRecord-1) {
        const recordEndTimeS = (i+1)*this.header.duration
        const skippedS = recordEndTimeS - endOffsetS
        const skippedFraction = skippedS/this.header.duration
        record = record.map((samples, j) => {
          const signal = this.signals[j]
          const skippedSamplesRaw = signal.numSamples*skippedFraction
          const skippedSamplesFloor = Math.floor(skippedSamplesRaw)
          let skippedSamples = skippedSamplesFloor
          if(skippedSamplesRaw !== skippedSamplesFloor) {
            ++skippedSamples
          }
          return samples.slice(0, samples.length - skippedSamples)
        })
      }

      record.forEach((samples, j) => {
        while(j >= result.length) {
          result.push(new EdfTimeSeriesMessage())
        }
        const message = result[j]
        message.segment.dataBuffers.push(samples)
      })
    }
    result.forEach((message, i) => {
      const segment = message.segment
      const signal = this.signals[i]
      let scale = 1
      let units = signal.dimension
      if(units === 'uV') {
        scale = 1e-6
        units = 'V'
      } else if(units === 'mV') {
        scale = 1e-3
        units = 'V'
      }

      segment.buildData()
      for(let i=0;i < segment.data.length;++i) {
        segment.data[i] *= scale
      }
      
      const rawSamplePeriodUs = Math.floor(1e6*this.header.duration/signal.numSamples)
      const startTime = Long.fromNumber(start.getTime()).mul(1000)
      segment.startTs = startTime
      segment.pageStart = startTime
      segment.pageEnd = Long.fromNumber(end.getTime()).mul(1000)
      segment.unit = units
      segment.samplePeriod = rawSamplePeriodUs
      segment.requestedSamplePeriod = samplePeriodUs
      segment.channelName = signal.label
      segment.nrPoints = Long.fromNumber(segment.data.length)

      if(samplePeriodUs) {
        segment.isMinMax = minmax
        let t = 0
        let milestone = samplePeriodUs
        let newData = []
        if(minmax) {
          let current = [Infinity, -Infinity]
          segment.data.forEach((sample) => {
            if(t >= milestone) {
              newData.splice(newData.length, 0, ...current)
              current = [Infinity, -Infinity]
              milestone += samplePeriodUs
            }
            current[0] = Math.min(current[0], sample)
            current[1] = Math.max(current[1], sample)
            t += rawSamplePeriodUs
          })
          if(isFinite(current[0])) {
            newData.splice(newData.length, 0, ...current)
          }
          segment.samplePeriod = rawSamplePeriodUs*(2*segment.data.length/newData.length)
        } else {
          let currentSum = 0
          let currentCount = 0
          segment.data.forEach((sample) => {
            if(t >= milestone) {
              newData.splice(newData.length, 0, currentSum/currentCount)
              currentSum = 0
              currentCount = 0
              milestone += samplePeriodUs
            }
            ++currentCount
            currentSum += sample
            t += rawSamplePeriodUs
          })
          if(currentCount) {
            newData.splice(newData.length, 0, currentSum/currentCount)
          }
          segment.samplePeriod = rawSamplePeriodUs*(segment.data.length/newData.length)
        }
        segment.data = newData
        segment.nrPoints = Long.fromNumber(segment.data.length)
      }
    })
    return result
  }
  /**
   * 
   * @param {string} filename 
   */
  static async open(filename) {
    const file = await afs.open(filename)
    const result = new EdfFile(file)
    await result.loadHeader()
    return result
  }

  close() {
    return this.file.close()
  }

  static async validate(filename) {
    let file
    try {
      file = await afs.open(filename)
    } catch(e) {
      return false
    }
    const result = new EdfFile(file)
    try {
      await result.loadHeader()
      await result.close()
    } catch(e) {
      return false
    }

    const stats = await afs.stat(filename)
    return stats.size === 256*(result.header.numSignals + 1) + result.recordBytes*result.header.numRecords
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
//readEdf('dist/visualize-test-3.edf')
module.exports = {
  EdfFile
}