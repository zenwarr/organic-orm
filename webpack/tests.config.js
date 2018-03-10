const fs = require('fs');
const path = require('path');

/* Compile all test modules */

let baseDir = 'src/test/';
let entries = {};

function processDir(dirName) {
  let fullDirPath = path.join(__dirname, '..', dirName);
  let files = fs.readdirSync(fullDirPath);

  for (let j = 0; j < files.length; ++j) {
    let filename = files[j];
    let filepath = path.join(__dirname, '..', dirName, filename);
    let relpath = path.join(dirName, filename);

    if (fs.statSync(filepath).isDirectory()) {
      processDir(relpath);
    } else {
      let extname = path.extname(relpath);
      if ((extname === '.ts' || extname === '.tsx') && path.basename(relpath).charAt(0) !== '_') {
        let entryName = relpath.slice(0, -extname.length);
        entries['test/' + entryName.slice(baseDir.length)] = './' + relpath;
      }
    }
  }
}

processDir(baseDir);

let webpackCommon = require('./common');

module.exports = env => ({
  entry: entries,

  output: {
    filename: '[name].js',
    path: path.join(__dirname, '/../dist'),
    libraryTarget: 'commonjs'
  },

  target: 'node',

  externals: webpackCommon.buildExternals(),

  mode: env.prod === true ? 'production' : 'development',

  node: {
    __dirname: false,
    __filename: false
  },

  resolve: {
    extensions: ['.webpack.js', '.ts', '.tsx', '.js']
  },

  module: {
    rules: [
      {
        test: /\.ts[x]?$/,
        loader: 'ts-loader'
      }
    ]
  }
});
