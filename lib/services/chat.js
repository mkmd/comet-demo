var tools = require('../toolkit'),
    mixins = require('../mixins'),
    Class = require('classful');

exports.create = function (server) {
    var ChatService = Class.create({
        extend:    require('events').EventEmitter,
        singleton: true,

        constructor: function () {
            this.server = server;
            this.config = this.server.config.services.chat;
            this.observe = require('../observers').create(this.server, 'chat');
        },

        properties: {
            initialize: function () {
                this.server
                    .on('chat.open', this._onOpen.bind(this))
                    .on('chat.close', this._onClose.bind(this))
                    .on('chat.message', this._onAddMessage.bind(this));

                this.on('messages', this._notifyAboutMessages.bind(this));
            },

            integrity:     function () {
                return tools.fn.emit(function (emitter) {
                    this.observe.integrity().on('success', function () {
                        this.server.redis.keys(this._storageKey('*'), function (err, keys) {
                            if (err) {
                                logger.error(err);
                                return emitter.emit('failed', 'chat');
                            }

                            var para = tools.fn.gather(function () {
                                logger.integrity('chat: integrity (' + this._storageKey('*') + ')', keys.length > 0);

                                emitter.emit('success', 'chat');

                                keys = null;
                                delete keys;
                            }.bind(this));

                            if (!keys.length) { return para.add().call(); }

                            keys.forEach(function (key) { this.server.redis.del(key, para.add()); }.bind(this));
                        }.bind(this));
                    }.bind(this));
                }.bind(this));
            },

            bindingExists: function (binding) { /// binding: {service: <to target service>, id: <with target object id>}
                return tools.type.isObject(binding)
                    && (binding.service in this.server.services)
                    && binding.id;
            },

            observers: function (data) {
                return tools.fn.emit(function (emitter) {
                    var binds = this.bindingExists(data.binding);

                    (binds ? this.server.get(data.binding.service).observe : this.observe).get(binds ? data.binding.id : data.channel).on('success',
                        function (observers) {
                            this.emit('success', observers);
                        }.bind(emitter)
                    );

                }.bind(this));
            },

            messages: function (channel, start, end) {
                return tools.fn.emit(function (emitter) {
                    if (!channel){ return emitter.emit('failed', ERROR.ARGUMENTS); }

                    start = start || 0;
                    end = end || -1;

                    this.server.redis.lrange(this._storageKey(channel), start, end, tools.fn.handle(
                        function (messages) {
                            this.emit('success', messages.map(function (item) { return JSON.parse(item); }));
                        }).bind(emitter));
                }.bind(this));
            },

            _onOpen: function (request) {
                if (!request.data.channel) { return; }

                if (!this.bindingExists(request.data.binding)) {
                    this.observe.add(request.connection.id, request.data.channel);
                }

                this.server.redis.llen(this._storageKey(request.data.channel), tools.fn.handle(
                    function (length) {
                        length = parseInt(length);
                        var start = length > this.config.tail ? length - this.config.tail : 0;

                        this.messages(request.data.channel, start).on('success', function (messages) {
                            this.emit('messages', request.connection.id, messages);
                        }.bind(this));
                    }).bind(this));
            },

            _onClose: function (request) {
                if (!request.data.channel) { return; }

                if (this.bindingExists(request.data.binding)) { return; }

                this.observe.remove(request.connection.id, request.data.channel);
            },

            _onAddMessage: function (request) {
                if (!request.data.channel || !request.data.user || !request.data.message) { return; }

                var message = {date: tools.time.stamp(), id: request.data.user, text: request.data.message};
                var key = this._storageKey(request.data.channel);

                this.server.redis.rpush(key, JSON.stringify(message), tools.fn.handle(
                    function (length) {
                        length = parseInt(length);
                        var trimOffset = this.config.capacity < length ? Math.abs(length - this.config.capacity) : 0;

                        this.server.redis.ltrim(key, trimOffset, -1, tools.fn.handle(
                            function () {
                                this.observers(request.data).on('success', function (observers) {
                                    this.emit('messages', observers, [message]);
                                }.bind(this));
                            }).bind(this));
                    }).bind(this));
            },

            _notifyAboutMessages: function (to, messages) {
                this._send(to, 'messages', {messages: messages});
            },

            _storageKey: function (objectId) {
                return ['tgm', 'chat', objectId, 'messages'].join('.');
            }
        }
    });

    ChatService.prototype.extend(mixins.SendMixin('chat'));

    return ChatService.getInstance();
}
