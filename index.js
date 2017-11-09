'use strict';

var childProcess = require('child_process');
var promise = require("bluebird");
var path = require('path');
var conversion = promise.promisify(require('phantom-html-to-pdf')());
var twemoji = require('twemoji');
var cheerio = require('cheerio');

var PDFParser = require("pdf2json");

module.exports = {
  initialize : function (dataSource, callback) {
    var settings = dataSource.settings || {};

    function createRenderings(renderings) {
      var jobs = renderings.map(function (rendering) {
        return createRendering(
          rendering.id, rendering.html, rendering.extension, rendering.folder, rendering.pages)
      })
      return promise.all(jobs);
    }

    function createRendering(id, html, extension, folder, pages) {
      var Container = dataSource.models.Container;
      var app = Container.app;
      var storage = app.datasources.storage;

      folder = folder || '';

      html = twemoji.parse(html, {
          folder: '/svg',
          ext: '.svg',
          base: path.resolve(
            'node_modules/loopback-component-phantom-local/node_modules/twemoji/2')
      });
      var parsedHtml = cheerio.load(html);
      parsedHtml
      ('head')
      .append('<style>img.emoji {height: 1em;width: 1.3em;margin: .1em;vertical-align: text-bottom;}</style>')
      html = parsedHtml.html();

      var phantomArgs = app.get('phantom');
      phantomArgs.format = extension;
      phantomArgs.html = html;

      return conversion(phantomArgs)
      //workaround for corrupted pdf meta
      .then(function(result){
        if(extension !== 'pdf')
          return result.stream;

        return new promise(function(resolve, reject) {
          var gs = childProcess.spawn('gs', ['-q', '-o', '-', '-sDEVICE=pdfwrite',
           '-dPDFSETTINGS=/prepress', '-']);

           result.stream.pipe(gs.stdin);
           if(pages){
             let pdfParser = new PDFParser();
             pdfParser.on("pdfParser_dataError", errData => {
               reject(errData);
             });
             pdfParser.on("pdfParser_dataReady", pdfData => {
              if(pdfData.formImage.Pages.length !== pages){
                reject(new Error('pdf has invalid amount of pages'));
              }else{
                resolve(gs.stdout);
              }
             });
             result.stream.pipe(pdfParser);
           }else{
             resolve(gs.stdout);
           }

        });
      })
      .then(function(result) {
        return Container.uploadFromStream(result,
          storage.settings.container,
          folder + id + '.' + extension);
      })
    }

    function getRendering(id, req, res, cb, extension, folder) {
      var Container = dataSource.models.Container;
      var app = Container.app;

      folder = folder || '';

      return Container.download(app.datasources.storage.settings.container,
        folder + id + '.' + extension, req, res, cb);
    }

    function cleanUp() {
      console.log('cleaning up phantomjs');
      conversion.kill();
      process.exit(1);
    }
    process.on('SIGTERM', cleanUp);
    process.on('SIGINT', cleanUp);

    var connector = {
      createRendering: createRendering,
      getRendering : getRendering,
      createRenderings: createRenderings
    };

    dataSource.connector = connector;
    dataSource.connector.dataSource = dataSource;

    callback();
  }
}
