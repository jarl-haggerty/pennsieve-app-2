const { app, BrowserWindow } = require('electron')
const http = require('http');
const fs = require('fs');

const server = http.createServer((req, res) => {
  let filename = __dirname + req.url;
  if(filename.endsWith('/')) {
    filename += 'index.html';
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
}).listen(3000, () => {
  console.log('Pennsieve listening')

  app.whenReady().then(() => {
    createWindow()
  })
});

const createWindow = () => {
  const win = new BrowserWindow({
    width: 800,
    height: 600
  })

  win.loadURL('http://localhost:3000')
}


app.on('window-all-closed', () => {
  server.close(() => {
    app.quit();
  });
})
