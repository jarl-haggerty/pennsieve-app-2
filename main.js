//const { app, BrowserWindow } = require('electron')
const http = require('http');
const https = require('https');
const fs = require('fs');
const afs = require('fs/promises');
const {Buffer} = require('buffer');
const ws = require('ws');
const crypto = require('crypto');
const querystring = require('querystring');
const protobuf = require("protobufjs");
const {EdfFile, EdfTimeSeriesMessage} = require('./edf')

const DIST = 'dist'
const server = http.createServer((req, res) => {
  let filename = DIST + req.url;
  if(filename.endsWith('/')) {
    filename += 'index.html';
  } else if (filename.startsWith(DIST + '/N:')) {
    filename = DIST + '/index.html';
  }
  console.log('getting ' + filename);
  fs.readFile(filename, (err, data) => {
    if(err) {
      const json = JSON.stringify(err);
      console.log('error ' + filename + ' ' + json);
      res.writeHead(404);
      res.end(json);
      return;
    }
    const headers = {};
    if(filename.endsWith('.html')) {
      headers['Content-Type'] = 'text/html';
    } else if(filename.endsWith('.xml')) {
      headers['Content-Type'] = 'application/xml';
    } else if(filename.endsWith('.css')) {
      headers['Content-Type'] = 'text/css';
    } else if(filename.endsWith('.js')) {
      headers['Content-Type'] = 'text/javascript';
    } else if(filename.endsWith('.json')) {
      headers['Content-Type'] = 'application/json';
    } else if(filename.endsWith('.svg')) {
      headers['Content-Type'] = 'image/svg+xml';
    } else if(filename.endsWith('.svg')) {
      headers['Content-Type'] = 'image/svg+xml';
    } else if(filename.endsWith('.png')) {
      headers['Content-Type'] = 'image/png';
    } else if(filename.endsWith('.jpg')) {
      headers['Content-Type'] = 'image/jpeg';
    } else if(filename.endsWith('.txt')) {
      headers['Content-Type'] = 'text/plain';
    } else if(filename.endsWith('.woff')) {
      headers['Content-Type'] = 'font/woff';
    } else if(filename.endsWith('.woff2')) {
      headers['Content-Type'] = 'font/woff2';
    } else if(filename.endsWith('.ttf')) {
      headers['Content-Type'] = 'font/ttf';
    } else if(filename.endsWith('.eot')) {
      headers['Content-Type'] = 'application/vnd.ms-fontobject';
    } else if(filename.endsWith('.ico')) {
      headers['Content-Type'] = 'image/vnd.microsoft.icon';
    }
    console.log('got ' + filename + ' ' + headers['Content-Type']);
    res.writeHead(200, headers);
    res.end(data);
  });
})
server.listen(3000, () => {
  console.log('Pennsieve listening')

  //app.whenReady().then(() => {
  //  createWindow()
  //})
})

protobuf.load('pennsieve.proto', (err, root) => {
  console.log(err)
  console.log(root)
  const TimeSeriesMessage = root.lookupType('pennsieve.TimeSeriesMessage')

  const wsServer = new ws.Server({server});
  wsServer.on('connection', async (socket, request) => {
    console.log('websocket connect ' + request.url)
    
    const parsed = querystring.decode(request.url)
    const apiKey = parsed['api_key']
    const packageId = parsed['package']

    const hash = crypto.createHash('sha1')
    hash.update(packageId)
    //const packageIdHash = 'visualize-test-3.edf'
    const packageIdHash = hash.digest('hex')
    const edfFilename = `${DIST}/${packageIdHash}`
    /** @type EdfFile */
    let edfFile

    let pending = []
    let pennsieveSocket = null
    let pennsieveReady = false

    const middleware = () => {
      console.log('middleware')
      pennsieveSocket = new ws(`wss://api.pennsieve.net${request.url}`)
      pennsieveSocket.on('error', console.error)
      pennsieveSocket.on('open', () => {
        console.log('websocket forwarding')
        pennsieveReady = true
        pending.forEach(m => {
          console.log('send ' + m)
          pennsieveSocket.send(m)
        })
        pending = []
      })

      pennsieveSocket.on('message', (data, isBinary) => {
        console.log('receive ' + (typeof data))
        if(typeof data === 'object') {
          const decoded = TimeSeriesMessage.decode(data)
          if(decoded.segment.requestedSamplePeriod) {
            console.log(decoded)
          }
        }
        socket.send(data)
      })
    }

    socket.on('close', () => {
      if(edfFile) {
        edfFile.close()
      }
    })
    socket.on('error', console.error)
    socket.on('message', async data => {
      const parsed = JSON.parse(data)
      if(!parsed.hasOwnProperty('virtualChannels')) {
        if(pennsieveReady) {
          console.log('send ' + data)
          pennsieveSocket.send(data)
        } else {
          pending.push(data)
        }
        return
      }

      /** @type {[key: string]: string} */
      const nameToChannel = parsed.virtualChannels.reduce((a, b) => {
        a[b.name] = b.id
        return a
      }, {})

      const start = new Date(parsed.startTime/1000)
      const end = new Date(parsed.endTime/1000)
      /** @type EdfTimeSeriesMessage[] */
      let objects
      try {
        objects = await edfFile.read(start, end, parsed.minMax, parsed.pixelWidth)
      } catch(e) {
        console.log(e)
      }
      console.log(start)
      objects.forEach(obj => {
        obj.segment.source = nameToChannel[obj.segment.channelName]
        const encoded = TimeSeriesMessage.encode(obj).finish()
        //console.log(obj.segment.data)
        //console.log(obj.segment.requestedSamplePeriod)
        //console.log(obj.segment.samplePeriod)
        //console.log(obj.segment.nrPoints)
        //console.log(obj.segment.data)
        socket.send(encoded)
      })
      //console.log(JSON.stringify(data))
    })

    const download = (url) => {
      console.log('downloading ' + url)
      const request = https.request(`${url}?api_key=${apiKey}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }, response => {
        console.log(`${response.statusCode} ${response.statusMessage}`)
        if(response.statusCode >= 300 && response.statusCode < 400) {
          console.log(`redirect ${JSON.stringify(response.headers)}`)
          download(response.headers.location.replace('?api_key=undefined', ''))
          return
        }
        if(response.statusCode < 200 || response.status >= 300) {
          return
        }
        console.log('piping')
        const fileStream = fs.createWriteStream(edfFilename)
        response.pipe(fileStream).on('finish', () => {
          EdfFile.open(edfFilename).then(value => {
            edfFile = value
            middleware()
          })
        })
      })
      const body = { data: JSON.stringify({ nodeIds: [packageId] }) }
      const bodyStr = querystring.stringify({ data: JSON.stringify({ nodeIds: [packageId] }) })
      console.log(body)
      console.log(bodyStr)
      request.write(bodyStr)
      request.end()
    }

    fs.access(edfFilename, err => {
      if(err) {
        download('https://api.pennsieve.net/zipit')
      } else {
        EdfFile.validate(edfFilename).then(valid => {
          if(valid) {
            EdfFile.open(edfFilename).then(value => {
              edfFile = value
              middleware()
            })
          } else {
            download('https://api.pennsieve.net/zipit')
          }
        })
      }
    })
  })
});

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600
  })

  win.loadURL('http://localhost:3000')
}


//app.on('window-all-closed', () => {
//  server.close(() => {
//    app.quit();
//  });
//})
