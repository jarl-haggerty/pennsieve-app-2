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
      res.writeHead(404);
      res.end(JSON.stringify(err));
      return;
    }
    const headers = {};
    if(filename.endsWith('.html')) {
      headers['Content-Type'] = 'text/html';
    } else if(filename.endsWith('.css')) {
      headers['Content-Type'] = 'text/css';
    } else if(filename.endsWith('.js')) {
      headers['Content-Type'] = 'text/javascript';
    } else if(filename.endsWith('.json')) {
      headers['Content-Type'] = 'application/json';
    }
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
