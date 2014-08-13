
tools = require('./toolkit');

//require('sys').inherits(MyClass, SuperClass)

var extend = function extend(another) {
    var prototype = this.__proto__;
    this.__proto__ = another;
    another.__proto__ = prototype;
    return this;
};

Object.defineProperty(Object.prototype, 'extend', {value: extend});

exports.SendMixin = function (service) {
    return {
        _send: function (connections, event, data) {
            this.server[Array.isArray(connections) ? 'broadcast' : 'send'](connections, service, event, data);
        }
    };
}

exports.UserMixin = function () {
    return {
        _user: function (fn, request) {
            return tools.fn.emit(function (emitter) {
                try {
                    this.server.get('users').get(request.connection.id).on('success', function (users) {
                        var ret = fn.call(this, parseInt(users[0]*1), request.data);
                        if (ret && ret['on']) {
                            return ret.on('success', tools.fn.bubble('success').bind(emitter));
                        }

                        emitter.emit('success');

                    }.bind(this));
                } catch (e) { emitter.emit('failed', ERROR.SERVICE); }
            }.bind(this));
        }
    };
}
