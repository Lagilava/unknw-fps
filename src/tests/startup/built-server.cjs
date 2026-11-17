const express = require('express');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..', 'dist');
const app = express();
// Same layout as Pages: page under /play/, runtime assets beside it.
app.use('/assets', express.static(path.join(root, 'assets')));
app.use('/play', express.static(root));
app.get('/', (_req, res) => res.send('ready'));
app.listen(8012, '127.0.0.1');
