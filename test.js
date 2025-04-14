const http = require('http');
const https = require('https');
const fs = require('fs');
const afs = require('fs/promises');
const {Buffer} = require('buffer');
const ws = require('ws');
const crypto = require('crypto');
const querystring = require('querystring');

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
readEdf('dist/e165b1c78d772e8825e96c513bc5d7b33d8ff755')
