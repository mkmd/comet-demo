var tools = require('./toolkit'),
    Class = require('classful');

exports.create = function (server, service) {
    return Class.create({
        extend: require('events').EventEmitter,

        constructor: function () {
            this.server = server;
            this.service = service;
        },

        properties: {
            integrity: function () {
                return tools.fn.emit(function (emitter) {
                    var para0 = tools.fn.gather(function (storage, stat) {
                        if (storage[0] || stat[0]) {
                            logger.error('%s; %s', storage[0], stat[0]);
                            return emitter.emit('failed', this.service);
                        }

                        var para = tools.fn.gather(function () {
                            logger.integrity(this.service + ', observers: integrity ('
                                + [this._storageKey('*'), this._indexKey(), this._statKey('*')].join(',') + ')', data.length > 0);

                            emitter.emit('success', this.service);

                            data = null
                            delete data;
                        }.bind(this));

                        var data = storage[1].concat(stat[1]);

                        for (var k in data) { this.server.redis.del(data[k], para.add()); }

                        this.server.redis.del(this._indexKey(), para.add());

                        storage = stat = null;
                        delete storage;
                        delete stat;
                    }.bind(this));

                    this.server.redis.keys(this._storageKey('*'), para0.add());
                    this.server.redis.keys(this._statKey('*'), para0.add());
                }.bind(this));
            },

            add: function (connection, objectId) {
                return tools.fn.emit(function (emitter) {
                    if (!connection || !objectId){ return emitter.emit('failed', ERROR.ARGUMENTS); }

                    this.server.redis.sadd(this._storageKey(objectId), connection, tools.fn.handle(
                        function (added) {
                            /// no action if observer already exists
                            if (!added) { return emitter.emit('failed'); }

                            /// update index
                            this.server.redis.hset(this._indexKey(), connection, objectId, tools.fn.handle(
                                function () {
                                    this.emit('add');
                                }).bind(this));

                            /// notify
                            var para = tools.fn.gather(function (user, observers) {
                                var user = user[0];
                                var observers = observers[0];

                                /// if authorized: notify all observers
                                if (user) {
                                    /// update stat

                                    this.server.redis.hincrby(this._statKey(objectId), user, 1, function (err, result) {
                                        this.emit('add.notify', observers, user);
                                    }.bind(this));
                                }

                                /// in anycase: send authorized observers to current observer
                                try {
                                    this.server.get('users').get(observers).on('success', function (users) {
                                        this.emit('add.notify.observer', connection, users);
                                        emitter.emit('success');
                                    }.bind(this));
                                } catch (e) { emitter.emit('success'); }
                            }.bind(this));

                            this.server.get('users').get(connection).on('success', para.add()); /// gather first
                            this.get(objectId).on('success', para.add()); /// gather second
                        }).bind(this));
                }.bind(this));
            },

            remove: function (connection, objectId, user) {
                function _do(connection, objectId, user) { /// objectId can be in any format
                    return tools.fn.emit(function (emitter) {
                        function __do(user) {
                            /// no action if current observer is anonymous
                            if (!tools.type.isNumeric(user)) { return; }

                            /// update stat
                            this.server.redis.hincrby(this._statKey(objectId), user, -1, tools.fn.handle(
                                function (length) {
                                    //logger.trace(this.service + ', observers: remove (success)', length, connection, objectId, user);
                                    emitter.emit('success', connection, objectId, user);

                                    /// no action if the user has multiple connections //parseInt(length.toString())
                                    if (Number(length || 0)) { return; }

                                    /// notify all observers (excluding current observer: unsubscribed!) to 'remove' current user from viewers list
                                    this.get(objectId).on('success', function (observers) {
                                        //logger.trace(this.service + ', observers: remove (notify)', observers, connection, objectId, user);
                                        this.emit('notify', observers, objectId, user);
                                    }.bind(emitter));

                                }).bind(this));
                        }

                        this.server.redis.srem(this._storageKey(objectId), connection, tools.fn.handle(
                            function (removed) {
                                if (!removed) { return emitter.emit('failed', ERROR.OPERATION); }

                                /// update index
                                this.server.redis.hdel(this._indexKey(), connection, function () {
                                    if (user) { return __do.call(this, user); }

                                    try {
                                        this.server.get('users').get(connection).on('success', function (users) { __do.call(this, users.pop()); }.bind(this));
                                    } catch (e) { }
                                }.bind(this));
                            }).bind(this));
                    }.bind(this));
                }

                return tools.fn.emit(function (emitter) {
                    if (!connection){ return emitter.emit('failed', ERROR.ARGUMENTS); }

                    function _remove(connection, objectId, user) {
                        _do.call(this, connection, objectId, user).on('success',
                            function (connection, objectId, user) {
                                try {
                                    this.emit('remove', connection, objectId, user);
                                    emitter.emit('success', connection, objectId, user);
                                } catch (e) { }
                            }.bind(this)
                        ).on('notify',
                            function (observers, objectId, user) {
                                this.emit('remove.notify', observers, objectId, user);
                            }.bind(this)
                        );

                        return this;
                    }

                    /// update storage if user unsubscribes stream
                    if (objectId) { return _remove(connection, objectId, user); }

                    /// update storage if connection closed (stream_id is empty)
                    this.server.redis.hget(this._indexKey(), connection, tools.fn.handle(
                        function (objectId) {
                            _remove.call(this, connection, objectId, user);
                        }).bind(this));
                }.bind(this));
            },

            get: function (objectId) {
                return tools.fn.emit(function (emitter) {
                    if (!objectId){ return emitter.emit('failed', ERROR.ARGUMENTS); }

                    this.server.redis.smembers(this._storageKey(objectId), tools.fn.handle().bind(emitter));
                }.bind(this));
            },

            users: function (objectId) {
                return tools.fn.emit(function (emitter) {
                    this.get(objectId).on('success', function (candidates) {
                        try {
                            this.server.get('users').get(candidates).on('success', tools.fn.bubble('success').bind(emitter));
                        } catch (e) { emitter.emit('failed', candidates); }
                    }.bind(this));
                }.bind(this));
            },

            _storageKey: function (objectId) {
                /// subscribers ( {connection} )
                /// -> get stream observers

                return ['tgm', this.service, objectId, 'observers'].join('.');
            },

            _statKey: function (objectId) {
                /// users connections count ( {user: connections count} )
                /// -> decide to send 'remove' user

                return ['tgm', this.service, objectId, 'observers', 'stat'].join('.');
            },

            _indexKey: function () {
                /// streams ( {connection: stream} )
                /// -> get stream by connection (if connection closed: stream_id not passed)

                return ['tgm', this.service, 'list'].join('.');
            }
        }
    })();
}
