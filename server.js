//основной скрипт запуска

var config = require('./config').config,
    app = require('./lib/app');

var server = require('http').createServer(),
    socketServer = require('net').createServer();

app.install(config, server, socketServer);

if (config.debug.enabled) {
  setInterval(function () {
    logger.mem('Memory: %sMb', (process.memoryUsage().rss / (1024 * 1024)).toFixed(2));
  }, config.log.beat * 1000);
}
