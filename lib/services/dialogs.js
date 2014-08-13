var tools = require('../toolkit'),
    mixins = require('../mixins'),
    Class = require('classful');

exports.create = function (server) {

    var DialogsService = Class.create({
        extend: require('events').EventEmitter,
        singleton: true,

        constructor: function () {
            this.server = server;
            this.config = this.server.config.services.dialogs;
        },

        properties: {
            initialize: function () {
                this.server
                    .on('message.send', this._onSend.bind(this))
                    .on('message.sendstatus', this._onSendStatus.bind(this))
                    .on('message.restore', this._onRestore.bind(this))
                    .on('message.clear_dialog', this._onClearDialog.bind(this))
                    .on('message.close_dialog', this._onCloseDialog.bind(this))
                    .on('message.history', this._onHistory.bind(this))
                    .on('message.check_for_new', this._onCheckForNew.bind(this))
                    .on('message.dialog', this._onDialog.bind(this))
                    .on('close', this._onRemoveConnection.bind(this));

                this.server.mongo.collection('dialogs', function (err, collection) {
                    this._dialogs = collection;
                }.bind(this));

                this.server.mongo.collection('messages', function (err, collection) {
                    this._messages = collection;
                }.bind(this));
            },

            integrity: function () {
                return tools.fn.emit(function (emitter) {
                    var para0 = tools.fn.gather(function () {
                        var processed = [];
                        for (var i = 0; i < arguments.length; i++) {
                            if (arguments[i].length) {
                                if (arguments[i][1]) {
                                    logger.error('%s', arguments[i][1]);
                                    return emitter.emit('failed', 'dialogs');
                                }

                                processed.push(arguments[i][0]);
                            }
                        }

                        emitter.emit('success', 'dialogs');

                        logger.integrity('dialogs: integrity %s %s',
                            processed.length ? '(' + processed.join(', ') + ')' : '', processed.length > 0);

                        processed = null;
                        delete processed;
                    });

                    this.server.mongo.dropCollection('dialogs', function (err, result) {
                        this.server.mongo.createCollection('dialogs', para0.add('dialogs'));
                    }.bind(this));

                    this.server.mongo.collection('messages', {safe: true}, function (err, collection) {
                        if (err) { /// not exists
                            this.server.mongo.createCollection('messages', {safe: true}, para0.add('messages'));
                        }
                    }.bind(this))
                }.bind(this));
            },

            channel: function (user, companion) {
                if (tools.type.isObject(user)) {
                    return {left: Number(user.left || 0), right: Number(user.right || 0)};
                }

                user = Number(user || 0);
                companion = Number(companion || 0);
                return {left: Math.max(user, companion), right: Math.min(user, companion)};
            },

            companions: function (user, active) {
                return tools.fn.emit(function (emitter) {
                    this.get(user, null, {active: active}).on('success', function (dialogs) {
                        var list = [];
                        dialogs.forEach(function (item) {
                            list.push(this.companion(user, item));
                        }.bind(this));

                        emitter.emit('success', list);
                    }.bind(this));
                }.bind(this));
            },

            get: function (user, companion, additional) { /// get user dialogs, if companion passed - appropriate user-with-companion dialog
                user = Number(user || 0);

                return tools.fn.emit(function (emitter) {
                    if (!user) {
                        return emitter.emit('failed');
                    }

                    var query = companion
                        ? this.channel(user, companion)
                        : {$or: [{left: user}, {right: user}]};

                    if (additional && additional.active){
                        query.closed = {$ne: user};
                    }

                    this._dialogs.find(query).toArray(tools.fn.handle().bind(emitter));
                }.bind(this));
            },

            add: function (dialog, data) {
                return tools.fn.emit(function (emitter) {
                    if (dialog.left == dialog.right) {
                        return emitter.emit('failed');
                    }

                    //если уже существует - возвращаем его
                    this.get(dialog.left, dialog.right).on('success', function (dialogs) {
                        if (dialogs.length) {
                            return emitter.emit('success', dialogs.pop(), false); // is new - false
                        }

                        //...или создаем новый
                        return this._dialogs.insert(tools.common.merge(
                            {created: tools.time.stamp(), modified: null,
                                undelivered: {size: 0, list: []},
                                windows: {left: {}, right: {}}},
                            dialog, data),
                            {safe: true}, tools.fn.handle(
                                function (item) {
                                    emitter.emit('success', item.pop(), true);
                                }).bind(emitter));
                    }.bind(this));
                }.bind(this));
            },

            count: function (dialog) {
                return tools.fn.emit(function (emitter) {
                    this._dialogs.count({left: dialog.left, right: dialog.right}, function (err, count) {
                        emitter.emit('success', count);
                    });
                }.bind(this));
            },

            close: function (dialog, forUser) {
                forUser = Number(forUser || 0);
                return tools.fn.emit(function (emitter) {
                    /// drop (on second call - another companion closed dialog too) if one of companions already closed dialog
                    var companion = this.companion(forUser, dialog);
                    this._dialogs.remove({left: dialog.left, right: dialog.right, closed: companion},
                        {safe: true}, tools.fn.handle(
                            function (removed) {
                                if (removed) {
                                    emitter.emit('success', true);
                                }
                                else {
                                    this._dialogs.update({left: dialog.left, right: dialog.right}, {$set: {closed: forUser, modified: tools.time.stamp()}}, {safe: true}, function (err, updated) {
                                        emitter.emit('success', false);
                                    });
                                }
                            }).bind(this));
                }.bind(this));
            },

            newMessage: function (dialog, user, text, id) {
                user = Number(user || 0);

                return tools.fn.emit(function (emitter) {
                    this.messagesCount(dialog.left, dialog.right).on('success', function (count) {
                        this._messages.insert({
                            ord: count + 1, created: tools.time.stamp(),
                            left: dialog.left, right: dialog.right,
                            owner: user, text: text
                        }, {safe: true}, tools.fn.handle(
                            function (item) {
                                item = item.pop();
                                if (!item) {
                                    return emitter.emit('success', item);
                                }

                                this._dialogs.update({left: dialog.left, right: dialog.right},
                                    {$set: {modified: tools.time.stamp()}, '$inc': {'undelivered.size': 1}, '$push': {'undelivered.list': {to: this.companion(user, dialog), id: item._id.toHexString(), _id: id}}},
                                    function () {
                                        emitter.emit('success', item);
                                    });

                            }).bind(this));

                    }.bind(this));
                }.bind(this));
            },

            _deliverMessage: function (dialog, id) {
                return toolsindn.emit(function (emitter) {
                    this._dialogs.update({left: dialog.left, right: dialog.right},
                        {$set: {modified: tools.time.stamp()}, '$inc': {'undelivered.size': -1}, '$pull': {'undelivered.list': {id: id}}},
                        {safe: true}, tools.fn.handle().bind(emitter));
                }.bind(this));
            },

            _deliverMessages: function (channel, toUser) {
                return tools.fn.emit(function (emitter) {
                    var query = {left: channel.left, right: channel.right};
                    //находим подходящие диалог
                    this._dialogs.findOne(query, function (err, dialog) {
                        if (!dialog) {
                            return emitter.emit('success', false);
                        }

                        var size = 0;
                        for (var k in dialog.undelivered.list) {
                            if (dialog.undelivered.list[k].to == toUser) { size++; }
                        }

                        if (!size) {
                            return emitter.emit('success', false);
                        }

                        //убираем сообщения из списка недоставленных (только для выбранного пользователя)
                        this._dialogs.update(query, {$set: {modified: tools.time.stamp()}, $inc: {'undelivered.size': -size}, $pull: {'undelivered.list': {to: Number(toUser || 0)} } },
                            tools.fn.handle().bind(emitter));

                    }.bind(this));
                }.bind(this));
            },

            history: function (dialog, forUser, skip, limit) {
                return tools.fn.emit(function (emitter) {
                    var para = tools.fn.gather(function () {
                        var allCount = arguments[0][0];
                        var clearedCount = arguments[1][0];
                        var allowedCount = allCount - clearedCount;

                        if (allowedCount <= skip) {
                            return emitter.emit('success', [], true, allCount, clearedCount);
                        }

                        var options = {sort: {ord: -1}};
                        if (skip) { options.skip = skip; }
                        if (limit) { options.limit = limit; }
                        if (skip + limit > allowedCount) { options.limit = allowedCount - skip; }

                        this._messages.find({left: dialog.left, right: dialog.right}, options)
                            .toArray(tools.fn.handle(
                            function (items) {
                                this.emit('success', items.reverse(), (allowedCount - skip) <= limit, allCount, clearedCount);
                            }).bind(emitter));
                    }.bind(this));

                    this.messagesCount(dialog.left, dialog.right).on('success', para.add());
                    this.clearedCount(dialog, forUser).on('success', para.add());
                }.bind(this));
            },

            clearHistory: function (dialog, forUser) {
                forUser = Number(forUser || 0);

                return tools.fn.emit(function (emitter) {
                    var para0 = tools.fn.gather(function () {
                        var count = Number(arguments[0][0] || 0);
                        var messageWithMeta = arguments[1][1];

                        var para = tools.fn.gather(function () {
                            emitter.emit('success');
                        }.bind(this));

                        if (messageWithMeta) {
                            this._messages.update({_id: messageWithMeta._id}, {$set: {cleared: count}}, para.add());
                        }
                        else {
                            this._messages.update({left: dialog.left, right: dialog.right, owner: forUser}, {$set: {cleared: count}}, para.add());
                        }
                    }.bind(this));

                    this.messagesCount(dialog.left, dialog.right).on('success', para0.add());
                    this._messages.findOne({left: dialog.left, right: dialog.right, owner: forUser, cleared: {$exists: true}}, para0.add());

                }.bind(this));
            },

            clearedCount: function (dialog, forUser) {
                forUser = Number(forUser || 0);

                return tools.fn.emit(function (emitter) {
                    this._messages.findOne({left: dialog.left, right: dialog.right, owner: forUser, cleared: {$exists: true}},
                        {fields: {cleared: true}},
                        tools.fn.handle(
                            function (item) {
                                this.emit('success', item ? item.cleared : 0);
                            }).bind(emitter));
                }.bind(this));
            },

            messagesCount: function (user, companion) {
                user = Number(user || 0);
                companion = Number(companion || 0);

                return tools.fn.emit(function (emitter) {
                    this._messages.count(this.channel(user, companion), function (err, count) {
                        emitter.emit('success', parseInt(count));
                    }.bind(this));
                }.bind(this));
            },

            unreadedCount: function (user, companion) {
                return this.undeliveredCount(companion, user);
            },

            undeliveredCount: function (user, companion) {
                user = Number(user || 0);
                companion = Number(companion || 0);

                return tools.fn.emit(function (emitter) {
                    var dialog = this.channel(user, companion);

                    //находим диалог, в нем читаем соответствующее поле
                    this._dialogs.findOne({left: dialog.left, right: dialog.right, 'undelivered.list': {$elemMatch: {to: companion}}}, {fields: {'undelivered.size': true}},
                        function (err, item) {
                            emitter.emit('success', item ? item.undelivered.size : 0);
                        }.bind(this)
                    );
                }.bind(this));
            },

            activateWindow: function (dialog, forUser, connection) {
                return tools.fn.emit(function (emitter) {
                    var side = this.side(forUser, dialog);
                    if (!side) {
                        return emitter.emit('success', false);
                    }

                    var query = {left: dialog.left, right: dialog.right};
                    query['windows.' + side + '.active'] = {$ne: connection};
                    var data = {};
                    data['windows.' + side + '.active'] = connection;

                    this._dialogs.update(query,
                        {$set: {modified: tools.time.stamp()}, $push: data}, {safe: true}, tools.fn.handle().bind(emitter));

                }.bind(this));
            },

            deactivateWindow: function (dialog, forUser, connection) {
                return tools.fn.emit(function (emitter) {
                    var side = this.side(forUser, dialog);
                    if (!side) {
                        return emitter.emit('success', false);
                    }

                    var data = {};
                    data['windows.' + side + '.active'] = connection;
                    this._dialogs.update({left: dialog.left, right: dialog.right},
                        {$set: {modified: tools.time.stamp()}, $pull: data}, {safe: true}, tools.fn.handle().bind(emitter));
                }.bind(this));
            },

            deactivateAllWindows: function (dialog, forUser) {
                return tools.fn.emit(function (emitter) {
                    var side = this.side(forUser, dialog);
                    if (!side) {
                        return emitter.emit('success', false);
                    }

                    var data = {};
                    data['windows.' + side + '.active'] = [];
                    this._dialogs.update({left: dialog.left, right: dialog.right}, {$set: {modified: tools.time.stamp()}, $set: data},
                        {safe: true}, tools.fn.handle().bind(emitter));
                }.bind(this));
            },

            activeWindows: function (dialog, user) {
                return tools.fn.emit(function (emitter) {
                    var side = this.side(user, dialog);
                    if (!side) {
                        return emitter.emit('success', false);
                    }

                    var fields = {};
                    fields['windows.' + side] = true;

                    this._dialogs.findOne({left: dialog.left, right: dialog.right}, {fields: fields}, tools.fn.handle(
                        function (item) {
                            var windows = [];

                            if ((item && item._id) && Array.isArray(item.windows[side].active)) {
                                windows = item.windows[side].active;
                            }

                            this.emit('success', windows);
                        }).bind(emitter));
                }.bind(this));
            },

            _onSend: function (request) {

                if (!request.data.to_id) { return; }

                try {
                    this.server.get('users').get(request.connection.id).on('success', function (user) {
                        user = user[0];
                        var companion = request.data.to_id;

                        if (!user) { return; }

                        this._sendGranted(user, companion).on('success', function () {
                            _handle.call(this, user, companion);
                        }.bind(this)).on('failed', function () {
                            this._send(request.connection.id, 'noaccess', {tmp_id: request.data.message_id, message_id: tools.time.stamp()});
                        }.bind(this));

                    }.bind(this));
                } catch (e) { }

                function _handle(user, companion) {
                    var channel = this.channel(user, companion);
                    var plural = {
                        //message_id: new hashlib.MD5().hex(Date.now()),
                        from_id: user,
                        to_id: companion,
                        message: request.data.message,
                        timestamp: tools.time.stamp()
                    }

                    var undeliveredPlural = tools.common.merge({mst: 'undelivered'}, plural);

                    var para = tools.fn.gather(function (dialog, message, userConnections, companionConnections) {
                        dialog = dialog[0];
                        message = message[0];
                        userConnections = userConnections[0];
                        companionConnections = companionConnections[0];

                        var userActiveWindows = dialog.windows[this.side(user, dialog)].active;
                        var companionActiveWindows = dialog.windows[this.side(companion, dialog)].active;

                        if (!companionConnections.length) { /// companion offline
                            this._send(tools.iter.diff([request.connection.id], userActiveWindows), 'receive', undeliveredPlural); /// to user active windows (exclude current active window)
                            this._send(tools.iter.diff(userActiveWindows, userConnections), 'sync', {user_id: companion}); /// to user inactive windows
                            return;
                        }

                        if (companionActiveWindows && companionActiveWindows.length) {
                            this._deliverMessages(dialog, companion);

                            this._send(companionActiveWindows, 'receive', plural); /// to companion active windows
                            this._send(tools.iter.diff(companionActiveWindows, companionConnections), 'sync', {user_id: user}); /// to companion inactive windows

                            this._send(request.connection.id, 'delivered', {tmp_id: request.data.message_id, message_id: message._id}); /// to user (active window)
                            this._send(tools.iter.diff([request.connection.id], userActiveWindows), 'delivered', {tmp_id: request.data.message_id, message_id: message._id}); /// to user active windows (exclude current active window)
                        }
                        else {
                            this._send(companionConnections.pop(), 'new', {user_id: user, pic: true}); /// pic to single companion inactive window
                            this._send(companionConnections, 'new', {user_id: user}); /// to companion inactive windows

                            plural = undeliveredPlural;
                        }

                        this._send(tools.iter.diff([request.connection.id], userActiveWindows), 'receive', plural); /// to user active windows (exclude current active window)
                        this._send(tools.iter.diff(userActiveWindows, userConnections), 'sync', {user_id: companion}); /// to user inactive windows
                    }.bind(this));

                    try {
                        this.add(channel).on('success', para.add());
                        this.newMessage(channel, user, plural.message, request.data.message_id).on('success', para.add());

                        this.server.get('users').connections(user).on('success', para.add());
                        this.server.get('users').connections(companion).on('success', para.add());
                    } catch (e) { }
                }
            },

            _onSendStatus: function (request) {
                if (!request.data.status || !request.data.to_user_id) {
                    return;
                }

                this._user(function (user, data) {
                    if (user == data.to_user_id) { return; }

                    if (data.status == 'stop') {
                        this.deactivateWindow(this.channel(user, data.to_user_id), user, request.connection.id);
                    }

                    //транслируем статус собеседнику
                    this._sendStatus(data.status, user, data.to_user_id);

                }.bind(this), request);
            },

            _onDialog: function (request) {
                if (!request.data.user_id || request.data.user_id == request.data.user) { return; }

                var para = tools.fn.gather(function(user){
                    user = user[0];

                    this.add(this.channel(user, request.data.user_id)).on('success', function(item, isNew){
                        if (isNew){
                            this.emit('dialogs.open', user, request.data.user_id);
                        }
                    }.bind(this));
                }.bind(this));

                if (request.data.user){
                    return para.add().call(this, request.data.user);
                }

                this._user(function(user, data){
                    para.add().call(this, user);
                }.bind(this), request);
            },

            _onRestore: function (request) {
                this._user(function (user, data) {
                    if (!user || !data.from_user_id) { return; }

                    var channel = this.channel(user, data.from_user_id);

                    var para = tools.fn.gather(function (dialog, history) {

                        this.emit('dialogs.open', user, data.from_user_id);

                        this.activateWindow(channel, user, request.connection.id).on('success', function () {
                            this.get(channel.left, channel.right).on('success', function (dialog) {
                                this._restore(user, dialog, history, {connection: request.connection.id});
                            }.bind(this))
                        }.bind(this));

                    }.bind(this));

                    this.add(channel).on('success', para.add());
                    this.history(channel, user, 0, this.config.tail).on('success', para.add());

                }.bind(this), request);
            },

            _onCheckForNew: function (request) {
                if (!request.data.from_user_id) {
                    return;
                }

                this._user(function (user, data) {
                    var companion = data.from_user_id;

                    if (!user || !companion) { return; }

                    var channel = this.channel(user, companion);

                    this.add(channel).on('success', function () {
                        this.activateWindow(channel, user, request.connection.id).on('success', function () {
                            this.get(user, companion).on('success', function (dialog) {
                                if (!dialog.length) {
                                    return;
                                }

                                dialog = dialog[0];
                                data.sync = Number(data.sync || 0);

                                var limit = 0;
                                var sync = 0;
                                var info = this._messagesStatus(dialog.undelivered.list, companion, user);
                                /// deliver unreaded messages
                                if ('unread' == info.status) {
                                    limit = info.count + data.sync;
                                } else if (data.sync) {
                                    limit = data.sync;

                                    if ('undelivered' == info.status) {
                                        sync = data.sync > info.count ? info.count : data.sync;
                                    } else if ('ok' == info.status) {
                                        sync = data.sync;
                                    }
                                }

                                if (!limit) {
                                    return;
                                }

                                this.history(dialog, user, 0, limit).on('success', function () {
                                    this._restore(user, [dialog], arguments, {sync: sync, connection: request.connection.id});
                                }.bind(this));

                            }.bind(this));
                        }.bind(this));
                    }.bind(this));

                }.bind(this), request);
            },

            _onHistory: function (request) {
                if (!request.data.user_id) {
                    return;
                }

                this._user(function (user, data) {
                    var channel = this.channel(user, data.user_id);
                    this.history(channel, user, data.current_count_messages, this.config.chunk).on('success',
                        function (history, fully) {
                            this._send(request.connection.id, 'history', this._prepareMessagesToNotify(data.user_id, channel, history, fully));
                        }.bind(this)
                    );
                }.bind(this), request);
            },

            _onClearDialog: function (request) {
                if (!request.data.user_id) {
                    return;
                }

                this._user(function (user, data) {
                    this.clearHistory(this.channel(user, data.user_id), user);
                }.bind(this), request);
            },

            _onCloseDialog: function (request) {
                if (!request.data.user_id) {
                    return;
                }

                this._user(function (user, data) {
                    var channel = this.channel(user, data.user_id);

                    this.close(channel, user).on('success', function (removed) {
                        this._sendStatus('stop', user, data.user_id);
                        this.emit('dialogs.close', user, data.user_id, request.connection.id);
                    }.bind(this));

                    this.deactivateAllWindows(channel, user);

                }.bind(this), request);
            },

            _onRemoveConnection: function (request) {
                this._dialogs.update({},
                    {$set: {modified: tools.time.stamp()}, $pull: {'windows.left.active': request.connection.id}},
                    {multi: true, safe: true}, function (err, updated) {

                    });

                this._dialogs.update({},
                    {$set: {modified: tools.time.stamp()}, $pull: {'windows.right.active': request.connection.id}},
                    {multi: true, safe: true}, function (err, updated) {

                    });
            },

            _sendStatus: function (status, from, to) {
                try {
                    this.activeWindows(this.channel(from, to), to).on('success', function (connections) {
                        this._send(connections, 'receivestatus', {from_id: from, status: status, timestamp: tools.time.stamp()});
                    }.bind(this));
                } catch (e) { }
            },

            _messagesStatus: function (list, from, to) {
                var info = {status: '', count: 0};

                for (var k in list) {
                    if (list[k].to == to) {
                        info.status = 'unread';
                    }
                    else if (list[k].to == from) {
                        info.status = 'undelivered';
                    }

                    if (info.status) { info.count++; }
                }

                info.status = info.status || 'ok';

                return info;
            },

            _prepareMessagesToNotify: function (who, dialog, list, fully, additional) {
                var messages = [];
                for (var k in list) {
                    //заготовка сообщения
                    var plural = {
                        message_id: list[k]._id,
                        from_id: list[k].owner,
                        to_id: this.companion(list[k].owner, dialog),
                        timestamp: list[k].created,
                        message: list[k].text
                    };
                    messages.push(plural);
                }

                var data = tools.common.merge({user_id: who, messages: messages}, additional);
                if (fully) { data.all = 'all'; }

                return data;
            },

            _restore: function (user, dialog, history, additional) {
                /// validate
                if (!user || !dialog || !history) { return; }

                /// arguments
                dialog = dialog[0];
                var fully = history[1];
                history = history[0];
                additional = additional || {};

                if (!history || !history.length) {
                    return;
                }

                var companion = this.companion(user, dialog);
                var channel = this.channel(user, companion);

                /// determine messages status & count
                var info = this._messagesStatus(dialog.undelivered.list, companion, user);
                additional.sync = Number(additional.sync || 0) || info.count;

                /// deliver unreaded messages
                if ('unread' == info.status) {
                    this._deliverMessages(channel, user);

                    try { /// sync: "me" notified only to inactive windows
                        this.server.get('users').connections(user).on('success', function (connections) {
                            this._send(tools.iter.diff(dialog.windows[this.side(user, dialog)].active, connections),
                                'sync', {user_id: companion, cnt: additional.sync});
                        }.bind(this));

                        try {
                            //уведомить все соединения собеседника о доставке
                            this.server.get('users').connections(companion).on('success', function (connections) {
                                this._send(connections, 'delivered', {user_id: user});
                            }.bind(this));
                        } catch (e) {  }
                    } catch (e) { }
                }

                /// notify "me" about restore data
                if (additional.connection) {
                    this._send(additional.connection, 'restorechat',
                        this._prepareMessagesToNotify(companion, channel, history, fully,
                            {last_messages_status: info.status, last_messages_count: additional.sync}));
                }
            },

            _sendGranted: function (fromUser, toUser) {
                return tools.fn.emit(function (emitter) {
                    try {
                        this.server.get('users').granted(fromUser, this.server.config.user.privacy.SEND_MESSAGE, toUser)
                            .on('success', tools.fn.bubble('success').bind(emitter))
                            .on('failed', tools.fn.bubble('failed').bind(emitter));
                    } catch (e) { emitter.emit('failed'); }
                }.bind(this));
            },

            side: function (user, inDialog) {
                for (var k in {left: 0, right: 1}) {
                    if (inDialog[k] == user) { return k; }
                }
            },

            companion: function (user, inDialog) {
                for (var k in {left: 0, right: 1}) {
                    if (inDialog[k] != user) { return Number(inDialog[k] || 0); }
                }
            }
        }
    });

    DialogsService.prototype.extend(mixins.SendMixin('message'));
    DialogsService.prototype.extend(mixins.UserMixin());

    return DialogsService.getInstance();
}
