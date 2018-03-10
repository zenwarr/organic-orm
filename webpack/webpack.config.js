const webpackCommon = require('./common');
const path = require('path');

module.exports = env => [
  {
    /**
     * Server
     */
    entry: './src/index.ts',

    output: {
      filename: "bundle.js",
      path: path.join(__dirname, '/../dist'),
      libraryTarget: 'commonjs'
    },

    externals: [webpackCommon.buildExternals()],

    target: 'node',

    mode: env.prod === true ? 'production' : 'development',

    resolve: {
      extensions: ['.ts', '.tsx', '.js', '.json', '.webpack.js']
    },

    module: {
      rules: [
        {
          test: /\.tsx?$/,
          loader: 'ts-loader'
        },
        {
          enforce: 'pre',
          test: /\.js$/,
          loader: 'source-map-loader'
        }
      ]
    }
  }
];
