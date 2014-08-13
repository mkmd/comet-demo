
var tools = require('./toolkit'),
    Class = require('classful');

exports.create = function (config) {
    return Class.create({

        extend:    require('events').EventEmitter,
        singleton: true,

        constructor: function () {
            this.config = config;
            this.services = {};
            this.connections = {};
            this.redis =
                this.mongo =
                    this.mq = null;
        },

        properties: {
            setStorage: function (mongo, redis, mq) {
                this.mongo = mongo;
                this.redis = redis;
                this.mq = mq;

                var para0 = tools.fn.gather(function () {
                    var para = tools.fn.gather(function () { this.emit('ready'); }.bind(this));

                    var integrity;
                    for (var name in this.services) {
                        integrity = this.services[name].integrity();
                        if (integrity) {
                            integrity
                                .on('success', para.add());
                        }
                    }
                }.bind(this));

                this.mongo.open(para0.add());
                this._mqsub();

                return this;
            },

            installHandlers: function (to) {
                to.on('connection', function (connection) {
                    this._onOpen(connection);

                    connection.on('data', this._onReceive(connection));
                    connection.on('close', this._onClose(connection));
                }.bind(this));

                return this;
            },

            installSocketHandlers: function (to) {
                to.on('connection', function (connection) {
                    this._onSocketOpen(connection);

                    connection.on('data', this._onSocketReceive(connection));
                    connection.on('end', this._onClose(connection));
                }.bind(this));

                return this;
            },

            register: function (services) {
                try {
                    for (var name in services) {
                        this.services[name] = require('./services/' + name + '.js').create(this);
                    }
                } catch (e) { logger.notice(e, name); }

                return this;
            },

            initialize: function () {
                for (var name in this.services) { this.services[name].initialize(); }
                return this;
            },

            get: function (name) {
                if (!(name in this.services)) {
                    var err = new Error('service not available: ' + name);
                    logger.notice(err);
                    throw err;
                }

                return this.services[name];
            },

            addConnection: function (connection) {
                this.connections[connection.id] = connection;
                return this;
            },

            removeConnection: function (connection) {
                this.connections[connection.id] = null;
                delete this.connections[connection.id];

                connection = null;
                delete connection;

                return this;
            },

            send: function (to, service, event, data) {
                this._$send(to, service, event, data, true);
                return this;
            },

            broadcast: function (to, service, event, data) {
                this._$broadcast(to, service, event, data, true);
                return this;
            },

            _onOpen: function (connection) {
                this.addConnection(connection);
                this.emit('open', {connection: connection});
            },

            _onClose: function (connection) {
                return function () {
                    this.emit('close', {connection: connection});
                    this.removeConnection(connection);
                }.bind(this);
            },

            _onReceive: function (connection) {
                return function (data) {
                    var event = this._parse(data);
                    if (!event) { return; }

                    this.emit(event[0].join('.'), {
                        connection: connection,
                        data: tools.common.getJSON(event[1])
                    });

                    data = event = null;
                    delete data;
                    delete event;
                }.bind(this);
            },

            _onSocketOpen: function (connection) {
                connection.id = tools.string.guid();

                //connection.setEncoding('utf-8');

                this._onOpen(connection);
            },

            _onSocketReceive: function (connection) {
                return function(data){
                    this._onReceive(connection).call(this, data.toString());
                }.bind(this)
            },

            _parse: function (rawdata) {
                var event = rawdata.split(':', 2);

                if (event.length != 2) {
                    return;
                }

                var isSystemCall = event[0] == 'system' && event[1] == this.config.token;
                if (isSystemCall) {
                    rawdata = rawdata.substr(event.toString().length + 1);
                    event = rawdata.split(':', 2);
                }

                if (!isSystemCall && this._denied(event[0], event[1])) {
                    return;
                }

                return [event, rawdata.substr(event.toString().length + 1)];
            },

            _denied: function (service, event) {
                if (this.config.compatible[service]) { service = this.config.compatible[service]; }

                if (!(service in this.config.denied)) {
                    return false;
                }

                return this.config.denied[service].indexOf(event) >= 0;
            },

            _mqsub: function () {
                this.mq.subscribe('broadcast');
                this.mq.on('message', function (channel, message) {
                    this._mqreceive.call(this, channel, message);
                }.bind(this));
            },

            _mqpub: function (channel, arguments) {
                this.redis.publish(channel, JSON.stringify({pid: process.pid, arguments: arguments}));
            },

            _mqreceive: function (channel, message) {
                message = JSON.parse(message);
                if (message.pid == process.pid) { return; }

                switch (channel) {
                    case 'broadcast':
                        this._$broadcast(message.arguments.to, message.arguments.service, message.arguments.event, message.arguments.data);
                        break;
                }

                message = null;
                delete message;
            },

            _$send: function (to, service, event, data, publish) {
                if (!to) { return; }

                if (publish) { this._mqpub('send', {to: to, service: service, event: event, data: data}); }

                if (tools.type.isObject(data)) { data = JSON.stringify(data); }

                if (this.connections[to]) { this.connections[to].write([service, event, data].join(':')); }

                to = service = event = data = null;
                delete to;
                delete service;
                delete event;
                delete data;
            },

            _$broadcast: function (to, service, event, data, publish) {
                if (tools.type.isEmpty(to)) { return; }

                if (publish) { this._mqpub('broadcast', {to: to, service: service, event: event, data: data}); }

                if (tools.type.isObject(data)) { data = JSON.stringify(data); }

                data = [service, event, data].join(':');

                for (var k in to) {
                    if (this.connections[to[k]]) { this.connections[to[k]].write(data); }
                }

                to = service = event = data = null;
                delete to;
                delete service;
                delete event;
                delete data;
            }
        }
    }).getInstance();
}
