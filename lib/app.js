var sockjs = require('sockjs'),
    redis = require('redis'),
    mongo = require('mongodb');

exports.install = function (config, server, socketServer) {
    var socket = sockjs.createServer(config.sockjs);
    socket.installHandlers(server, config.sockjs); //{prefix: config.sockjs.prefix}

    var serviceServer = require('./services').create(config);

    //mongo.Connection.DEFAULT_PORT

    var mongoDB = new mongo.Db(config.mongo.db,
        new mongo.Server(config.mongo.host, config.mongo.port, {}), {forceServerObjectId: false});

    var redisDB = redis.createClient(config.redis.port, config.redis.host);
    var redisPS = redis.createClient(config.redis.port, config.redis.host); // PUB/SUB

    serviceServer.register(config.services) //регистрируем сервисы
        .setStorage(mongoDB, redisDB, redisPS)
        .on('ready', function () {
            this.initialize();

            this.installHandlers(socket);
            server.listen(config.server.port, config.server.host);
            logger.log('[*] SockJS: listening on ' + config.server.host + ':' + config.server.port);

            this.installSocketHandlers(socketServer);
            socketServer.listen(config.server.socket.port, config.server.socket.host);
            logger.log('[*] Socket: listening on ' + config.server.socket.host + ':' + config.server.socket.port);

            logger.mem('Memory: %sMb', (process.memoryUsage().rss / (1024 * 1024)).toFixed(2));
        });
}



